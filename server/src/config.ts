export interface R2Config {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
}

export interface Config {
  appOrigin: string;
  viewOrigin: string;
  dbPath: string;
  blobDir: string;
  signingSecret: string;
  /** When set, blobs go to R2/S3 instead of disk. */
  r2?: R2Config;
}

const REQUIRED = [
  "APP_ORIGIN",
  "VIEW_ORIGIN",
  "DB_PATH",
  "BLOB_DIR",
  "SIGNING_SECRET",
] as const;

export function loadConfig(env: Record<string, string | undefined>): Config {
  for (const k of REQUIRED) {
    if (!env[k]) throw new Error(`Missing required env var: ${k}`);
  }
  return {
    appOrigin: env.APP_ORIGIN!,
    viewOrigin: env.VIEW_ORIGIN!,
    dbPath: env.DB_PATH!,
    blobDir: env.BLOB_DIR!,
    signingSecret: env.SIGNING_SECRET!,
    r2: loadR2(env),
  };
}

/** R2/S3 is opt-in. Configured when R2_BUCKET + access key + secret are all set. */
export function loadR2(env: Record<string, string | undefined>): R2Config | undefined {
  const bucket = env.R2_BUCKET;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const endpoint = env.R2_ENDPOINT;
  if (!bucket || !accessKeyId || !secretAccessKey || !endpoint) return undefined;
  return {
    endpoint,
    region: env.R2_REGION ?? "auto",
    accessKeyId,
    secretAccessKey,
    bucket,
    forcePathStyle: (env.R2_FORCE_PATH_STYLE ?? "false").toLowerCase() === "true",
  };
}