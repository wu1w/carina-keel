import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createPack, openPack } from "../pack/index.js";
import { WorldStore } from "../world/index.js";
import { assembleContext } from "./assemble-context.js";

/**
 * zh: 从真实世界包组装上下文，含宪法与示例技能。
 * en: Assemble context from a real pack, including constitution and the sample skill.
 */
test("assembleContext injects constitution and the sample skill", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "carina-steward-"));
  const packDir = path.join(root, "tavern.carina");
  try {
    await createPack(packDir, "en");
    const pack = await openPack(packDir);
    const store = new WorldStore(pack);
    const text = await assembleContext(store, pack);
    assert.match(text, /STEWARD\.md/);
    assert.match(text, /WORLD\.md/);
    assert.match(text, /PLAYER\.md/);
    assert.match(text, /MEMORY\.md/);
    assert.match(text, /tavern-continuity/);
    assert.match(text, /No current place/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
