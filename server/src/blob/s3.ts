import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import type { BlobStore } from "./store.js";
import { hashBytes } from "./hash.js";

export interface S3BlobOptions {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Path-style addressing (e.g. for some R2 setups / minio). Default false. */
  forcePathStyle?: boolean;
}

/**
 * Content-addressed blob store on any S3-compatible endpoint — Cloudflare R2,
 * AWS S3, Minio, etc. The hash is the key: `<ab>/<cd>/<hash>`. Writes are
 * idempotent (HeadObject before PutObject). Reads stream the body into a
 * Uint8Array. R2 is S3-compatible: set `endpoint` to your R2 account endpoint
 * and `region` to "auto".
 */
export class S3BlobStore implements BlobStore {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(opts: S3BlobOptions) {
    this.client = new S3Client({
      region: opts.region,
      endpoint: opts.endpoint,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      forcePathStyle: opts.forcePathStyle ?? false,
    });
    this.bucket = opts.bucket;
  }

  private key(hash: string): string {
    return `${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
  }

  async put(bytes: Uint8Array): Promise<string> {
    const hash = hashBytes(bytes);
    if (await this.has(hash)) return hash;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.key(hash),
        Body: bytes,
        ContentType: "text/html; charset=utf-8",
      }),
    );
    return hash;
  }

  async get(hash: string): Promise<Uint8Array> {
    const res = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.key(hash) }),
    );
    const buf = await res.Body!.transformToByteArray();
    return new Uint8Array(buf);
  }

  async has(hash: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.key(hash) }),
      );
      return true;
    } catch {
      return false;
    }
  }
}