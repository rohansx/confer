import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BlobStore } from "./store.js";
import { hashBytes } from "./hash.js";

/** Content-addressed disk store. Path: <dir>/<h0h1>/<h2h3>/<hash>. */
export class DiskBlobStore implements BlobStore {
  constructor(private readonly dir: string) {}

  private path(hash: string): string {
    return join(this.dir, hash.slice(0, 2), hash.slice(2, 4), hash);
  }

  async put(bytes: Uint8Array): Promise<string> {
    const hash = hashBytes(bytes);
    if (await this.has(hash)) return hash; // identical bytes already stored — no-op
    const p = this.path(hash);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
    return hash;
  }

  async get(hash: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(hash)));
  }

  async has(hash: string): Promise<boolean> {
    try {
      await access(this.path(hash));
      return true;
    } catch {
      return false;
    }
  }
}
