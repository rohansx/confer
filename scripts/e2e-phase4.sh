#!/usr/bin/env bash
# End-to-end for Phase 4: MCP server, the consumption side of the loop.
# Boots the real server, pushes + approves content via REST, then drives the
# MCP endpoint over streamable HTTP. Asserts the approved-only invariant.
set -uo pipefail
cd "$(dirname "$0")/.."

export APP_ORIGIN=http://app.local
export VIEW_ORIGIN=http://view.local
export DB_PATH=./data/e2e4.db
export BLOB_DIR=./blobs
export SIGNING_SECRET=dev-only-change-me
export PORT=8790

rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm" 2>/dev/null
rm -rf "$BLOB_DIR"
mkdir -p data blobs

# 1) Seed
echo "== seed =="
SEED=$(npx tsx --env-file=.env server/src/dev/seed.ts)
PUSH_TOK=$(echo "$SEED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).pushToken))')
MCP_TOK=$(echo "$SEED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).mcpToken))')
MCP_ALL_TOK=$(echo "$SEED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).mcpPlusUnapprovedToken))')
SESSION=$(echo "$SEED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).sessionCookie))')
echo "  push_tok=${PUSH_TOK:0:12}…  mcp_tok=${MCP_TOK:0:12}…  mcp_all_tok=${MCP_ALL_TOK:0:12}…"

# 2) Start the server in the background
echo "== boot server =="
npx tsx --env-file=.env server/src/index.ts > /tmp/confer-phase4.log 2>&1 &
PID=$!
trap "kill $PID 2>/dev/null" EXIT
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.3
done
curl -fsS "http://localhost:$PORT/health" >/dev/null || { echo "FAIL: server didn't start"; cat /tmp/confer-phase4.log; exit 1; }
echo "  server up on :$PORT"

# 3) Push two versions; approve v1, leave v2 in_review.
echo "== push + approve v1, leave v2 in_review =="
PUSH1=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/versions" \
  -H "authorization: Bearer $PUSH_TOK" -H "content-type: application/json" \
  -d '{"html":"<h1>Authentication flow production</h1>","metadata":{"commit_sha":"v1sha","source_repo":"acme/api","branch":"main"}}')
V1=$(echo "$PUSH1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.version_id))')
curl -fsS -X POST "http://localhost:$PORT/api/v1/versions/$V1/approve" -H "Cookie: $SESSION" >/dev/null
PUSH2=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/versions" \
  -H "authorization: Bearer $PUSH_TOK" -H "content-type: application/json" \
  -d '{"html":"<h1>Authentication flow draft v2</h1>","metadata":{"commit_sha":"v2sha","source_repo":"acme/api","branch":"main"}}')
V2=$(echo "$PUSH2" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.version_id))')
echo "  v1 (approved)=$V1  v2 (in_review)=$V2"

# 4) MCP no token - 401
echo "== mcp without token (expect 401) =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$PORT/mcp" \
  -H "content-type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
[ "$CODE" = "401" ] || { echo "FAIL: expected 401 got $CODE"; exit 1; }
echo "  ✓ 401"

# 5) Push-only token - 403
echo "== push token cannot use MCP (expect 403) =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$PORT/mcp" \
  -H "content-type: application/json" -H "authorization: Bearer $PUSH_TOK" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
[ "$CODE" = "403" ] || { echo "FAIL: expected 403 got $CODE"; exit 1; }
echo "  ✓ 403"

# 6) THE INVARIANT: search_docs with mcp-only token returns only approved
echo "== search_docs mcp-only → approved only =="
RESULT=$(npx tsx scripts/mcp-call.ts "http://localhost:$PORT/mcp" "$MCP_TOK" search_docs '{"query":"Authentication"}')
node -e '
const r = JSON.parse(`'"$RESULT"'`);
if (r.included_unapproved !== false) { console.error("FAIL: included_unapproved should be false"); process.exit(1); }
if (r.count !== 1) { console.error("FAIL: expected 1 hit, got", r.count); process.exit(1); }
if (r.hits[0].state !== "approved") { console.error("FAIL: state should be approved, got", r.hits[0].state); process.exit(1); }
if (r.hits[0].approved_by == null) { console.error("FAIL: approved_by missing"); process.exit(1); }
console.log("  ✓ mcp-only sees only approved, count=1");
'

# 7) The override flag with mcp-only token is silently ignored
echo "== search_docs mcp-only include_unapproved=true → silently ignored =="
RESULT=$(npx tsx scripts/mcp-call.ts "http://localhost:$PORT/mcp" "$MCP_TOK" search_docs '{"query":"Authentication","include_unapproved":true}')
node -e '
const r = JSON.parse(`'"$RESULT"'`);
if (r.included_unapproved !== false) { console.error("FAIL: included_unapproved should be false (token lacks scope)"); process.exit(1); }
if (r.count !== 1) { console.error("FAIL: still 1 hit, not 2"); process.exit(1); }
console.log("  ✓ flag ignored; only approved returned");
'

# 8) mcp+unapproved token: include_unapproved surfaces the in_review version
echo "== search_docs mcp+unapproved → all states =="
RESULT=$(npx tsx scripts/mcp-call.ts "http://localhost:$PORT/mcp" "$MCP_ALL_TOK" search_docs '{"query":"Authentication","include_unapproved":true}')
node -e '
const r = JSON.parse(`'"$RESULT"'`);
if (r.included_unapproved !== true) { console.error("FAIL: included_unapproved should be true"); process.exit(1); }
if (r.count !== 2) { console.error("FAIL: expected 2 hits, got", r.count); process.exit(1); }
const states = new Set(r.hits.map((h: any) => h.state));
if (!states.has("approved") || !states.has("in_review")) { console.error("FAIL: states should include both", states); process.exit(1); }
console.log("  ✓ mcp+unapproved sees approved + in_review");
'

# 9) get_doc with mcp-only returns the approved (older) version
echo "== get_doc mcp-only auth-flow → approved v1 =="
RESULT=$(npx tsx scripts/mcp-call.ts "http://localhost:$PORT/mcp" "$MCP_TOK" get_doc '{"space":"backend","slug":"auth-flow"}')
node -e '
const r = JSON.parse(`'"$RESULT"'`);
if (r.type !== "confer_doc") { console.error("FAIL: not a confer_doc envelope"); process.exit(1); }
if (r.metadata.state !== "approved") { console.error("FAIL: should be approved, got", r.metadata.state); process.exit(1); }
if (r.metadata.version_number !== 1) { console.error("FAIL: should be v1, got v" + r.metadata.version_number); process.exit(1); }
if (!r.content.includes("production")) { console.error("FAIL: HTML should match v1"); process.exit(1); }
if (!r.note || !r.note.includes("data")) { console.error("FAIL: data envelope note missing"); process.exit(1); }
console.log("  ✓ envelope OK, v1 (approved) returned, v2 (in_review) hidden");
'

# 10) push_doc over MCP creates an in_review version (NEVER approved)
echo "== push_doc via MCP creates in_review =="
RESULT=$(npx tsx scripts/mcp-call.ts "http://localhost:$PORT/mcp" "$MCP_TOK" push_doc '{"space":"backend","slug":"fresh","html":"<h1>Brand new</h1>","title":"Fresh","metadata":{"commit_sha":"freshsha","source_repo":"acme/api"}}')
node -e '
const r = JSON.parse(`'"$RESULT"'`);
if (r.state !== "in_review") { console.error("FAIL: push_doc must produce in_review, got", r.state); process.exit(1); }
if (!r.version_id || !r.review_url) { console.error("FAIL: missing version_id or review_url"); process.exit(1); }
console.log("  ✓ push_doc state=in_review, never approved");
'

echo ""
echo "ALL PHASE-4 E2E ASSERTIONS PASSED"
