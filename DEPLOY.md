# Confer deployment

## Quick run on the host

```bash
git clone https://github.com/rohansx/confer.git /opt/confer
cd /opt/confer
git checkout 399fa2e   # or main
CONFER_SIGNING_SECRET=<32-byte hex> \
APP_ORIGIN=http://<host>:5173 \
VIEW_ORIGIN=http://<host>:5174 \
  ./deploy.sh
```

- Exposes **5173** (dashboard + API) and **5174** (sandboxed view origin)
- Persistent volumes `confer-data` (SQLite) and `confer-blobs`
- `MAGIC_LINK_DEV_ECHO=1` so sign-in links appear in `docker logs confer` (set to 0 once SMTP is wired)

## What was tried via the Dokploy API

- ✅ Created project `confer` + compose `confer-stack` (id `1Ay9SkpstjB8n5k2TNSQa`)
- ✅ Pushed to `https://github.com/rohansx/confer` (commit `399fa2e`)
- ✅ `docker-compose.dokploy.yml` is in the repo, builds from the existing `Dockerfile`
- ❌ Every `compose.deploy` call ends in `composeStatus=error` in <8s, with no `errorMessage` returned by the API and no log endpoint exposed
- The deployment log file is on the host (`/etc/dokploy/logs/...`) and not reachable via the API
- Most likely cause: this Dokploy instance has `serversQuantity: 0` — no build/deploy server registered. (The existing cloakpipe compose also has `serverId: null`, so it isn't a strict requirement, but the install differs in some way I can't introspect.)
