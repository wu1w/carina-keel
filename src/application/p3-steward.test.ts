import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import type { SceneObject } from "../schema/index.js";
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

function objectPose(objects: readonly SceneObject[]): string {
  return JSON.stringify(
    objects
      .map((object) => [
        object.sceneObjectId,
        object.transform.position,
        object.bounds,
        object.materialRefs,
      ])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  );
}

function wallFingerprint(objects: readonly SceneObject[]): string {
  return JSON.stringify(
    objects
      .filter((object) => object.name.includes("墙") || object.name === "地板")
      .map((object) => [object.sceneObjectId, object.bounds])
      .sort((left, right) => String(left[0]).localeCompare(String(right[0]))),
  );
}

/**
 * zh: P3：十句固定自然语言可执行；桌子移动不改墙；两世界不串台。
 * en: P3: ten fixed NL phrases run; moving the table does not move walls; worlds stay isolated.
 */
test("P3 steward NL tasks move the table locally and keep two worlds isolated", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-p3-steward-"));
  const app = createApplication(testConfig(dataDir));
  try {
    const tavern = await app.interpretAndDispatch(
      "新建一个酒馆",
      "natural_language",
      undefined,
      "user",
    );
    assert.equal(tavern[0]?.accepted, true);
    const tavernId = tavern[0]?.worldId;
    assert.ok(tavernId !== undefined);

    const station = await app.interpretAndDispatch(
      "新建一个空间站",
      "natural_language",
      undefined,
      "user",
    );
    assert.equal(station[0]?.accepted, true);
    const stationId = station[0]?.worldId;
    assert.ok(stationId !== undefined);
    assert.notEqual(stationId, tavernId);

    const stationBefore = await app.getSessionView(stationId);
    const stationPose = objectPose(stationBefore.snapshot.objects);

    const switched = await app.interpretAndDispatch(
      "切换到酒馆",
      "natural_language",
      stationId,
      "user",
    );
    assert.equal(switched[0]?.accepted, true);
    assert.equal(switched[0]?.worldId, tavernId);

    const before = await app.getSessionView(tavernId);
    const tableBefore = before.snapshot.objects.find(
      (object) => object.name === "桌子" || object.sceneObjectId === "table",
    );
    assert.ok(tableBefore !== undefined);
    const wallsBefore = wallFingerprint(before.snapshot.objects);

    const tasks = [
      "暂停世界",
      "把桌子往左移一米",
      "把桌子换成深色木头",
      "拿起杯子",
      "放下杯子",
      "前进一步",
      "继续运行",
      "暂停世界",
      "导出这间屋子",
      "固化这间屋子",
    ];
    for (const text of tasks) {
      const results = await app.interpretAndDispatch(
        text,
        "natural_language",
        tavernId,
        "user",
      );
      assert.ok(results.length >= 1, text);
      assert.equal(results[0]?.accepted, true, text);
    }

    const after = await app.getSessionView(tavernId);
    const tableAfter = after.snapshot.objects.find(
      (object) => object.sceneObjectId === tableBefore.sceneObjectId,
    );
    assert.ok(tableAfter !== undefined);
    assert.ok(
      Math.abs(
        tableAfter.transform.position.x - (tableBefore.transform.position.x - 1),
      ) < 1e-6,
    );
    assert.equal(tableAfter.materialRefs.includes("mat-oak-table-dark"), true);
    assert.equal(wallFingerprint(after.snapshot.objects), wallsBefore);
    assert.equal(
      after.snapshot.objects.filter((object) => object.name === "杯子").length,
      1,
    );

    const undo = await app.interpretAndDispatch(
      "撤销",
      "natural_language",
      tavernId,
      "user",
    );
    assert.equal(undo[0]?.accepted, true);

    const stationAfter = await app.getSessionView(stationId);
    assert.equal(objectPose(stationAfter.snapshot.objects), stationPose);
    assert.equal(stationAfter.session.name, "空间站");
  } finally {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});
