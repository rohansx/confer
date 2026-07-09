#!/usr/bin/env bash
# Push R2 env vars into Dokploy's confer-stack compose.
# Run on the host (or anywhere that can reach http://187.127.185.75:3000).
set -e
KEY="${DOKPLOY_API_KEY:-REPLACE_WITH_YOUR_API_KEY}"
COMP_ID='1Ay9SkpstjB8n5k2TNSQa'
SIGNING_SECRET='6bb513bca3cdf0bc6ad13c28ac1044e2b01e8d06363144644c4544b1b9410020'

cat > /tmp/env-block.txt <<EOF
APP_ORIGIN=https://tryconfer.com
VIEW_ORIGIN=https://view.tryconfer.com
CONFER_SIGNING_SECRET=${SIGNING_SECRET}
NODE_ENV=production
R2_BUCKET=confer-blobs
R2_ENDPOINT=https://cbe9988f4cc5fbd9633d26d052609bc3.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=6496f04651161f2fe0f018f20fe71cb7
R2_SECRET_ACCESS_KEY=194c43761234cba545f439ed2f6e35cda9edf0ca4a115235153495b523db061e
R2_REGION=auto
MAGIC_LINK_DEV_ECHO=1
EOF

python3 - <<PY
import json
with open('/tmp/env-block.txt') as f: env=f.read()
print(json.dumps({
  'composeId': '$COMP_ID',
  'sourceType': 'git',
  'customGitUrl': 'git@github.com:rohansx/confer.git',
  'customGitBranch': 'main',
  'customGitSSHKeyId': '4VP-Nat2_TGBauq9zs1iC',
  'composeType': 'docker-compose',
  'composePath': './docker-compose.yml',
  'autoDeploy': True,
  'env': env,
}))
PY > /tmp/payload.json

echo "=== pushing env to Dokploy ==="
curl -sS -H "x-api-key: ${KEY}" -H "Content-Type: application/json" \
  -X POST http://187.127.185.75:3000/api/compose.update \
  -d @/tmp/payload.json | head -c 200
echo
echo
echo "=== verifying env was set ==="
curl -sS -H "x-api-key: ${KEY}" "http://187.127.185.75:3000/api/compose.one?composeId=$COMP_ID" \
  | python3 -c "import sys,json; print(json.load(sys.stdin).get('env',''))"
echo
echo "=== triggering redeploy ==="
curl -sS -H "x-api-key: ${KEY}" -H "Content-Type: application/json" \
  -X POST http://187.127.185.75:3000/api/compose.deploy \
  -d "{\"composeId\":\"$COMP_ID\"}" | head -c 200
echo
echo
echo "=== watching for completion ==="
for i in $(seq 1 30); do
  sleep 6
  S=$(curl -sS -H "x-api-key: ${KEY}" "http://187.127.185.75:3000/api/compose.one?composeId=$COMP_ID" \
    | python3 -c "
import sys,json
d=json.load(sys.stdin)
ds=d.get('deployments',[])
last=ds[-1] if ds else None
print(d.get('composeStatus'),'latest='+(last.get('status','?') if last else '?'),(last.get('finishedAt','?')[-10:] if last and last.get('finishedAt') else '...'))
")
  echo "  t=${i}*6s: $S"
  if [[ "$S" == *"latest= error"* || "$S" == *"latest= done"* ]]; then break; fi
done

echo
echo "=== boot log of latest container (look for R2 line) ==="
LATEST_LOG=\$(ls -t /etc/dokploy/logs/compose-parse-optical-array-vygtz7/ | head -1)
grep -E "confer blobs|R2|confer-blobs|5173|5174" "/etc/dokploy/logs/compose-parse-optical-array-vygtz7/\$LATEST_LOG" | head -10
