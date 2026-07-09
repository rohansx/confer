#!/usr/bin/env bash
# Confer — HTTPS deploy via Traefik on tryconfer.com
# Run on the host. Requires:
#   - CONFER_SIGNING_SECRET  (32-byte hex)
#   - APP_ORIGIN             (e.g. https://tryconfer.com)
#   - VIEW_ORIGIN            (e.g. https://view.tryconfer.com)
#   - The host's Traefik (Dokploy-managed) is on the dokploy-network overlay
set -euo pipefail

: "${CONFER_SIGNING_SECRET:?must set CONFER_SIGNING_SECRET to a 32-byte hex string}"
: "${APP_ORIGIN:?must set APP_ORIGIN, e.g. https://tryconfer.com}"
: "${VIEW_ORIGIN:?must set VIEW_ORIGIN, e.g. https://view.tryconfer.com}"

REPO="https://github.com/rohansx/confer.git"
APP_DIR="${APP_DIR:-/opt/confer}"

echo "==> syncing $REPO into $APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  cd "$APP_DIR"
  git pull --ff-only
else
  git clone --depth 1 "$REPO" "$APP_DIR"
  cd "$APP_DIR"
fi

echo "==> removing old standalone confer container (if any)"
docker rm -f confer 2>/dev/null || true

echo "==> building image"
docker build -t confer:local -f Dockerfile .

echo "==> ensuring dokploy-network exists"
docker network inspect dokploy-network >/dev/null 2>&1 || {
  echo "  dokploy-network missing, creating it (you might need to re-add Traefik access)"
  docker network create --driver overlay dokploy-network || docker network create dokploy-network
}

echo "==> writing .env for compose"
cat > .env <<EOF
CONFER_SIGNING_SECRET=$CONFER_SIGNING_SECRET
APP_ORIGIN=$APP_ORIGIN
VIEW_ORIGIN=$VIEW_ORIGIN
MAGIC_LINK_DEV_ECHO=${MAGIC_LINK_DEV_ECHO:-1}
EOF

# Stand up as a swarm stack so Traefik's Docker provider sees the labels and routes.
# Falls back to docker compose if swarm isn't initialized.
if docker info 2>/dev/null | grep -q "Swarm: active"; then
  echo "==> deploying as swarm stack (Traefik will pick up labels)"
  docker stack deploy -c docker-compose.yml confer
  echo "==> waiting for service to be ready"
  for i in $(seq 1 30); do
    STATE=$(docker service ls --filter name=confer_confer --format '{{.Replicas}} {{.Image}}' | head -1)
    echo "  t=${i}*2s: $STATE"
    case "$STATE" in
      "1/1"*) break ;;
    esac
    sleep 2
  done
else
  echo "==> swarm not active — falling back to docker compose up"
  docker compose up -d
  echo "==> waiting for container"
  for i in $(seq 1 30); do
    STATE=$(docker inspect confer --format '{{.State.Status}}' 2>/dev/null || echo "missing")
    echo "  t=${i}*2s: $STATE"
    [ "$STATE" = "running" ] && break
    sleep 2
  done
fi

echo
echo "Confer is up at:"
echo "  $APP_ORIGIN/#/login"
echo "  $VIEW_ORIGIN"
echo
echo "Note: HTTPS (Let's Encrypt) is issued by the host's Traefik; may take"
echo "10-30s after first request. If it fails, check:"
echo "  docker service logs confer_confer"
echo "  curl -i -H 'Host: tryconfer.com' http://127.0.0.1/  (on host)"