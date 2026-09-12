import { createUlid } from "../world/ids.js";
import type { WorldRuleClause, WorldRules } from "../schema/index.js";

/**
 * zh: 从 WORLD.md 抽出可执行条款。无法结构化的段落进入 stewardConstraints。
 * en: Compile executable clauses from WORLD.md. Unstructured lines become steward constraints.
 */
export function compileWorldRules(
  body: string,
  revision: string,
  sourceHash: string,
): WorldRules {
  const clauses: WorldRuleClause[] = [];
  const stewardConstraints: string[] = [];
  const lines = body.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }
    const clause = clauseFromLine(trimmed);
    if (clause === undefined) {
      stewardConstraints.push(trimmed);
      continue;
    }
    clauses.push(clause);
  }
  return {
    revision,
    sourceHash,
    clauses,
    stewardConstraints,
  };
}

/**
 * zh: 识别一行是否为已知可执行法则。
 * en: Detect whether a line is a known executable law.
 */
function clauseFromLine(line: string): WorldRuleClause | undefined {
  const lower = line.toLowerCase();
  if (/禁止瞬移|不准瞬移|no\s*teleport/.test(lower)) {
    return {
      id: createUlid(),
      kind: "no_teleport",
      sourceSpan: line,
      payload: {},
    };
  }
  if (/没有魔法|禁止魔法|no\s*magic/.test(lower)) {
    return {
      id: createUlid(),
      kind: "no_magic",
      sourceSpan: line,
      payload: {},
    };
  }
  const hour = parseLockHour(line);
  if (hour !== undefined) {
    return {
      id: createUlid(),
      kind: "lock_after_hour",
      sourceSpan: line,
      payload: { hour },
    };
  }
  if (/禁止.{0,12}生成|do\s*not\s*generate/.test(lower)) {
    return {
      id: createUlid(),
      kind: "generation_forbid",
      sourceSpan: line,
      payload: { text: line },
    };
  }
  return undefined;
}

/**
 * zh: 从打烊/锁门句里读小时。晚上十点视为 22。
 * en: Parse a closing-hour from a lock line. Evening 十点 means 22.
 */
function parseLockHour(line: string): number | undefined {
  if (!/(打烊|锁门|lock\s*after)/i.test(line)) {
    return undefined;
  }
  const lockAfter = line.match(/lock\s*after\s*(\d{1,2})/i);
  if (lockAfter !== null && lockAfter[1] !== undefined) {
    return Number.parseInt(lockAfter[1], 10);
  }
  if (/晚上\s*十\s*点|晚十\s*点/.test(line)) {
    return 22;
  }
  const digits = line.match(/(\d{1,2})\s*点/);
  if (digits !== null && digits[1] !== undefined) {
    const hour = Number.parseInt(digits[1], 10);
    if (!Number.isFinite(hour)) {
      return undefined;
    }
    if (/晚上|晚/.test(line) && hour > 0 && hour <= 12) {
      return hour === 12 ? 12 : hour + 12;
    }
    return hour;
  }
  return undefined;
}
