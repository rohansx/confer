#!/usr/bin/env bash
# Proves the full browser data path for the review page WITHOUT a headless
# browser: Vite serves the SPA (:3000) and proxies /api to the app origin
# (:5173); the iframe's content comes cross-origin from the view origin (:5174)
# with the strict CSP. vite build already proved the React compiles.
set -uo pipefail
cd "$(dirname "$0")/.."

export APP_ORIGIN=http://localhost:5173
export VIEW_ORIGIN=http://localhost:5174
export DB_PATH=./data/dev2.db
export BLOB_DIR=./blobs
export SIGNING_SECRET=dev-secret

rm -f ./data/dev2.db ./data/dev2.db-wal ./data/dev2.db-shm

echo "== seed =="
SEED=$(npx tsx server/src/dev/seed.ts)
PUSH=$(node -pe "JSON.parse(process.argv[1]).pushToken" "$SEED")
READ=$(node -pe "JSON.parse(process.argv[1]).readToken" "$SEED")

echo "== start two-origin server (:5173 app, :5174 view) =="
npx tsx server/src/dev/serve-both.ts >/tmp/confer-srv.log 2>&1 &
SRV=$!
echo "== start vite dev (:3000) =="
npm run dev:web >/tmp/confer-vite.log 2>&1 &
VITE=$!
trap 'kill $SRV $VITE 2>/dev/null' EXIT

curl -s --retry 40 --retry-connrefused --retry-delay 1 "http://localhost:5173/health" >/dev/null
echo "app up: $(curl -s http://localhost:5173/health)"

echo "== push a version via app origin =="
DOC='{"html":"<h1>Auth Flow</h1><p>Refresh token TTL is 30 days.</p>","metadata":{"author_type":"agent","tool":"claude-code","source_repo":"acme/api","commit_sha":"deadbeef","branch":"main"}}'
VID=$(node -pe "JSON.parse(process.argv[1]).data.version_id" "$(curl -s -X POST http://localhost:5173/api/v1/spaces/backend/docs/auth-flow/versions -H "authorization: Bearer ${PUSH}" -H content-type:application/json -d "$DOC")")
echo "version_id: $VID"
echo "REVIEW URL: http://localhost:4321/?v=${VID}&token=${READ}"

echo "== wait for vite, then GET the SPA shell through :3000 =="
curl -s --retry 40 --retry-connrefused --retry-delay 1 "http://localhost:4321/" >/tmp/confer-spa.html
grep -q 'id="root"' /tmp/confer-spa.html && echo "PASS: SPA shell served (has #root)" || echo "FAIL: SPA shell missing"
grep -q 'src="/src/main.tsx"' /tmp/confer-spa.html && echo "PASS: SPA entry script present" || echo "FAIL: entry script missing"

echo "== the browser's data fetch: /api proxied through :3000 =="
DETAIL=$(curl -s "http://localhost:4321/api/v1/versions/${VID}" -H "authorization: Bearer ${READ}")
CONTENT_URL=$(node -pe "JSON.parse(process.argv[1]).data.content_url" "$DETAIL")
echo "content_url (iframe src): $CONTENT_URL"
echo "$CONTENT_URL" | grep -q "http://localhost:5174/c/" && echo "PASS: iframe src points at the view origin" || echo "FAIL: wrong iframe origin"

echo "== the iframe's cross-origin content load from :5174 =="
CPATH=$(node -pe "const u=new URL(process.argv[1]); u.pathname+u.search" "$CONTENT_URL")
HDRS=$(curl -s -D - -o /tmp/confer-frame.html "http://localhost:5174${CPATH}")
echo "$HDRS" | grep -iE "^HTTP/|^content-security-policy:"
echo "$HDRS" | grep -qi "^set-cookie:" && echo "FAIL: Set-Cookie on content origin" || echo "PASS: no Set-Cookie on content origin"
echo "frame body: $(cat /tmp/confer-frame.html)"
echo "== done =="
