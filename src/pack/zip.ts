import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { zipSync, type Zippable } from "fflate";
import { CarinaError } from "../errors.js";
import { writeFileAtomic, type PackHandle } from "./open.js";
import { assertPathInsidePack, isNodeErrno } from "./sandbox.js";

/**
 * zh: 用 fflate 把世界包打成 zip，条目路径为 POSIX。
 * en: Zip a world pack with fflate using POSIX entry paths.
 */
export async function exportZip(
  handle: PackHandle,
  destPath: string,
): Promise<void> {
  const packRoot = path.resolve(handle.packDir);
  const resolvedDest = path.resolve(destPath);
  let files: Zippable;
  try {
    files = await collectPackFiles(packRoot, resolvedDest);
    const zipped = zipSync(files);
    await mkdir(path.dirname(resolvedDest), { recursive: true });
    await writeFileAtomic(resolvedDest, zipped);
  } catch (error) {
    if (error instanceof CarinaError) {
      throw error;
    }
    throw new CarinaError("EXPORT_FAILED", "error.exportFailed", error);
  }
}

/**
 * zh: 收集包内全部文件；空目录写成带尾斜杠的条目。
 * en: Collect every pack file; empty dirs become entries with a trailing slash.
 */
async function collectPackFiles(
  packRoot: string,
  skipAbsPath: string,
): Promise<Zippable> {
  const files: Zippable = {};
  await walkPack(packRoot, packRoot, "", skipAbsPath, files);
  return files;
}

/**
 * zh: 递归走包目录，键一律用 `/`。
 * en: Recursively walk the pack; keys always use `/`.
 */
async function walkPack(
  packRoot: string,
  absDir: string,
  posixPrefix: string,
  skipAbsPath: string,
  files: Zippable,
): Promise<void> {
  let entries;
  try {
    entries = await readdir(absDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrno(error, "ENOENT")) {
      throw new CarinaError("PACK_NOT_FOUND", "error.packNotFound", error);
    }
    throw error;
  }
  if (entries.length === 0 && posixPrefix !== "") {
    files[`${posixPrefix}/`] = new Uint8Array(0);
    return;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }
    const posixPath =
      posixPrefix === "" ? entry.name : `${posixPrefix}/${entry.name}`;
    const absPath = path.join(absDir, entry.name);
    if (path.resolve(absPath) === skipAbsPath) {
      continue;
    }
    assertPathInsidePack(packRoot, absPath);
    if (entry.isDirectory()) {
      await walkPack(packRoot, absPath, posixPath, skipAbsPath, files);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    const bytes = await readFile(absPath);
    files[posixPath] = new Uint8Array(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength,
    );
  }
}
