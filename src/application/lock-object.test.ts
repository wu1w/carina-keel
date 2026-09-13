import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import type { WorldCommand } from "../schema/index.js";
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
    allowPrimitiveFixture: true,
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
    return {
      ...command,
      worldId: extra.worldId,
      ...(extra.text !== undefined ? { text: extra.text } : {}),
    };
  }
  return command;
}

async function withApp(
  fn: (app: ReturnType<typeof createApplication>) => Promise<void>,
): Promise<void> {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-lock-"));
  const app = createApplication(testConfig(dataDir));
  try {
    await fn(app);
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

/**
 * zh: 锁定桌子后校准被拒；另一世界的桌子仍可动。
 * en: Locking the table rejects calibrate; the other world's table can still move.
 */
test("lock_object rejects table calibrate and stays isolated across worlds", async () => {
  await withApp(async (app) => {
    const createdA = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const idA = createdA[0]?.worldId;
    assert.ok(idA !== undefined);

    const locked = await app.dispatchCommand(
      baseCommand("rules.update", {
        worldId: idA,
        arguments: {
          scope: "world",
          documentId: "WORLD.md",
          append: "锁定桌子。",
        },
      }),
    );
    assert.equal(locked.accepted, true);
    const viewA = await app.getSessionView(idA);
    assert.equal(
      viewA.snapshot.worldRules.clauses.some(
        (clause) =>
          clause.kind === "lock_object" && clause.payload["name"] === "桌子",
      ),
      true,
    );
    const tableA = viewA.snapshot.objects.find((item) => item.name === "桌子");
    assert.ok(tableA !== undefined);
    const posA = { ...tableA.transform.position };

    const calibrateA = await app.interpretAndDispatch(
      "把桌子向窗边移动一米，其他东西别动",
      "natural_language",
      idA,
      "user",
    );
    assert.equal(calibrateA[0]?.accepted, false);
    assert.equal(calibrateA[0]?.messageKey, "error.lockObject");
    const afterA = await app.getSessionView(idA);
    const tableAfterA = afterA.snapshot.objects.find((item) => item.name === "桌子");
    assert.ok(tableAfterA !== undefined);
    assert.deepEqual(tableAfterA.transform.position, posA);

    const createdB = await app.interpretAndDispatch(
      "新建一个空间站",
      "natural_language",
      undefined,
      "user",
    );
    const idB = createdB[0]?.worldId;
    assert.ok(idB !== undefined);
    assert.notEqual(idA, idB);
    const viewB = await app.getSessionView(idB);
    assert.equal(
      viewB.snapshot.worldRules.clauses.some(
        (clause) => clause.kind === "lock_object",
      ),
      false,
    );
    const tableB = viewB.snapshot.objects.find((item) => item.name === "桌子");
    const windowB = viewB.snapshot.objects.find((item) => item.name === "窗");
    assert.ok(tableB !== undefined);
    assert.ok(windowB !== undefined);
    const distBefore = Math.hypot(
      tableB.transform.position.x - windowB.transform.position.x,
      tableB.transform.position.z - windowB.transform.position.z,
    );

    const calibrateB = await app.interpretAndDispatch(
      "把桌子向窗边移动一米，其他东西别动",
      "natural_language",
      idB,
      "user",
    );
    assert.equal(calibrateB[0]?.accepted, true);
    const afterB = await app.getSessionView(idB);
    const tableAfterB = afterB.snapshot.objects.find((item) => item.name === "桌子");
    const windowAfterB = afterB.snapshot.objects.find((item) => item.name === "窗");
    assert.ok(tableAfterB !== undefined);
    assert.ok(windowAfterB !== undefined);
    const distAfter = Math.hypot(
      tableAfterB.transform.position.x - windowAfterB.transform.position.x,
      tableAfterB.transform.position.z - windowAfterB.transform.position.z,
    );
    assert.ok(Math.abs(distBefore - distAfter - 1) <= 0.05);

    const stillA = await app.getSessionView(idA);
    const stillTable = stillA.snapshot.objects.find((item) => item.name === "桌子");
    assert.ok(stillTable !== undefined);
    assert.deepEqual(stillTable.transform.position, posA);
  });
});

/**
 * zh: 锁定桌子后门外扩展不得改写桌子位姿与网格。
 * en: Locking the table keeps its pose and mesh through a courtyard extend.
 */
test("lock_object keeps the table through generation.extend", async () => {
  await withApp(async (app) => {
    const created = await app.interpretAndDispatch(
      "新建一个湖边酒馆",
      "natural_language",
      undefined,
      "user",
    );
    const worldId = created[0]?.worldId;
    assert.ok(worldId !== undefined);
    const locked = await app.dispatchCommand(
      baseCommand("rules.update", {
        worldId,
        arguments: {
          scope: "world",
          documentId: "WORLD.md",
          append: "锁定桌子。",
        },
      }),
    );
    assert.equal(locked.accepted, true);
    const before = await app.getSessionView(worldId);
    const tableBefore = before.snapshot.objects.find((item) => item.name === "桌子");
    assert.ok(tableBefore !== undefined);
    const fingerprint = {
      position: { ...tableBefore.transform.position },
      bounds: structuredClone(tableBefore.bounds),
      assetRefs: [...tableBefore.assetRefs],
    };

    const extended = await app.interpretAndDispatch(
      "在门外生成花园",
      "natural_language",
      worldId,
      "user",
    );
    assert.equal(extended[0]?.accepted, true);
    const after = await app.getSessionView(worldId);
    const tableAfter = after.snapshot.objects.find(
      (item) => item.sceneObjectId === tableBefore.sceneObjectId,
    );
    assert.ok(tableAfter !== undefined);
    assert.deepEqual(tableAfter.transform.position, fingerprint.position);
    assert.deepEqual(tableAfter.bounds, fingerprint.bounds);
    assert.deepEqual(tableAfter.assetRefs, fingerprint.assetRefs);
    assert.equal(
      after.snapshot.objects.filter((item) => item.sceneObjectId === tableBefore.sceneObjectId)
        .length,
      1,
    );
    assert.ok(after.snapshot.regions.some((region) => region.name === "花园"));
  });
});
