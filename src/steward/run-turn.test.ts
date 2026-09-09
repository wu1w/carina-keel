import assert from "node:assert/strict";
import test from "node:test";
import { CarinaError } from "../errors.js";

/**
 * zh: 没有 API Key 时 runTurn 抛 CONFIG。pack/world/tools 不在本 worktree 则跳过。
 * en: runTurn throws CONFIG without an API key. Skip when pack/world/tools are not in this worktree.
 */
test("runTurn throws CONFIG when the API key is missing", async (t) => {
  let runTurn: typeof import("./run-turn.js").runTurn;
  try {
    ({ runTurn } = await import("./run-turn.js"));
  } catch {
    t.skip("pack/world/tools modules are not in this worktree");
    return;
  }

  const pack = {
    packDir: "/tmp/missing.carina",
    graph: { version: 0 as const, nodes: [], edges: [] },
    session: { placeId: null, lastTurnAt: null, modelId: null },
    save: async () => {},
  };

  const iter = runTurn("hello", {
    store: {
      hopNeighborhood: () => ({ nodes: [], edges: [] }),
      appendEvent: async () => {},
    } as never,
    pack,
    config: {
      apiKey: undefined,
      model: "gpt-4o-mini",
      modelBaseUrl: "https://api.openai.com/v1",
      token: "dev-token",
      port: 18790,
      pack: undefined,
      lang: "zh",
    },
  });

  await assert.rejects(
    async () => {
      for await (const delta of iter) {
        void delta;
      }
    },
    (error: unknown) =>
      error instanceof CarinaError && error.code === "CONFIG",
  );
});
