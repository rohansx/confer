import { blake3 } from "@noble/hashes/blake3";
import { bytesToHex } from "@noble/hashes/utils";

/** Lowercase blake3 hex digest of the given bytes. The content address. */
export function hashBytes(bytes: Uint8Array): string {
  return bytesToHex(blake3(bytes));
}
