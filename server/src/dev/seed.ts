/**
 * Dev-only seed: creates an org, a user (owner), a space, a doc, a space_owner
 * row, a push token, a read token, and a session cookie. Prints the plaintext
 * session value, the user_id, the space_owner link, the tokens, and a sample
 * HTML file path.
 * Run: tsx --env-file=.env server/src/dev/seed.ts
 */
import { loadConfig } from "../config.js";
import { openDb, newId } from "../db/client.js";
import { orgs, spaces, docs, users, spaceOwners } from "../db/schema.js";
import { createToken } from "../auth/tokens.js";
import { createSessionCookie } from "../auth/sessions.js";

const cfg = loadConfig(process.env);
const db = openDb(cfg.dbPath);

const orgId = newId();
const userId = newId();
const spaceId = newId();
const docId = newId();

db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
db.insert(users).values({ id: userId, name: "Rohan", email: "rohan@acme.test" }).run();
db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
db.insert(spaceOwners).values({ spaceId, userId }).run();
db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth Flow" }).run();

const pushToken = createToken(db, orgId, "dev-cli", ["push"]).raw;
const readToken = createToken(db, orgId, "dev-read", ["read"]).raw;
const mcpToken = createToken(db, orgId, "dev-mcp", ["mcp"]).raw;
const session = createSessionCookie(cfg.signingSecret, userId).value;

console.log(
  JSON.stringify({
    orgId,
    userId,
    spaceId,
    docId,
    space: "backend",
    slug: "auth-flow",
    user: { id: userId, name: "Rohan" },
    pushToken,
    readToken,
    mcpToken,
    sessionCookie: `confer_session=${session}`,
  }),
);
