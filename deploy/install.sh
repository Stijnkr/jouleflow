#!/usr/bin/env bash
# Installs or updates Jouleflow on a Raspberry Pi (Raspberry Pi OS / Debian).
# Requires: uv, Node.js 20.19+, npm. Run from anywhere as the user that should run the service.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="$HOME/.local/bin:$PATH"

echo "==> Backend dependencies"
(cd "$REPO/backend" && uv sync --no-dev --frozen 2>/dev/null || uv sync --no-dev)

echo "==> Building web app"
(cd "$REPO/frontend" && npm ci --no-audit --no-fund && npm run build)
# Flush to the SD card before restarting, and refuse to continue with a broken build
# (an interrupted write can leave empty files behind).
sync
if [ ! -s "$REPO/frontend/dist/index.html" ] || [ -z "$(find "$REPO/frontend/dist/assets" -name '*.js' -size +1k)" ]; then
  echo "Web app build is empty or incomplete. Run this script again." >&2
  exit 1
fi

echo "==> Data directory"
sudo mkdir -p /var/lib/jouleflow
sudo chown "$USER": /var/lib/jouleflow

if [ ! -f /etc/jouleflow.env ]; then
  echo "==> Creating /etc/jouleflow.env"
  sudo tee /etc/jouleflow.env >/dev/null <<'EOF'
# Jouleflow settings. Restart after changes: sudo systemctl restart jouleflow
# The P1 meter is configured in the web app under Settings → P1 meter.
JOULEFLOW_TIMEZONE=Europe/Amsterdam
EOF
fi

echo "==> systemd service"
sed -e "s#@USER@#$USER#g" -e "s#@REPO@#$REPO#g" "$REPO/deploy/jouleflow.service" \
  | sudo tee /etc/systemd/system/jouleflow.service >/dev/null
sudo systemctl daemon-reload
sudo systemctl enable jouleflow >/dev/null
sudo systemctl restart jouleflow

echo "==> Done. Open http://$(hostname).local"
