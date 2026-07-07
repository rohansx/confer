/**
 * Quick check: count approved versions for the E2E DB.
 * Run: npx tsx scripts/check-approved.ts
 */
import { openDb } from "../server/src/db/client.js";
import { versions } from "../server/src/db/schema.js";
import { eq } from "drizzle-orm";

const path = process.argv[2] ?? "./data/e2e3.db";
const db = openDb(path);
const rows = db.select().from(versions).where(eq(versions.state, "approved")).all();
console.log(rows.length);
