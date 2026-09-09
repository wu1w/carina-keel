import { ulid } from "ulid";

/**
 * zh: 新的 ULID。
 * en: A new ULID.
 */
export function newRecordId(): string {
  return ulid();
}

/**
 * zh: 当前 UTC ISO-8601 时间。
 * en: Current UTC ISO-8601 timestamp.
 */
export function utcNow(): string {
  return new Date().toISOString();
}
