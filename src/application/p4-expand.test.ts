import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import type { SceneObject, WorldCommand } from "../schema/index.js";
import { createUlid } from "../world/ids.js";
import { createApplication } from "./create-application.js";

function testConfig(dataDir: string): CarinaConfig {
  return {
    apiKey: undefined,
    model: "gpt-4o-mini",
    modelBaseUrl: "https://api.openai.com/v1",
    token: "dev-token",
    port: 18790,
    pack: undefined,
    lang: "zh",
    dataDir,
  };
}

function baseCommand(
  intentKind: WorldCommand["intentKind"],
  extra: Partial<WorldCommand> = {},
): WorldCommand {
  const command: WorldCommand = {
    commandId: extra.commandId ?? createUlid(),
    intentKind,
    arguments: extra.arguments ?? {},
    origin: extra.origin ?? "cli",
    mode: extra.mode ?? "author",
    requestedBy: extra.requestedBy ?? "tester",
  };
  if (extra.worldId !== undefined) {
    return { ...command, worldId: extra.worldId };
  }
  return command;
}

function interiorFingerprint(objects: readonly SceneObject[]): string {
  return JSON.stringify(
    objects
      .filter(
        (object) =>
          !object.name.includes("花园") &&
          (object.name === "桌子" ||
            object.name.includes("墙") ||
            object.name === "地板" ||
            object.sceneObjectId === "table" ||
            object.sceneObjectId === "floor"),
      )
      .map((object) => [
        object.sceneObjectId,
        object.name,
        object.bounds,
        object.assetRefs,
      ])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  );
}

async function withApp(
  fn: (app: ReturnType<typeof createApplication>) => Promise<void>,
): Promise<void> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-p4-"));
  const app = createApplication(testConfig(dataDir));
  try {
    await fn(app);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

/**
 * zh: 停止生成后走近门口不再自动接花园；明确的门外扩展仍可提交；室内桌墙不变。
 * en: After generation.stop, approaching the door does not auto-attach a garden; explicit extend still commits; interior table/walls stay.
 */
test("P4 stop blocks auto garden; explicit terrace extend keeps the interior", async () => {
  await withApp(async (app) => {
    const created = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const tavernId = created[0]?.worldId;
    assert.ok(tavernId !== undefined);
    const before = await app.getSessionView(tavernId);
    assert.equal(before.expansionLog?.claimsWorldModelGeneration, false);
    assert.equal(before.expansionLog?.stage, "idle");
    const interiorBefore = interiorFingerprint(before.snapshot.objects);

    const stopped = await app.dispatchCommand(
      baseCommand("generation.stop", { worldId: tavernId }),
    );
    assert.equal(stopped.accepted, true);
    const afterStop = await app.getSessionView(tavernId);
    assert.equal(afterStop.expansionLog?.autoExpandEnabled, false);
    assert.equal(afterStop.expansionLog?.stage, "blocked-stopped");

    const approached = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId: tavernId,
        mode: "player",
        arguments: {
          action: "move",
          position: { x: 4, y: 0, z: 4.2 },
          yaw: 0,
        },
      }),
    );
    assert.equal(approached.accepted, true);
    assert.notEqual(approached.payload?.["extended"], true);
    const stillInterior = await app.getSessionView(tavernId);
    assert.equal(stillInterior.snapshot.regions.length, 1);
    assert.equal(stillInterior.expansionLog?.approachCount, 1);

    const station = await app.interpretAndDispatch(
      "新建一个空间站",
      "natural_language",
      undefined,
      "user",
    );
    const stationId = station[0]?.worldId;
    assert.ok(stationId !== undefined);
    const stationBefore = await app.getSessionView(stationId);

    const grown = await app.interpretAndDispatch(
      "门外增加露台",
      "natural_language",
      tavernId,
      "user",
    );
    assert.equal(grown[0]?.accepted, true);
    const after = await app.getSessionView(tavernId);
    assert.equal(
      after.snapshot.regions.some((region) => region.name === "花园"),
      true,
    );
    assert.equal(after.expansionLog?.stage, "committed");
    assert.equal(after.expansionLog?.readyReserve, 1);
    assert.equal(after.expansionLog?.claimsWorldModelGeneration, false);
    assert.equal(after.expansionLog?.generateCount, 1);
    assert.equal(interiorFingerprint(after.snapshot.objects), interiorBefore);

    const again = await app.dispatchCommand(
      baseCommand("player.act", {
        worldId: tavernId,
        mode: "player",
        arguments: {
          action: "move",
          position: { x: 4, y: 0, z: 4.2 },
          yaw: 0,
        },
      }),
    );
    assert.equal(again.accepted, true);
    const cached = await app.getSessionView(tavernId);
    assert.equal(cached.expansionLog?.cacheHits, 1);
    assert.equal(cached.expansionLog?.generateCount, 1);

    const stationAfter = await app.getSessionView(stationId);
    assert.equal(stationAfter.snapshot.regions.length, stationBefore.snapshot.regions.length);
    assert.equal(
      stationAfter.snapshot.regions.some((region) => region.name === "花园"),
      false,
    );
  });
});
