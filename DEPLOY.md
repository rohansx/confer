# Confer deployment

## What's done ✅

- Source pushed to **https://github.com/rohansx/confer** (commit `73537cc`)
- **Dokploy project** `confer` created (id `yV4_7KZs9zxmbh7jK5gwU`)
- **Dokploy compose** `confer-stack` created (id `1Ay9SkpstjB8n5k2TNSQa`)
  - `composePath: ./docker-compose.dokploy.yml` (in repo)
  - `sourceType: git` + `customGitUrl: https://github.com/rohansx/confer.git`
  - `env: CONFER_SIGNING_SECRET=6bb513bca3cdf0bc6ad13c28ac1044e2b01e8d06363144644c4544b1b9410020`
  - ports `5173:5173` (app/dashboard/API) and `5174:5174` (view origin)
- **Image built and pushed to ghcr.io**: workflow run `29013410686` produced `ghcr.io/rohansx/confer:latest` (454 MB)
- Dockerfile fixed: was missing `COPY turbo.json` (would have failed the build)
- `.dockerignore` added (was missing — would have made the build context too large for Dokploy's pre-flight)

## What's blocked ❌

The Dokploy `compose.deploy` endpoint returns `"Deployment queued"` but the worker does not pick jobs up — no new deployment records get created since 2026-07-08T17:17 (~6 hours ago). 11 deploys in total; all stuck or errored in pre-flight. The Dokploy web UI requires a login I don't have.

## How to finish

In the Dokploy UI at `http://187.127.185.75:3000/dashboard` (you log in):

1. Open project **confer** → production → compose **confer-stack**
2. Click **Deploy** manually. Should pull the image (already pushed to ghcr) and start in ~2 min
3. If that doesn't work, SSH to the host and `docker restart dokploy` then try again

Once deployed:
- Dashboard: `http://187.127.185.75:5173/#/login`
- Sign in with `rohan@utkrusht.ai` (already added as admin)
- Magic link will appear in `docker logs confer` (or run `./deploy.sh` on the host and tail logs)

## Manual fallback

If Dokploy stays stuck, run this on the host directly (single command, no Dokploy needed):

```bash
git clone https://github.com/rohansx/confer.git /opt/confer && cd /opt/confer
CONFER_SIGNING_SECRET=6bb513bca3cdf0bc6ad13c28ac1044e2b01e8d06363144644c4544b1b9410020 \
APP_ORIGIN=http://187.127.185.75:5173 \
VIEW_ORIGIN=http://187.127.185.75:5174 \
  ./deploy.sh
```

## Env (keep these)

```
CONFER_SIGNING_SECRET=6bb513bca3cdf0bc6ad13c28ac1044e2b01e8d06363144644c4544b1b9410020
APP_ORIGIN=http://187.127.185.75:5173
VIEW_ORIGIN=http://187.127.185.75:5174
```
