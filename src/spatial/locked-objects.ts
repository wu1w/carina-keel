import type { SceneObject, WorldRules } from "../schema/index.js";

/**
 * zh: 条款里锁定的对象名（吧台、壁炉、bar…）。
 * en: Locked object names from clauses (bar, fireplace, 吧台…).
 */
export function lockedObjectNames(rules: WorldRules): string[] {
  const names: string[] = [];
  for (const clause of rules.clauses) {
    if (clause.kind !== "lock_object") {
      continue;
    }
    const name = clause.payload["name"];
    if (typeof name === "string" && name.length > 0) {
      names.push(name);
    }
  }
  return names;
}

/**
 * zh: 名称或 id 是否命中锁定条款。
 * en: Whether a name or id matches a lock_object clause.
 */
export function isObjectLocked(
  rules: WorldRules,
  object: Pick<SceneObject, "sceneObjectId" | "name">,
): boolean {
  const hay = `${object.name} ${object.sceneObjectId}`.toLowerCase();
  for (const name of lockedObjectNames(rules)) {
    if (hay.includes(name.toLowerCase())) {
      return true;
    }
  }
  return false;
}

/**
 * zh: 生成结果不得改写已锁定物件的位姿与网格。
 * en: Generation must not rewrite a locked object's pose or mesh.
 */
export function preserveLockedObjects(
  proposed: SceneObject[],
  committed: SceneObject[],
  rules: WorldRules,
): SceneObject[] {
  const locked = committed.filter((item) => isObjectLocked(rules, item));
  if (locked.length === 0) {
    return proposed;
  }
  const lockedIds = new Set(locked.map((item) => item.sceneObjectId));
  const kept = proposed.filter(
    (item) => !lockedIds.has(item.sceneObjectId) && !isObjectLocked(rules, item),
  );
  return [...kept, ...locked.map((item) => structuredClone(item))];
}
