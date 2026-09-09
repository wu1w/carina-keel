import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { CarinaError } from "../errors.js";
import type { PackHandle } from "./open.js";
import { isNodeErrno } from "./sandbox.js";

/**
 * zh: 列出 skills 下各目录中 SKILL.md 的包内 POSIX 路径。
 * en: List pack-relative POSIX paths of SKILL.md files one level under skills.
 */
export async function listSkills(handle: PackHandle): Promise<string[]> {
  const skillsRoot = path.join(handle.packDir, "skills");
  let entries;
  try {
    entries = await readdir(skillsRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrno(error, "ENOENT")) {
      return [];
    }
    throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
  }
  const posixPaths: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const skillFile = path.join(skillsRoot, entry.name, "SKILL.md");
    try {
      const fileInfo = await stat(skillFile);
      if (fileInfo.isFile()) {
        posixPaths.push(`skills/${entry.name}/SKILL.md`);
      }
    } catch (error) {
      if (!isNodeErrno(error, "ENOENT")) {
        throw new CarinaError("PACK_INVALID", "error.packInvalid", error);
      }
    }
  }
  posixPaths.sort();
  return posixPaths;
}
