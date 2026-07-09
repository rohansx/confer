# Pure-bash, no python heredocs. Step-by-step.

# 1. Save env block to a file (no quoting issues)
cat > /tmp/env-block.txt <<'EOF'
APP_ORIGIN=https://tryconfer.com
VIEW_ORIGIN=https://view.tryconfer.com
CONFER_SIGNING_SECRET=6bb513bca3cdf0bc6ad13c28ac1044e2b01e8d06363144644c4544b1b9410020
NODE_ENV=production
R2_BUCKET=confer-blobs
R2_ENDPOINT=https://cbe9988f4cc5fbd9633d26d052609bc3.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=6496f04651161f2fe0f018f20fe71cb7
R2_SECRET_ACCESS_KEY=194c43761234cba545f439ed2f6e35cda9edf0ca4a115235153495b523db061e
R2_REGION=auto
MAGIC_LINK_DEV_ECHO=1
EOF

echo "=== env block saved ==="
cat /tmp/env-block.txt

# 2. Build the JSON payload with python (single line, no heredoc)
KEY='glawKDuWOSwntkWPziRWNivGiqKkVdWYYvfQJFuotZiWIxskLegRQCioycExahPU'
COMP_ID='1Ay9SkpstjB8n5k2TNSQa'

python3 -c "
import json
env = open('/tmp/env-block.txt').read()
p = {
  'composeId':'$COMP_ID',
  'sourceType':'git',
  'customGitUrl':'git@github.com:rohansx/confer.git',
  'customGitBranch':'main',
  'customGitSSHKeyId':'4VP-Nat2_TGBauq9zs1iC',
  'composeType':'docker-compose',
  'composePath':'./docker-compose.yml',
  'autoDeploy':True,
  'env':env,
}
open('/tmp/payload.json','w').write(json.dumps(p))
print('payload size:', len(json.dumps(p)))
"

# 3. Push to Dokploy
echo
echo "=== pushing to Dokploy ==="
curl -sS -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -X POST http://187.127.185.75:3000/api/compose.update \
  -d @/tmp/payload.json | head -c 200
echo

# 4. Verify the env block is set
echo
echo "=== env stored in Dokploy ==="
curl -sS -H "x-api-key: $KEY" "http://187.127.185.75:3000/api/compose.one?composeId=$COMP_ID" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin).get("env",""))'

# 5. Trigger deploy
echo
echo "=== triggering redeploy ==="
curl -sS -H "x-api-key: $KEY" -H "Content-Type: application/json" \
  -X POST http://187.127.185.75:3000/api/compose.deploy \
  -d "{\"composeId\":\"$COMP_ID\"}" | head -c 200
echo

# 6. Wait for deploy (5 min budget)
echo
echo "=== waiting up to 5 min for deploy ==="
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30; do
  sleep 10
  S=$(curl -sS -H "x-api-key: $KEY" "http://187.127.185.75:3000/api/compose.one?composeId=$COMP_ID" \
    | python3 -c "import sys,json; d=json.load(sys.stdin); ds=d.get('deployments',[]); last=ds[-1] if ds else None; print(d.get('composeStatus'),'latest='+(last.get('status','?') if last else '?'),(last.get('finishedAt','?')[-10:] if last and last.get('finishedAt') else '...'))")
  echo "  t=${i}*10s: $S"
  if echo "$S" | grep -qE "latest= (error|done)"; then break; fi
done

# 7. Show the boot log of the latest deploy
echo
echo "=== boot log (R2 line should appear here) ==="
LATEST=$(ls -t /etc/dokploy/logs/compose-parse-optical-array-vygtz7/ | head -1)
echo "log: /etc/dokploy/logs/compose-parse-optical-array-vygtz7/$LATEST"
echo
echo "--- last 30 lines ---"
tail -30 "/etc/dokploy/logs/compose-parse-optical-array-vygtz7/$LATEST"
