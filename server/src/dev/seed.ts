/**
 * Dev-only seed: creates an org, a space, a doc, and a push token, then prints
 * the plaintext token. Shares DB_PATH with the server. Run: tsx --env-file=.env server/src/dev/seed.ts
 */
import { loadConfig } from "../config.js";
import { openDb, newId } from "../db/client.js";
import { orgs, spaces, docs } from "../db/schema.js";
import { createToken } from "../auth/tokens.js";

const cfg = loadConfig(process.env);
const db = openDb(cfg.dbPath);

const orgId = newId();
const spaceId = newId();
const docId = newId();

db.insert(orgs).values({ id: orgId, name: "Acme", slug: "acme" }).run();
db.insert(spaces).values({ id: spaceId, orgId, slug: "backend", name: "Backend" }).run();
db.insert(docs).values({ id: docId, spaceId, slug: "auth-flow", title: "Auth Flow" }).run();
const pushToken = createToken(db, orgId, "dev-cli", ["push"]).raw;
const readToken = createToken(db, orgId, "dev-read", ["read"]).raw;

console.log(
  JSON.stringify({ orgId, spaceId, docId, space: "backend", slug: "auth-flow", pushToken, readToken }),
);
