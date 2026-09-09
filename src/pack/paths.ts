import path from "node:path";
import { assertPathInsidePack, assertSafePosixPath } from "./sandbox.js";

/**
 * zh: 把包内 POSIX 路径接到宿主文件系统，越界则抛 SANDBOX。
 * en: Join a pack-relative POSIX path onto the host FS; throw SANDBOX on escape.
 */
export function resolvePosix(packRoot: string, posixPath: string): string {
  assertSafePosixPath(posixPath);
  const root = path.resolve(packRoot);
  const segments: string[] = [];
  for (const segment of posixPath.split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    segments.push(segment);
  }
  const resolved =
    segments.length === 0 ? root : path.resolve(root, ...segments);
  assertPathInsidePack(root, resolved);
  return resolved;
}
