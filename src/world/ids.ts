import { ulid } from "ulid";

/**
 * zh: 生成可排序的 ULID。
 * en: Create a sortable ULID.
 */
export function createUlid(): string {
  return ulid();
}

/**
 * zh: 当前 UTC 时间的 ISO-8601 字符串。
 * en: Current UTC time as an ISO-8601 string.
 */
export function nowIsoUtc(): string {
  return new Date().toISOString();
}

/**
 * zh: 判断是否为找不到文件的错误。
 * en: Whether an error is a missing-file error.
 */
export function isEnoent(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
