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

echo "==> Data directory"
sudo mkdir -p /var/lib/jouleflow
sudo chown "$USER": /var/lib/jouleflow

if [ ! -f /etc/jouleflow.env ]; then
  echo "==> Creating /etc/jouleflow.env"
  sudo tee /etc/jouleflow.env >/dev/null <<'EOF'
# Jouleflow settings. Restart after changes: sudo systemctl restart jouleflow
JOULEFLOW_P1_URL=http://192.168.3.18
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
