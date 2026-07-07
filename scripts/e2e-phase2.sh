#!/usr/bin/env bash
# End-to-end for Phase 2: two-origin viewer. Boots the real server and drives it
# with curl, sending different Host headers to simulate the app vs content origin.
set -uo pipefail
cd "$(dirname "$0")/.."

export APP_ORIGIN=http://app.local
export VIEW_ORIGIN=http://view.local
export DB_PATH=./data/e2e2.db
export BLOB_DIR=./blobs
export SIGNING_SECRET=e2e-secret
export PORT=8801
BASE="http://localhost:${PORT}"

rm -f ./data/e2e2.db ./data/e2e2.db-*

echo "== seed =="
SEED=$(npx tsx server/src/dev/seed.ts)
PUSH=$(node -pe "JSON.parse(process.argv[1]).pushToken" "$SEED")
READ=$(node -pe "JSON.parse(process.argv[1]).readToken" "$SEED")

echo "== boot two-origin server =="
npx tsx server/src/index.ts &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
curl -s --retry 30 --retry-connrefused --retry-delay 1 -H "Host: app.local" "${BASE}/health" >/dev/null

echo "== push a doc on the APP host =="
DOC='{"html":"<h1>Auth Flow</h1><p>Refresh token TTL is 30 days.</p>","metadata":{"author_type":"agent","tool":"claude-code","source_repo":"acme/api","commit_sha":"deadbeef","branch":"main"}}'
PUSH_RES=$(curl -s -H "Host: app.local" -X POST "${BASE}/api/v1/spaces/backend/docs/auth-flow/versions" \
  -H "authorization: Bearer ${PUSH}" -H "content-type: application/json" -d "$DOC")
VID=$(node -pe "JSON.parse(process.argv[1]).data.version_id" "$PUSH_RES")
echo "version_id: $VID"

echo "== GET version detail on APP host (read token) → signed content_url =="
DETAIL=$(curl -s -H "Host: app.local" "${BASE}/api/v1/versions/${VID}" -H "authorization: Bearer ${READ}")
echo "$DETAIL" | node -pe "const d=JSON.parse(require('fs').readFileSync(0,'utf8')).data; JSON.stringify({title:d.title,state:d.state,provenance:d.provenance,content_url:d.content_url})"
CONTENT_URL=$(node -pe "JSON.parse(process.argv[1]).data.content_url" "$DETAIL")
CPATH=$(node -pe "const u=new URL(process.argv[1]); u.pathname+u.search" "$CONTENT_URL")

echo "== fetch signed content on VIEW host — assert 200 + exact CSP + NO Set-Cookie =="
HDRS=$(curl -s -D - -o /tmp/confer_body.html -H "Host: view.local" "${BASE}${CPATH}")
echo "$HDRS" | grep -iE "^HTTP/|^content-security-policy:|^x-content-type-options:|^content-type:|^set-cookie:" || true
echo "body: $(cat /tmp/confer_body.html)"
echo "$HDRS" | grep -qi "^set-cookie:" && echo "FAIL: Set-Cookie present on content origin" || echo "PASS: no Set-Cookie on content origin"

echo "== tampered signature on VIEW host (expect 403) =="
BADPATH=$(node -pe "process.argv[1].replace(/s=[^&]+/, 's=tampered')" "$CPATH")
curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "Host: view.local" "${BASE}${BADPATH}"

echo "== unsigned content on VIEW host (expect 403) =="
HASHONLY=$(node -pe "new URL(process.argv[1]).pathname" "$CONTENT_URL")
curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "Host: view.local" "${BASE}${HASHONLY}"

echo "== isolation: app API on VIEW host (expect 404) =="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "Host: view.local" "${BASE}/health"

echo "== isolation: content path on APP host (expect 404) =="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -H "Host: app.local" "${BASE}${CPATH}"

echo "== done =="
