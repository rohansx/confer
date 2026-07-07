/**
 * Content-addressed blob storage. The hash IS the identity: the same bytes
 * always map to the same address, so writes are idempotent and content is
 * immutable by construction. Disk adapter for v0/self-host; S3 for cloud.
 */
export interface BlobStore {
  /** Store bytes; returns their content hash (blake3 hex). Idempotent. */
  put(bytes: Uint8Array): Promise<string>;
  /** Read bytes by content hash. Throws if absent. */
  get(hash: string): Promise<Uint8Array>;
  /** Whether a blob with this hash is already stored. */
  has(hash: string): Promise<boolean>;
}
