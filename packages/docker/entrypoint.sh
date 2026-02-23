#!/bin/sh
set -e

# Locate the installed nanobot package directory
NANOBOT_DIR=$(python -c "import nanobot; import os; print(os.path.dirname(nanobot.__file__))")
echo "[entrypoint] nanobot found at: $NANOBOT_DIR"

# ── 1. Copy channel file ──────────────────────────────────────────────────────
cp /nanofleet_channel.py "$NANOBOT_DIR/channels/nanofleet.py"
echo "[entrypoint] NanoFleet channel copied"

# ── 2. Patch config/schema.py ────────────────────────────────────────────────
SCHEMA="$NANOBOT_DIR/config/schema.py"

if ! grep -q "NanoFleetConfig" "$SCHEMA"; then
python - "$SCHEMA" <<'PYEOF'
import sys

path = sys.argv[1]
with open(path, "r") as f:
    content = f.read()

# Add NanoFleetConfig class before ChannelsConfig
injection = '''
class NanoFleetConfig(Base):
    """NanoFleet internal channel configuration."""
    enabled: bool = True


'''

content = content.replace("class ChannelsConfig(", injection + "class ChannelsConfig(")

# Add nanofleet field as last entry in ChannelsConfig, before the next class
# We insert it right before "class AgentDefaults" which follows ChannelsConfig
nanofleet_field = "    nanofleet: NanoFleetConfig = Field(default_factory=NanoFleetConfig)\n\n\n"
content = content.replace("class AgentDefaults(", nanofleet_field + "class AgentDefaults(")

with open(path, "w") as f:
    f.write(content)
PYEOF
    echo "[entrypoint] config/schema.py patched"
else
    echo "[entrypoint] config/schema.py already patched"
fi

# ── 3. Patch channels/manager.py ─────────────────────────────────────────────
MANAGER="$NANOBOT_DIR/channels/manager.py"

if ! grep -q "NanoFleetChannel" "$MANAGER"; then
python - "$MANAGER" <<'PYEOF'
import sys

path = sys.argv[1]
with open(path, "r") as f:
    content = f.read()

# Add top-level import at the top of the file (after the last top-level import line)
import_line = "from nanobot.channels.nanofleet import NanoFleetChannel\n"

# Find the last top-level "from ... import" line (lines starting with "from")
lines = content.split("\n")
last_import_idx = -1
for i, line in enumerate(lines):
    if line.startswith("from ") or line.startswith("import "):
        last_import_idx = i

if last_import_idx >= 0:
    lines.insert(last_import_idx + 1, import_line.rstrip())
    content = "\n".join(lines)

# Append NanoFleet block inside _init_channels, just before the method ends.
# We look for the last "logger.info(..." inside a try/except block and insert after it.
# The method ends when we hit "    async def start_all".
# Strategy: insert our block just before "    async def start_all"
nanofleet_block = '''
        # NanoFleet channel
        if self.config.channels.nanofleet.enabled:
            try:
                self.channels["nanofleet"] = NanoFleetChannel(
                    self.config.channels.nanofleet, self.bus
                )
                logger.info("NanoFleet channel enabled")
            except Exception as e:
                logger.warning(f"NanoFleet channel not available: {e}")

'''

content = content.replace(
    "    async def _start_channel",
    nanofleet_block + "    async def _start_channel"
)

with open(path, "w") as f:
    f.write(content)
PYEOF
    echo "[entrypoint] channels/manager.py patched"
else
    echo "[entrypoint] channels/manager.py already patched"
fi

# ── 4. Launch nanobot ─────────────────────────────────────────────────────────
echo "[entrypoint] Starting nanobot gateway..."
exec nanobot gateway
