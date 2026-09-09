import { CarinaError } from "../errors.js";
import { sessionFileSchema, type SessionFile } from "../schema/index.js";

/**
 * zh: 校验 session.json。
 * en: Validate session.json.
 */
export function assertSession(session: SessionFile): void {
  const parsed = sessionFileSchema.safeParse(session);
  if (!parsed.success) {
    throw new CarinaError(
      "SESSION_INVALID",
      "error.sessionInvalid",
      parsed.error,
    );
  }
}

/**
 * zh: 写入当前地点与上一轮时间。
 * en: Write current place and last-turn time.
 */
export function applyPresence(
  session: SessionFile,
  placeId: string,
  lastTurnAt: string,
): void {
  session.placeId = placeId;
  session.lastTurnAt = lastTurnAt;
}
