import { DiskBlobStore } from "./disk.js";
import { S3BlobStore } from "./s3.js";
import type { BlobStore } from "./store.js";
import type { Config } from "../config.js";

/**
 * Pick the blob store from config. Disk by default; R2/S3 when `cfg.r2` is set
 * (i.e. R2_BUCKET + creds + endpoint are present in the environment).
 */
export function createBlobStore(cfg: Config): BlobStore {
  if (cfg.r2) {
    console.log(`confer blobs → R2/S3  bucket=${cfg.r2.bucket}  endpoint=${cfg.r2.endpoint}`);
    return new S3BlobStore({
      endpoint: cfg.r2.endpoint,
      region: cfg.r2.region,
      accessKeyId: cfg.r2.accessKeyId,
      secretAccessKey: cfg.r2.secretAccessKey,
      bucket: cfg.r2.bucket,
      forcePathStyle: cfg.r2.forcePathStyle,
    });
  }
  return new DiskBlobStore(cfg.blobDir);
}