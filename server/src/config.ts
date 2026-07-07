export interface Config {
  appOrigin: string;
  viewOrigin: string;
  dbPath: string;
  blobDir: string;
  signingSecret: string;
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
  };
}
