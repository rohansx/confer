#!/usr/bin/env bash
# Confer — IP-only deploy script.
# Run on the Dokploy host (or any host that can reach the IP and expose 5173+5174).
# Usage:  CONFER_SIGNING_SECRET=<32-byte-hex> APP_ORIGIN=http://IP:5173 \
#         VIEW_ORIGIN=http://IP:5174 ./deploy.sh
set -euo pipefail

: "${CONFER_SIGNING_SECRET:?must set CONFER_SIGNING_SECRET to a 32-byte hex string}"
: "${APP_ORIGIN:?must set APP_ORIGIN e.g. http://187.127.185.75:5173}"
: "${VIEW_ORIGIN:?must set VIEW_ORIGIN e.g. http://187.127.185.75:5174}"

REPO="https://github.com/rohansx/confer.git"
APP_DIR="${APP_DIR:-/opt/confer}"

echo "==> cloning $REPO into $APP_DIR"
if [ -d "$APP_DIR" ]; then
  cd "$APP_DIR" && git pull --ff-only
else
  git clone --depth 1 "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

echo "==> building image (this takes a few minutes the first time)"
docker build -t confer:local -f Dockerfile .

echo "==> stopping any prior container"
docker rm -f confer 2>/dev/null || true

echo "==> starting container on 5173 (app) + 5174 (view)"
docker run -d --name confer --restart unless-stopped \
  -p 5173:5173 -p 5174:5174 \
  -e NODE_ENV=production \
  -e APP_ORIGIN="$APP_ORIGIN" \
  -e VIEW_ORIGIN="$VIEW_ORIGIN" \
  -e SIGNING_SECRET="$CONFER_SIGNING_SECRET" \
  -e DB_PATH=/app/data/confer.db \
  -e BLOB_DIR=/app/blobs \
  -e PORT=5173 -e VIEW_PORT=5174 \
  -e MAGIC_LINK_DEV_ECHO=1 \
  -v confer-data:/app/data \
  -v confer-blobs:/app/blobs \
  confer:local

echo "==> waiting for health"
for i in $(seq 1 30); do
  if curl -fsS "$APP_ORIGIN/health" >/dev/null; then
    echo "  ✓ healthy"
    break
  fi
  sleep 2
done

echo
echo "Confer running:"
echo "  Dashboard : $APP_ORIGIN/#/login"
echo "  View      : $VIEW_ORIGIN"
echo "  Health    : $APP_ORIGIN/health"
echo
echo "Tail logs:  docker logs -f confer"
