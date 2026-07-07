import type { DB } from "./db/client.js";
import type { BlobStore } from "./blob/store.js";

/** Everything the app + viewer routes need. One shape, passed everywhere. */
export interface ServerDeps {
  db: DB;
  blobs: BlobStore;
  appOrigin: string;
  viewOrigin: string;
  signingSecret: string;
}
