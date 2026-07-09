/**
 * Dev-only seed: creates an org, an admin user (org admin + space_owner),
 * a space, a doc, push/read/mcp tokens, and a session cookie. Also prints a
 * magic-link URL you can use to sign in as the seeded user.
 * Run: tsx --env-file=.env server/src/dev/seed.ts
 */
import { loadConfig } from "../config.js";
import { openDb, newId } from "../db/client.js";
import { orgs, spaces, docs, users, spaceOwners, orgMemberships } from "../db/schema.js";
import { createToken } from "../auth/tokens.js";
import { createSessionCookie } from "../auth/sessions.js";
import { createMagicLink } from "../auth/magic-link.js";

const cfg = loadConfig(process.env);
const db = openDb(cfg.dbPath);

const orgId = newId();
const userId = newId();
const spaceId = newId();
const docId = newId();
const email = "rohan@acme.test";

db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme", createdById: userId }).run();
db.insert(users).values({ id: userId, name: "Rohan", email }).run();
db.insert(orgMemberships).values({ orgId, userId, role: "admin", createdAt: 0 }).run();
db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
db.insert(spaceOwners).values({ spaceId, userId }).run();
db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth Flow" }).run();

const pushToken = createToken(db, { orgId }, "dev-cli", ["push"]).raw;
const readToken = createToken(db, { orgId }, "dev-read", ["read"]).raw;
const mcpToken = createToken(db, { orgId }, "dev-mcp", ["mcp"]).raw;
const mcpPlusUnapprovedToken = createToken(db, { orgId }, "dev-mcp-all", ["mcp", "unapproved"]).raw;
const session = createSessionCookie(cfg.signingSecret, userId).value;
const magicLink = createMagicLink(db, email);

console.log(
  JSON.stringify(
    {
      orgId,
      userId,
      spaceId,
      docId,
      space: "backend",
      slug: "auth-flow",
      user: { id: userId, name: "Rohan", email },
      role: "admin",
      pushToken,
      readToken,
      mcpToken,
      mcpPlusUnapprovedToken,
      sessionCookie: `confer_session=${session}`,
      magicLinkUrl: `${cfg.appOrigin}/api/v1/auth/magic-link/verify?token=${encodeURIComponent(magicLink)}`,
      devLogin: { user_id: userId, name: "Rohan", email },
    },
    null,
    2,
  ),
);