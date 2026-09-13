import assert from "node:assert/strict";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import type { CommandResult, WorldCommand } from "../schema/index.js";
import type { Application } from "./bind-application.js";
import { createDefaultHttpOptions } from "./default-turn.js";

const config: CarinaConfig = {
  apiKey: undefined,
  model: "gpt-4o-mini",
  modelBaseUrl: "https://api.openai.com/v1",
  token: "test-token",
  port: 18790,
  pack: "/tmp/carina-does-not-exist.carina",
  lang: "zh",
  dataDir: "/tmp/carina-test-data",
};

/**
 * zh: 有 application 时即使设了 CARINA_PACK 也不走八工具。
 * en: With an application, CARINA_PACK must not take the eight-tool path.
 */
test("chat uses application WorldCommand even when a pack path is set", async () => {
  let seen: string | undefined;
  let seenWorld: string | undefined;
  const application = stubApplication(async (text, _origin, worldId) => {
    seen = text;
    seenWorld = worldId;
    return [
      {
        commandId: "c1",
        worldId: "01WORLD",
        accepted: true,
        payload: { text: "from-app" },
      },
    ];
  });
  const options = await createDefaultHttpOptions(config, application);
  assert.equal(options.application, application);
  assert.equal(options.rollLook, undefined);
  const chunks: string[] = [];
  const turn = await options.runTurn("新建一个酒馆");
  for await (const event of asText(turn)) {
    chunks.push(event);
  }
  assert.equal(seen, "新建一个酒馆");
  assert.equal(seenWorld, "01WORLD");
  assert.deepEqual(chunks, ["from-app"]);
});

/**
 * zh: 拒绝时把真实错误文案给用户，不吞成空列表。
 * en: Rejections surface the real error copy instead of an empty list.
 */
test("chat surfaces unsupported instead of an empty reply", async () => {
  const application = stubApplication(async () => [
    {
      commandId: "c1",
      accepted: false,
      code: "UNSUPPORTED",
      messageKey: "error.unsupported",
    },
  ]);
  const options = await createDefaultHttpOptions(
    { ...config, pack: undefined },
    application,
  );
  const chunks: string[] = [];
  const turn = await options.runTurn("门外生成花园");
  for await (const event of asText(turn)) {
    chunks.push(event);
  }
  assert.equal(chunks[0], "当前后端不支持该能力。");
});

function stubApplication(
  interpret: (
    text: string,
    origin: WorldCommand["origin"],
    worldId?: string,
  ) => Promise<CommandResult[]>,
): Application {
  return {
    async interpretAndDispatch(text, origin, worldId) {
      return interpret(text, origin, worldId);
    },
    async listSessions() {
      return {
        activeWorldId: "01WORLD",
        worlds: [
          {
            worldId: "01WORLD",
            name: "酒馆",
            runState: "paused",
            lifecycle: "active",
            updatedAt: "",
          },
        ],
      };
    },
    async dispatchCommand() {
      return { commandId: "unused", accepted: true };
    },
    async getSessionView() {
      throw new Error("unused");
    },
    async *subscribeEvents() {},
    async exportGlb() {
      throw new Error("unused");
    },
    async exportPack() {
      throw new Error("unused");
    },
    async getCommittedMap() {
      throw new Error("unused");
    },
    async readPackAsset() {
      throw new Error("unused");
    },
    async stagePackAsset() {
      throw new Error("unused");
    },
    async close() {},
  };
}

async function* asText(result: unknown): AsyncIterable<string> {
  if (typeof result === "string") {
    yield result;
    return;
  }
  if (result !== null && typeof result === "object" && Symbol.asyncIterator in result) {
    for await (const chunk of result as AsyncIterable<unknown>) {
      if (typeof chunk === "string") {
        yield chunk;
      }
    }
  }
}
