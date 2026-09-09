import path from "node:path";
import { CarinaError } from "../errors.js";

/**
 * zh: 判断是否为带 errno code 的 Node 错误。
 * en: Whether the value is a Node error with an errno code.
 */
export function isNodeErrno(error: unknown, code: string): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }
  if (!("code" in error)) {
    return false;
  }
  return error.code === code;
}

/**
 * zh: 拒绝含 `..`、绝对路径或反斜杠的 POSIX 路径。
 * en: Reject POSIX paths that contain `..`, are absolute, or use backslashes.
 */
export function assertSafePosixPath(posixPath: string): void {
  if (posixPath.length === 0) {
    throw new CarinaError("SANDBOX", "error.sandbox");
  }
  if (posixPath.includes("\\") || posixPath.includes("\0")) {
    throw new CarinaError("SANDBOX", "error.sandbox");
  }
  if (posixPath.startsWith("/") || posixPath.startsWith("//")) {
    throw new CarinaError("SANDBOX", "error.sandbox");
  }
  if (/^[A-Za-z]:/.test(posixPath)) {
    throw new CarinaError("SANDBOX", "error.sandbox");
  }
  const segments = posixPath.split("/");
  for (const segment of segments) {
    if (segment === "..") {
      throw new CarinaError("SANDBOX", "error.sandbox");
    }
  }
}

/**
 * zh: 确认解析后的宿主路径仍落在包根内。
 * en: Confirm a resolved host path still sits inside the pack root.
 */
export function assertPathInsidePack(
  packRoot: string,
  resolvedPath: string,
): void {
  const root = path.resolve(packRoot);
  const resolved = path.resolve(resolvedPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new CarinaError("SANDBOX", "error.sandbox");
  }
}
