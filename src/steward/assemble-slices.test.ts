import assert from "node:assert/strict";
import test from "node:test";
import { assembleSlices } from "./assemble-slices.js";
import { estimateTokens } from "./context-budget.js";

/**
 * zh: 组装顺序为宪法 → 技能 → 玩家 → 记忆 → 现场 → 编年 → 对话。
 * en: Assembly order is constitution → skills → player → memory → presence → chronicle → chat.
 */
test("assembleSlices injects sections in PRD order", () => {
  const text = assembleSlices({
    steward: "STEWARD BODY",
    world: "WORLD HARD RULES",
    skills: [
      {
        name: "tavern-continuity",
        posixPath: "skills/tavern-continuity/SKILL.md",
        body: "---\nname: tavern-continuity\n---\n\nOvernight continuity.",
      },
    ],
    player: "PLAYER BODY",
    memory: "MEMORY HEAD",
    presence: "placeId: tavern",
    events: "kind: break-vase",
    chat: "user: hello",
  });
  const stewardAt = text.indexOf("STEWARD BODY");
  const worldAt = text.indexOf("WORLD HARD RULES");
  const skillAt = text.indexOf("tavern-continuity");
  const playerAt = text.indexOf("PLAYER BODY");
  const memoryAt = text.indexOf("MEMORY HEAD");
  const presenceAt = text.indexOf("placeId: tavern");
  const eventsAt = text.indexOf("kind: break-vase");
  const chatAt = text.indexOf("user: hello");
  assert.ok(stewardAt >= 0 && worldAt > stewardAt);
  assert.ok(skillAt > worldAt);
  assert.ok(playerAt > skillAt);
  assert.ok(memoryAt > playerAt);
  assert.ok(presenceAt > memoryAt);
  assert.ok(eventsAt > presenceAt);
  assert.ok(chatAt > eventsAt);
});

/**
 * zh: 超限时丢掉最近对话，不截断 WORLD.md 硬规则。
 * en: Drop recent chat when over budget; do not truncate WORLD.md hard rules.
 */
test("assembleSlices never truncates WORLD.md hard rules", () => {
  const world = "HARD BOUNDARY: the vase stays broken.";
  const text = assembleSlices(
    {
      steward: "Be the steward.",
      world,
      skills: [],
      player: "Ada",
      memory: "The vase is broken.",
      presence: "placeId: tavern",
      events: "yesterday happened",
      chat: "user: " + "hello ".repeat(5000),
    },
    { maxContextTokens: estimateTokens(world) + 80 },
  );
  assert.match(text, /HARD BOUNDARY: the vase stays broken/);
  assert.ok(!text.includes("hello ".repeat(20)));
});

/**
 * zh: MEMORY 过长只留头部。
 * en: Keep only the head of a long MEMORY.md.
 */
test("assembleSlices keeps the head of a long MEMORY.md", () => {
  const memory = `FACT: the player is named Wei.\n${"padding ".repeat(2000)}`;
  const text = assembleSlices(
    {
      steward: "s",
      world: "w",
      skills: [],
      player: "p",
      memory,
      presence: "here",
      events: "e",
      chat: "",
    },
    { memoryHeadTokens: 20, maxContextTokens: 10_000 },
  );
  assert.match(text, /FACT: the player is named Wei/);
  assert.ok(text.includes("MEMORY.md"));
  assert.ok(estimateTokens(text) < estimateTokens(memory));
});

/**
 * zh: 技能超限时只注入名称，不注入正文。
 * en: Inject skill names, not bodies, when skills exceed their budget.
 */
test("assembleSlices keeps skill names only when the skill budget is exceeded", () => {
  const text = assembleSlices(
    {
      steward: "s",
      world: "w",
      skills: [
        {
          name: "tavern-continuity",
          posixPath: "skills/tavern-continuity/SKILL.md",
          body: `---\nname: tavern-continuity\n---\n\n${"Overnight ".repeat(800)}`,
        },
      ],
      player: "p",
      memory: "m",
      presence: "here",
      events: "e",
      chat: "",
    },
    { skillTokenBudget: 20, maxContextTokens: 10_000 },
  );
  assert.match(text, /tavern-continuity/);
  assert.doesNotMatch(text, /Overnight Overnight Overnight/);
});
