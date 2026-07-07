#!/usr/bin/env bash
# End-to-end for Phase 3: the complete review loop.
# Pushes 3 versions; approves v1, approves v2 (supersedes v1), rejects v3.
# Verifies the history endpoint reflects the state-machine + the audit trail.
set -uo pipefail
cd "$(dirname "$0")/.."

export APP_ORIGIN=http://app.local
export VIEW_ORIGIN=http://view.local
export DB_PATH=./data/e2e3.db
export BLOB_DIR=./blobs
export SIGNING_SECRET=dev-only-change-me
export PORT=8789

rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm" 2>/dev/null
rm -rf "$BLOB_DIR"
mkdir -p data blobs

# 1) Seed
echo "== seed =="
SEED=$(npx tsx --env-file=.env server/src/dev/seed.ts)
PUSH_TOK=$(echo "$SEED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).pushToken))')
SESSION=$(echo "$SEED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).sessionCookie))')
ORG=$(echo "$SEED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).orgId))')
USER=$(echo "$SEED" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).userId))')
echo "  org=$ORG  user=$USER  push_tok=${PUSH_TOK:0:12}…"

# 2) Start the server in the background
echo "== boot server =="
npx tsx --env-file=.env server/src/index.ts > /tmp/confer-phase3.log 2>&1 &
PID=$!
trap "kill $PID 2>/dev/null" EXIT
for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -fsS "http://localhost:$PORT/health" >/dev/null 2>&1 && break
  sleep 0.3
done
curl -fsS "http://localhost:$PORT/health" >/dev/null || { echo "FAIL: server didn't start"; cat /tmp/confer-phase3.log; exit 1; }
echo "  server up on :$PORT"

# 3) Push v1
echo "== push v1 =="
PUSH1=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/versions" \
  -H "authorization: Bearer $PUSH_TOK" -H "content-type: application/json" \
  -d '{"html":"<h1>Auth v1</h1>","metadata":{"commit_sha":"v1sha","branch":"main","author":"ci"}}')
V1=$(echo "$PUSH1" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.version_id))')
echo "  v1 = $V1"

# 4) whoami should reflect the session
echo "== whoami =="
ME=$(curl -fsS "http://localhost:$PORT/api/v1/auth/whoami" -H "Cookie: $SESSION")
echo "  $ME"

# 5) Push/read tokens CANNOT approve (negative test)
echo "== push token cannot approve (expect 403) =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$PORT/api/v1/versions/$V1/approve" \
  -H "authorization: Bearer $PUSH_TOK")
[ "$CODE" = "403" ] || { echo "FAIL: expected 403 got $CODE"; exit 1; }
echo "  ✓ 403"

# 6) Approve v1 (owner session)
echo "== approve v1 =="
A1=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/versions/$V1/approve" -H "Cookie: $SESSION")
echo "  $A1"

# 7) Approve v1 again is 409
echo "== approve v1 again (expect 409) =="
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://localhost:$PORT/api/v1/versions/$V1/approve" -H "Cookie: $SESSION")
[ "$CODE" = "409" ] || { echo "FAIL: expected 409 got $CODE"; exit 1; }
echo "  ✓ 409"

# 8) Push v2
echo "== push v2 =="
PUSH2=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/versions" \
  -H "authorization: Bearer $PUSH_TOK" -H "content-type: application/json" \
  -d '{"html":"<h1>Auth v2</h1>","metadata":{"commit_sha":"v2sha","branch":"main","author":"ci"}}')
V2=$(echo "$PUSH2" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.version_id))')
echo "  v2 = $V2"

# 9) Approve v2 — should supersede v1
echo "== approve v2 (supersedes v1) =="
A2=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/versions/$V2/approve" -H "Cookie: $SESSION")
SUP=$(echo "$A2" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.supersededId))')
[ "$SUP" = "$V1" ] || { echo "FAIL: supersededId should be $V1, got $SUP"; exit 1; }
echo "  ✓ v1 superseded"

# 10) Push v3
echo "== push v3 =="
PUSH3=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/versions" \
  -H "authorization: Bearer $PUSH_TOK" -H "content-type: application/json" \
  -d '{"html":"<h1>Auth v3 (broken)</h1>","metadata":{"commit_sha":"v3sha","branch":"feature","author":"ci"}}')
V3=$(echo "$PUSH3" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.version_id))')
echo "  v3 = $V3"

# 11) Reject v3 with a reason
echo "== reject v3 =="
RJ=$(curl -fsS -X POST "http://localhost:$PORT/api/v1/versions/$V3/reject" \
  -H "Cookie: $SESSION" -H "content-type: application/json" \
  -d '{"reason":"out of scope"}')
echo "  $RJ"

# 12) History reflects everything
echo "== history =="
H=$(curl -fsS "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow/versions" -H "Cookie: $SESSION")
node -e '
const h = JSON.parse(`'"$H"'`).data;
if (h.versions.length !== 3) { console.error("FAIL: expected 3 versions, got", h.versions.length); process.exit(1); }
const states = h.versions.map(v => v.state);
console.log("  states (newest first):", states);
if (states[0] !== "rejected")  { console.error("FAIL: v3 should be rejected"); process.exit(1); }
if (states[1] !== "approved")  { console.error("FAIL: v2 should be approved");  process.exit(1); }
if (states[2] !== "superseded"){ console.error("FAIL: v1 should be superseded");process.exit(1); }
if (!h.is_owner) { console.error("FAIL: session should be flagged as owner"); process.exit(1); }
const v1 = h.versions[2];
if (v1.approvedBy !== process.env.USER) { console.error("FAIL: v1 should show approver"); process.exit(1); }
const v3 = h.versions[0];
if (!v3.rejectReason || v3.rejectReason !== "out of scope") { console.error("FAIL: v3 should show reject reason"); process.exit(1); }
console.log("  ✓ all assertions passed");
' USER="$USER"

# 13) SQLite invariant: exactly one approved
echo "== invariant: exactly one approved =="
APPROVED_COUNT=$(npx tsx scripts/check-approved.ts ./data/e2e3.db 2>/dev/null | tail -1)
[ "$APPROVED_COUNT" = "1" ] || { echo "FAIL: expected 1 approved, got $APPROVED_COUNT"; exit 1; }
echo "  ✓ exactly 1 approved version"

# 14) Latest approved endpoint
echo "== latest approved =="
LATEST=$(curl -fsS "http://localhost:$PORT/api/v1/spaces/backend/docs/auth-flow" -H "Cookie: $SESSION")
LID=$(echo "$LATEST" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log(JSON.parse(d).data.latest_approved.id))')
[ "$LID" = "$V2" ] || { echo "FAIL: latest should be $V2, got $LID"; exit 1; }
echo "  ✓ v2 is the latest approved"

echo ""
echo "ALL PHASE-3 E2E ASSERTIONS PASSED"
