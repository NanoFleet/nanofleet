FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends curl ca-certificates git && \
    apt-get purge -y && \
    apt-get autoremove -y && \
    rm -rf /var/lib/apt/lists/*

RUN uv pip install --system nanobot-ai websockets

RUN mkdir -p /root/.nanobot

COPY nanofleet_channel.py /nanofleet_channel.py
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 18790

ENTRYPOINT ["/entrypoint.sh"]
