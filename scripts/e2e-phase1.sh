#!/usr/bin/env bash
# End-to-end smoke test for Phase 1: boot the real server, drive it with curl.
set -uo pipefail
cd "$(dirname "$0")/.."

export APP_ORIGIN=http://localhost:5173
export VIEW_ORIGIN=http://localhost:5174
export DB_PATH=./data/e2e.db
export BLOB_DIR=./blobs
export SIGNING_SECRET=dev-only-change-me
export PORT=8799
BASE="http://localhost:${PORT}"

# Fresh DB
rm -f ./data/e2e.db ./data/e2e.db-*

echo "== seed =="
SEED=$(npx tsx server/src/dev/seed.ts)
echo "$SEED"
TOKEN=$(node -pe "JSON.parse(process.argv[1]).pushToken" "$SEED")

echo "== boot server =="
npx tsx server/src/index.ts &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT

# Wait for readiness without sleep
curl -s --retry 30 --retry-connrefused --retry-delay 1 "${BASE}/health" >/dev/null

echo "== health =="
curl -s "${BASE}/health"; echo

URL="${BASE}/api/v1/spaces/backend/docs/auth-flow/versions"
DOC='{"html":"<h1>Auth Flow</h1><p>Refresh token TTL is 30 days.</p>","metadata":{"author_type":"agent","tool":"claude-code","source_repo":"acme/api","commit_sha":"deadbeef","branch":"main"}}'

echo "== push #1 (expect 201) =="
R1=$(curl -s -w "\nHTTP %{http_code}" -X POST "$URL" -H "authorization: Bearer ${TOKEN}" -H "content-type: application/json" -d "$DOC")
echo "$R1"
V1=$(node -pe "try{JSON.parse(process.argv[1].split('\nHTTP')[0]).data.version_id}catch(e){''}" "$R1")

echo "== push #2 identical (expect same version_id — idempotent) =="
R2=$(curl -s -X POST "$URL" -H "authorization: Bearer ${TOKEN}" -H "content-type: application/json" -d "$DOC")
echo "$R2"
V2=$(node -pe "JSON.parse(process.argv[1]).data.version_id" "$R2")

echo "== push without token (expect 401) =="
curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$URL" -H "content-type: application/json" -d "$DOC"

echo "== oversized body (expect 413) =="
BIG=$(node -pe "JSON.stringify({html:'<h1>'+'a'.repeat(5*1024*1024+1)+'</h1>',metadata:{}})")
printf '%s' "$BIG" | curl -s -o /dev/null -w "HTTP %{http_code}\n" -X POST "$URL" -H "authorization: Bearer ${TOKEN}" -H "content-type: application/json" --data-binary @-

echo "== verify persistence (blob on disk + FTS row + version state) =="
node --input-type=module -e "
import { openDb } from './server/src/db/client.ts';
const db = openDb(process.env.DB_PATH);
const v = db.\$client.prepare('SELECT id, number, state, commit_sha, blob_hash FROM versions').all();
const fts = db.\$client.prepare(\"SELECT count(*) c FROM docs_fts WHERE text MATCH 'refresh'\").get();
console.log('versions:', JSON.stringify(v));
console.log('fts refresh matches:', fts.c);
import { existsSync } from 'node:fs';
import { join } from 'node:path';
const h = v[0].blob_hash;
console.log('blob exists:', existsSync(join(process.env.BLOB_DIR, h.slice(0,2), h.slice(2,4), h)));
" 2>&1 | grep -v ExperimentalWarning

echo "== assert idempotency =="
if [ -n "$V1" ] && [ "$V1" = "$V2" ]; then echo "PASS idempotent: $V1"; else echo "FAIL idempotent: '$V1' vs '$V2'"; fi

echo "== done =="
