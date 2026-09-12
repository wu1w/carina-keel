import { createHash } from "node:crypto";

/**
 * zh: SHA-256 十六进制内容哈希。
 * en: SHA-256 hex content hash.
 */
export function sha256Hex(contents: string | Uint8Array): string {
  const hash = createHash("sha256");
  hash.update(contents);
  return hash.digest("hex");
}
