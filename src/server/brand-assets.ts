import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CarinaError } from "../errors.js";

const BRAND_FILES: Record<string, string> = {
  "carina-wordmark.png": "image/png",
  "carina-mark.png": "image/png",
};

/**
 * zh: 读取品牌静态文件。仅允许白名单文件名。
 * en: Read a brand static file. Only allowlisted names.
 */
export async function readBrandAsset(
  filename: string,
): Promise<{ bytes: Uint8Array; mime: string }> {
  const mime = BRAND_FILES[filename];
  if (mime === undefined) {
    throw new CarinaError("NOT_FOUND", "error.notFound");
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, "public", "brand", filename),
    join(here, "..", "..", "src", "server", "public", "brand", filename),
  ];
  for (const candidate of candidates) {
    try {
      const bytes = await readFile(candidate);
      return { bytes, mime };
    } catch {
      continue;
    }
  }
  throw new CarinaError("NOT_FOUND", "error.notFound");
}
