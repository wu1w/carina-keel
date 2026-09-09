/**
 * zh: 可识别的错误码。用户文案走 i18n，不写死在这里。
 * en: Stable error codes. User-facing copy comes from i18n, not from here.
 */
export type CarinaErrorCode =
  | "PACK_NOT_FOUND"
  | "PACK_INVALID"
  | "SANDBOX"
  | "UNKNOWN_TOOL"
  | "TOOL_INPUT"
  | "GRAPH_INVALID"
  | "SESSION_INVALID"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "CONFIG"
  | "EXPORT_FAILED"
  | "INTERNAL";

/**
 * zh: 龙骨错误。code 为英语大写；展示用 messageKey。
 * en: Carina error. code is English uppercase; display uses messageKey.
 */
export class CarinaError extends Error {
  readonly code: CarinaErrorCode;
  readonly messageKey: string;

  /**
   * zh: 构造龙骨错误。
   * en: Construct a Carina error.
   */
  constructor(code: CarinaErrorCode, messageKey: string, cause?: unknown) {
    super(code);
    this.name = "CarinaError";
    this.code = code;
    this.messageKey = messageKey;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}
