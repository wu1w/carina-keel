import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

/**
 * zh: 从 Authorization Bearer 或 X-Carina-Token 读取令牌。
 * en: Read the token from Authorization Bearer or X-Carina-Token.
 */
export function readRequestToken(c: Context): string | undefined {
  const authorization = c.req.header("authorization");
  if (authorization !== undefined && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }
  const headerToken = c.req.header("x-carina-token");
  if (headerToken !== undefined && headerToken !== "") {
    return headerToken;
  }
  return undefined;
}

/**
 * zh: EventSource 无法设头，仅 SSE GET 可读查询串 token。
 * en: EventSource cannot set headers; SSE GET may read a query token.
 */
export function readQueryToken(c: Context): string | undefined {
  const token = c.req.query("token");
  if (token === undefined || token === "") {
    return undefined;
  }
  return token;
}

/**
 * zh: 常量时间比较令牌，避免短令牌被计时探测。
 * en: Compare tokens in constant time so short tokens are not timed.
 */
export function tokensMatch(provided: string, expected: string): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * zh: Host 是否为本机回环（含测试里的 localhost）。
 * en: Whether Host is loopback (including localhost used in tests).
 */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined || host === "") {
    return true;
  }
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    if (end === -1) {
      return false;
    }
    return host.slice(1, end) === "::1";
  }
  const hostname = host.split(":")[0] ?? host;
  return hostname === "127.0.0.1" || hostname === "localhost";
}
