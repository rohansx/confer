#!/usr/bin/env bash
# End-to-end for Phase 7: the full v0 loop including diff, anchored comments,
# the carry-across-versions behavior, and notifications.
set -uo pipefail
cd "$(dirname "$0")/.."

export APP_ORIGIN=http://app.local
export VIEW_ORIGIN=http://view.local
export DB_PATH=./data/e2e7.db
export BLOB_DIR=./blobs
export SIGNING_SECRET=dev-only-change-me
export PORT=8792

rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm" 2>/dev/null
rm -rf "$BLOB_DIR"
mkdir -p data blobs

# 1) Seed
echo "== seed =="
SEED=$(npx tsx --env-file=.env server/src/dev/seed.ts)
PUSH_TOK=$(echo "$SEED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).pushToken))')
MCP_TOK=$(echo "$SEED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).mcpToken))')
SESSION=$(echo "$SEED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).sessionCookie))')
USER=$(echo "$SEED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).userId))')
echo "  push_tok=${PUSH_TOK:0:12}…  user=$USER"

# 2) Boot
echo "== boot server =="
npx tsx --env-file=.env server/src/index.ts > /tmp/confer-phase7.log 2>&1 &
PID=$!
trap "kill $PID 2>/dev/null" EXIT
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.3
done
curl -fsS "http://localhost:$PORT/health" >/dev/null || { echo "FAIL: server didn't start"; cat /tmp/confer-phase7.log; exit 1; }
echo "  server up on :$PORT"

# 3) Push v1, leave in_review, leave a comment anchored to a quote
echo "== push v1, comment anchored to 'Authentication flow' =="
PUSH1=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/versions" \
  -H "authorization: Bearer $PUSH_TOK" -H "content-type: application/json" \
  -d '{"html":"<h1>Authentication flow for our service</h1><p>It handles SSO and OIDC.</p>","metadata":{"commit_sha":"v1","source_repo":"acme/api","branch":"main"}}')
V1=$(echo "$PUSH1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.version_id))')
echo "  v1=$V1"

# 4) Approve v1 via REST
curl -fsS -X POST "http://localhost:$PORT/api/v1/versions/$V1/approve" -H "Cookie: $SESSION" >/dev/null
echo "  v1 approved"

# 5) Post a comment with an anchor on v1
COMMENT_RES=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/comments" \
  -H "Cookie: $SESSION" -H "content-type: application/json" \
  -d "{\"body\":\"needs a diagram\",\"version_id\":\"$V1\",\"anchor\":{\"quote\":\"SSO and OIDC\",\"prefix\":\"handles \",\"suffix\":\"\"}}")
CID=$(echo "$COMMENT_RES" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.id))')
echo "  comment=$CID"

# 6) List comments — anchor should resolve, NOT lost
echo "== list comments: anchor should resolve =="
LIST=$(curl -fsS "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/comments" -H "Cookie: $SESSION")
node -e '
const r = JSON.parse(`'"$LIST"'`);
if (r.data.comments.length !== 1) { console.error("FAIL: expected 1 comment, got", r.data.comments.length); process.exit(1); }
if (r.data.comments[0].anchor_resolved.lost) { console.error("FAIL: anchor should resolve"); process.exit(1); }
if (!r.data.comments[0].is_carried_over) { /* only one version exists; v1 was the latest when comment was made */ }
console.log("  ✓ anchor resolved, not lost");
'

# 7) Push v2 — change the wording, leave the quote intact
echo "== push v2 (reworded, quote still present) =="
PUSH2=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/versions" \
  -H "authorization: Bearer $PUSH_TOK" -H "content-type: application/json" \
  -d '{"html":"<h1>Authentication flow for our service</h1><p>It handles SSO and OIDC plus SAML.</p>","metadata":{"commit_sha":"v2","source_repo":"acme/api","branch":"main"}}')
V2=$(echo "$PUSH2" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.version_id))')
echo "  v2=$V2"
curl -fsS -X POST "http://localhost:$PORT/api/v1/versions/$V2/approve" -H "Cookie: $SESSION" >/dev/null
echo "  v2 approved (v1 now superseded)"

# 8) List comments again — anchor should STILL resolve (carried over)
echo "== list comments: anchor carries to v2 =="
LIST2=$(curl -fsS "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/comments" -H "Cookie: $SESSION")
node -e '
const r = JSON.parse(`'"$LIST2"'`);
if (r.data.comments.length !== 1) { console.error("FAIL: expected 1 comment, got", r.data.comments.length); process.exit(1); }
const c = r.data.comments[0];
if (c.anchor_resolved.lost) { console.error("FAIL: anchor should still resolve on v2"); process.exit(1); }
if (!c.is_carried_over) { console.error("FAIL: comment should be marked as carried_over"); process.exit(1); }
console.log("  ✓ anchor carried over to v2, is_carried_over=true");
'

# 9) Push v3 — REMOVE the quote entirely
echo "== push v3 (quote gone) =="
PUSH3=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/versions" \
  -H "authorization: Bearer $PUSH_TOK" -H "content-type: application/json" \
  -d '{"html":"<h1>Auth</h1><p>Completely rewritten.</p>","metadata":{"commit_sha":"v3","source_repo":"acme/api","branch":"main"}}')
V3=$(echo "$PUSH3" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.version_id))')
echo "  v3=$V3"

# 10) List comments — anchor should now be LOST
echo "== list comments: anchor should be LOST on v3 =="
LIST3=$(curl -fsS "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/comments" -H "Cookie: $SESSION")
node -e '
const r = JSON.parse(`'"$LIST3"'`);
const c = r.data.comments[0];
if (!c.anchor_resolved.lost) { console.error("FAIL: anchor should be LOST on v3"); process.exit(1); }
if (!c.is_carried_over) { console.error("FAIL: should still be carried over"); process.exit(1); }
console.log("  ✓ anchor lost, comment carried over (degrades gracefully)");
'

# 11) Diff between v2 and v3 (the rewording)
echo "== diff v2 → v3 =="
DIFF=$(curl -fsS "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/diff?from=2&to=3" -H "Cookie: $SESSION")
node -e '
const r = JSON.parse(`'"$DIFF"'`);
if (r.data.segments.length === 0) { console.error("FAIL: diff has no segments"); process.exit(1); }
const inserts = r.data.segments.filter((s) => s.op === "insert").map((s) => s.text).join("");
const dels = r.data.segments.filter((s) => s.op === "delete").map((s) => s.text).join("");
if (inserts.length === 0 && dels.length === 0) { console.error("FAIL: diff should have changes"); process.exit(1); }
console.log(`  ✓ diff returned ${r.data.segments.length} segments (inserts: ${inserts.length} chars, deletes: ${dels.length} chars)`);
'

# 12) Resolve the comment
echo "== resolve the comment =="
RESOLVE=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/comments/$CID/resolve" -H "Cookie: $SESSION")
node -e '
const r = JSON.parse(`'"$RESOLVE"'`);
if (!r.data.resolved_at) { console.error("FAIL: no resolved_at"); process.exit(1); }
console.log("  ✓ resolved");
'
# Default list excludes resolved.
LIST_DEFAULT=$(curl -fsS "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/comments" -H "Cookie: $SESSION")
node -e '
const r = JSON.parse(`'"$LIST_DEFAULT"'`);
if (r.data.comments.length !== 0) { console.error("FAIL: default list should exclude resolved"); process.exit(1); }
console.log("  ✓ default list excludes resolved (0 visible)");
'
# include_resolved=true brings it back.
LIST_ALL=$(curl -fsS "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/comments?include_resolved=true" -H "Cookie: $SESSION")
node -e '
const r = JSON.parse(`'"$LIST_ALL"'`);
if (r.data.comments.length !== 1) { console.error("FAIL: include_resolved should show it"); process.exit(1); }
if (!r.data.comments[0].resolved_at) { console.error("FAIL: comment should have resolved_at"); process.exit(1); }
console.log("  ✓ include_resolved=true shows it with resolved_at");
'

# 13) Verify notifications fired (console transport → stdout in server log)
echo "== notifications in server log =="
if grep -q "NOTIFY.*version.pushed" /tmp/confer-phase7.log; then echo "  ✓ version.pushed"; else echo "  FAIL: missing version.pushed"; exit 1; fi
if grep -q "NOTIFY.*version.approved" /tmp/confer-phase7.log; then echo "  ✓ version.approved"; else echo "  FAIL: missing version.approved"; exit 1; fi
if grep -q "NOTIFY.*comment.created" /tmp/confer-phase7.log; then echo "  ✓ comment.created"; else echo "  FAIL: missing comment.created"; exit 1; fi
NOTIFY_COUNT=$(grep -c "^NOTIFY " /tmp/confer-phase7.log || true)
echo "  total notifications: $NOTIFY_COUNT"
[ "$NOTIFY_COUNT" -ge 5 ] || { echo "FAIL: expected ≥5 NOTIFY lines"; exit 1; }
echo "  ✓"

# 14) Approved-only invariant still holds via MCP
echo "== MCP: list_docs with mcp-only returns only the latest approved (v3) =="
RESULT=$(npx tsx scripts/mcp-call.ts "http://localhost:$PORT/mcp" "$MCP_TOK" list_docs '{"space":"backend"}')
node -e '
const r = JSON.parse(`'"$RESULT"'`);
if (r.included_unapproved !== false) { console.error("FAIL: included_unapproved should be false"); process.exit(1); }
// v1, v2, v3 — only the latest approved (v3) is exposed by list_docs per doc.
if (r.count !== 1) { console.error("FAIL: expected 1 doc, got", r.count); process.exit(1); }
if (r.docs[0].state !== "approved") { console.error("FAIL: should be approved"); process.exit(1); }
console.log("  ✓ approved-only invariant holds end to end");
'

echo ""
echo "ALL PHASE-7 E2E ASSERTIONS PASSED"
