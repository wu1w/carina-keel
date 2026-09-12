import { readFile } from "node:fs/promises";
import { CarinaError } from "../errors.js";
import type { PackHandle } from "./open.js";
import { writeFileAtomic } from "./open.js";
import { resolvePosix } from "./paths.js";
import { isNodeErrno } from "./sandbox.js";

/**
 * zh: 读取包内 Markdown（如 WORLD.md），路径经沙箱解析。
 * en: Read pack Markdown (e.g. WORLD.md) after sandbox path resolution.
 */
export async function readMarkdown(
  handle: PackHandle,
  filename: string,
): Promise<string> {
  const absPath = resolvePosix(handle.packDir, filename);
  try {
    return await readFile(absPath, "utf8");
  } catch (error) {
    if (isNodeErrno(error, "ENOENT")) {
      throw new CarinaError("NOT_FOUND", "error.notFound", error);
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
}

/**
 * zh: 原子写入包内 Markdown。
 * en: Atomically write pack Markdown.
 */
export async function writeMarkdown(
  handle: PackHandle,
  filename: string,
  body: string,
): Promise<void> {
  const absPath = resolvePosix(handle.packDir, filename);
  const lfText = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  try {
    await writeFileAtomic(absPath, lfText);
  } catch (error) {
    if (error instanceof CarinaError) {
      throw error;
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
}
