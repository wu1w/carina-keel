import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { CarinaError } from "../errors.js";
import { assertPathInsidePack, assertSafePosixPath, isNodeErrno } from "./sandbox.js";

/**
 * zh: 路径是否像世界包 zip（`.zip` 或 `.carina.zip`）。
 * en: Whether the path looks like a world-pack zip (`.zip` or `.carina.zip`).
 */
export function isZipPackPath(packPath: string): boolean {
  return packPath.toLowerCase().endsWith(".zip");
}

/**
 * zh: zip 旁的解包目录：`tavern.carina.zip` → `tavern.carina/`。
 * en: Sibling extract directory: `tavern.carina.zip` → `tavern.carina/`.
 */
export function packDirFromZipPath(zipPath: string): string {
  const directory = path.dirname(zipPath);
  let baseName = path.basename(zipPath);
  if (baseName.toLowerCase().endsWith(".zip")) {
    baseName = baseName.slice(0, -".zip".length);
  }
  if (!baseName.endsWith(".carina")) {
    baseName = `${baseName}.carina`;
  }
  if (baseName.length === 0) {
    throw new CarinaError("PACK_INVALID", "error.packInvalid");
  }
  return path.join(directory, baseName);
}

/**
 * zh: 把 zip 解到目录。条目必须是 POSIX 路径，禁止逃出目标目录。
 * en: Extract a zip into a directory. Entries must be POSIX paths and may not escape the dest.
 */
export async function importZip(
  zipPath: string,
  destDir: string,
): Promise<void> {
  const resolvedZip = path.resolve(zipPath);
  const resolvedDest = path.resolve(destDir);
  let zipBytes: Buffer;
  try {
    zipBytes = await readFile(resolvedZip);
  } catch (error) {
    if (isNodeErrno(error, "ENOENT")) {
      throw new CarinaError("PACK_NOT_FOUND", "error.packNotFound", error);
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch (error) {
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
  try {
    await mkdir(resolvedDest, { recursive: true });
    for (const posixPath of Object.keys(entries)) {
      await writeZipEntry(resolvedDest, posixPath, entries[posixPath]);
    }
  } catch (error) {
    if (error instanceof CarinaError) {
      throw error;
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
}

/**
 * zh: 写入一条 zip 条目；目录以 `/` 结尾。
 * en: Write one zip entry; directories end with `/`.
 */
async function writeZipEntry(
  destDir: string,
  posixPath: string,
  data: Uint8Array | undefined,
): Promise<void> {
  const trimmed = posixPath.replace(/\/+$/, "");
  if (trimmed.length === 0) {
    return;
  }
  assertSafePosixPath(trimmed);
  const segments = trimmed.split("/").filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    return;
  }
  const absPath = path.join(destDir, ...segments);
  assertPathInsidePack(destDir, absPath);
  if (posixPath.endsWith("/")) {
    await mkdir(absPath, { recursive: true });
    return;
  }
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, data ?? new Uint8Array(0));
}

/**
 * zh: 目标目录是否已有可打开的 graph.json。
 * en: Whether the dest directory already has an openable graph.json.
 */
export async function hasPackGraph(packDir: string): Promise<boolean> {
  try {
    const info = await stat(path.join(packDir, "graph.json"));
    return info.isFile();
  } catch {
    return false;
  }
}
