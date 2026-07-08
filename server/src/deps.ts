import type { DB } from "./db/client.js";
import type { BlobStore } from "./blob/store.js";

/** Everything the app + viewer routes need. One shape, passed everywhere. */
export interface ServerDeps {
  db: DB;
  blobs: BlobStore;
  appOrigin: string;
  viewOrigin: string;
  signingSecret: string;
  /** Absolute or cwd-relative path to the built web SPA (web/dist). When set
   * and present, the app origin serves the dashboard; unset in tests. */
  webDistDir?: string;
}