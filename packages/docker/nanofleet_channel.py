"""
NanoFleet channel for nanobot.

Connects back to the NanoFleet API via WebSocket on startup,
authenticates with NANO_INTERNAL_TOKEN, and bridges messages
between the API and nanobot's internal MessageBus.
"""

import asyncio
import json
import logging
import os

import websockets
from websockets.exceptions import ConnectionClosed

from nanobot.bus.events import InboundMessage, OutboundMessage
from nanobot.bus.queue import MessageBus
from nanobot.channels.base import BaseChannel

logger = logging.getLogger(__name__)

NANO_API_URL = os.environ.get("NANO_API_URL", "http://host.docker.internal:3000")
NANO_INTERNAL_TOKEN = os.environ.get("NANO_INTERNAL_TOKEN", "")
NANO_AGENT_ID = os.environ.get("NANO_AGENT_ID", "unknown")

# Convert http(s):// to ws(s)://
WS_URL = NANO_API_URL.replace("https://", "wss://").replace("http://", "ws://") + "/internal/ws"

SESSION_KEY = f"nanofleet:{NANO_AGENT_ID}"
RECONNECT_DELAY = 5  # seconds


class NanoFleetConfig:
    """Minimal config stub — no YAML config needed, reads from env."""
    enabled: bool = True
    allow_from: list = []


class NanoFleetChannel(BaseChannel):
    name = "nanofleet"

    def __init__(self, config: NanoFleetConfig, bus: MessageBus):
        super().__init__(config, bus)
        self._ws = None
        self._send_queue: asyncio.Queue = asyncio.Queue()

    async def _drain_bus_outbound(self) -> None:
        """Forward outbound messages from the bus into our send queue."""
        while True:
            msg = await self.bus.consume_outbound()
            await self._send_queue.put(msg)

    async def start(self) -> None:
        self._running = True
        logger.info("[NanoFleet] Starting channel, connecting to %s", WS_URL)

        # Drain outbound messages from the bus into our send queue
        asyncio.create_task(self._drain_bus_outbound())

        while self._running:
            try:
                async with websockets.connect(
                    WS_URL,
                    additional_headers={"Authorization": f"Bearer {NANO_INTERNAL_TOKEN}"},
                ) as ws:
                    self._ws = ws
                    logger.info("[NanoFleet] Connected to API")

                    recv_task = asyncio.create_task(self._receive_loop(ws))
                    send_task = asyncio.create_task(self._send_loop(ws))

                    done, pending = await asyncio.wait(
                        [recv_task, send_task],
                        return_when=asyncio.FIRST_COMPLETED,
                    )
                    for task in pending:
                        task.cancel()
                        try:
                            await task
                        except asyncio.CancelledError:
                            pass
                    for task in done:
                        exc = task.exception()
                        if exc:
                            raise exc

            except (ConnectionClosed, OSError) as e:
                logger.warning("[NanoFleet] Connection error: %s", e)
            except asyncio.CancelledError:
                break

            if self._running:
                logger.info("[NanoFleet] Reconnecting in %ds...", RECONNECT_DELAY)
                await asyncio.sleep(RECONNECT_DELAY)

        self._ws = None

    async def _receive_loop(self, ws) -> None:
        """Read messages from the API and push them into the nanobot bus."""
        async for raw in ws:
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue

            if data.get("type") == "message":
                content = data.get("content", "")
                session_key = data.get("sessionKey", SESSION_KEY)
                chat_id = session_key.split(":", 1)[-1] if ":" in session_key else NANO_AGENT_ID

                # Signal thinking before processing
                try:
                    await ws.send(json.dumps({"type": "thinking"}))
                except ConnectionClosed:
                    pass

                inbound = InboundMessage(
                    channel="nanofleet",
                    sender_id="user",
                    chat_id=chat_id,
                    content=content,
                )
                await self.bus.publish_inbound(inbound)

    async def _send_loop(self, ws) -> None:
        """Drain the send queue and forward responses to the API."""
        while True:
            msg = await self._send_queue.get()
            payload = {
                "type": "response",
                "agentId": NANO_AGENT_ID,
                "content": msg.content,
            }
            try:
                await ws.send(json.dumps(payload))
            except ConnectionClosed:
                # Re-queue and let the outer loop reconnect
                await self._send_queue.put(msg)
                break

    async def stop(self) -> None:
        self._running = False
        if self._ws:
            await self._ws.close()
            self._ws = None

    async def send(self, msg: OutboundMessage) -> None:
        """Called by ChannelManager dispatcher — enqueue for sending."""
        await self._send_queue.put(msg)
