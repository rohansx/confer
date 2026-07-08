# Confer

> **GitHub PRs for docs.** Agents write, humans approve, agents read only
> what's approved, with provenance.

A self-hostable, MCP-native review platform for AI-generated documentation.
The whole product is a single loop:

> **Agents write docs → humans review and approve → agents read only the approved corpus, with provenance.**

The **approved-only invariant** is the headline: every MCP read path returns
only human-approved content unless the caller explicitly opts in *and* holds
the `unapproved` scope. The view origin is a separate, cookie-free, CSP-locked
sandbox. Comments are text-quote-anchored and carry across versions.

---

## Quickstart (local dev)

Requires Node 22+.

```bash
git clone <this-repo>
cd confer
npm install            # installs workspaces + turbo
cp .env.example .env
npm run build           # turbo runs build across all workspaces (shared → server/web/cli)

# Dev — pick one:
npm run dev             # one command: turbo builds @confer/shared, then runs the app+view and Vite in parallel
# …or two terminals:
npm run dev:origins     # boots the app on :5173 and view on :5174 (two-origin dev server)
npm run dev:web         # Vite SPA on :4321, /api proxied to :5173
```

Visit:
- Dashboard:    <http://app.localhost:4321>  (and add `app.localhost` → 127.0.0.1 to /etc/hosts)
- View origin:  <http://view.localhost:5174> (no cookies, CSP-locked)
- MCP endpoint: <http://app.localhost:5173/mcp>  (streamable HTTP, bearer auth)

To get a push token for the CLI:

```bash
npx tsx server/src/dev/seed.ts
# prints pushToken, mcpToken, mcp+unapproved token, and a session cookie
```

## The 90-second loop

```bash
# 1. An agent pushes a doc (with auto-detected git provenance)
npx tsx cli/src/index.ts push ./auth-flow.html --space backend --slug auth-flow
# → {"ok":true, "version_id":"…", "review_url":"…", "provenance":{…}}

# 2. A human reviews and approves it (in the dashboard or via curl)
#    (see scripts/e2e-phase3.sh for a curl-driven loop)

# 3. Another agent queries the approved corpus via MCP
#    (mcp-only token → approved-only; mcp+unapproved → all states)
```

## Self-host with Docker

```bash
git clone <this-repo>
cd confer
docker compose up --build
```

The image:
- Caddy terminates TLS and routes by Host header (`app.` → :5173, `view.` → :5174)
- The Node process binds both ports internally
- `/app/data` and `/app/blobs` are mounted as volumes

For local dev with Docker, add to `/etc/hosts`:
```
127.0.0.1   app.localhost view.localhost
```
Then visit <http://app.localhost>.

For production, point real DNS at the host, set `APP_ORIGIN` and
`VIEW_ORIGIN` to your real URLs, and Caddy will handle the rest.

### Backups (SQLite → S3/R2)

A `litestream.yml` template is included for continuous WAL replication of the
SQLite DB to any S3-compatible store (R2, S3, Minio). Fill in your bucket +
endpoint and run `litestream replicate -config litestream.yml` alongside the
app — the app process stays boring, backup is a sidecar.

### Slack notifications

Set `SLACK_WEBHOOK_URL` in your environment to receive one message per
review-requested / approved / rejected / commented event. Without it, the
`console` transport logs `NOTIFY {…}` lines to stdout.

## Repository layout

```
.
├── docs/                   # product + architecture docs
│   ├── overview.md
│   ├── architecture.md
│   ├── data-model.md
│   ├── security.md
│   ├── api-reference.md
│   ├── roadmap.md
│   ├── implementation-plan.md
│   └── plans/              # per-phase build plans
├── shared/                 # @confer/shared — types + zod schemas shared by web + server + cli
├── server/                 # Hono + Node, the source of truth
│   └── src/
│       ├── api/            # REST endpoints
│       ├── mcp/            # Model Context Protocol server
│       ├── review/         # state machine, approve/reject
│       ├── viewer/         # two-origin sandbox
│       ├── comments/       # anchor + queries
│       ├── notify/         # in-process event queue + transports
│       ├── search/         # FTS5 + provider
│       └── blob/           # content-addressed store
├── web/                    # Vite + React dashboard
├── cli/                    # `confer` CLI + Claude skill
├── scripts/                # e2e-phaseN.sh
├── Dockerfile
├── Caddyfile
├── docker-compose.yml
└── .env.example
```

## Tests

```bash
npm test             # turbo runs tests per workspace (173 tests total, cached)
npm run typecheck    # turbo runs typecheck across all four workspaces (cached)
npm run build        # turbo builds shared → server + web + cli (cached)
bash scripts/e2e-phase{1..7}.sh  # end-to-end loops
```

## The 90-second demo loop

The same loop, scripted end-to-end for the demo:

```bash
# Phase 1: foundation (push API)
bash scripts/e2e-phase1.sh
# Phase 2: two-origin viewer (signed URLs, CSP, no cookies)
bash scripts/e2e-phase2.sh
# Phase 3: review (approve/reject, transactional supersede)
bash scripts/e2e-phase3.sh
# Phase 4: MCP server (the approved-only invariant)
bash scripts/e2e-phase4.sh
# Phase 5: CLI + SKILL.md (the 90-second loop)
bash scripts/e2e-phase5.sh
# Phase 7: comments, notifications, full loop
bash scripts/e2e-phase7.sh
```

## License

Apache 2.0 + Confer trademark. See `LICENSE` (TBD).
