import assert from "node:assert/strict";
import test from "node:test";
import { compileWorldRules } from "../spatial/compile-world-rules.js";
import { buildPrimitiveTavern } from "../spatial/primitive-tavern.js";
import type { WorldSnapshot } from "../schema/index.js";
import { buildModelExport } from "./build-model-export.js";

/**
 * zh: GLB 节点可分别选中门与三把椅子。
 * en: GLB nodes include the door and three chairs as separately named meshes.
 */
test("GLB names the door and three chairs", async () => {
  const worldId = "export-world";
  const revision = "export-rev";
  const tavern = buildPrimitiveTavern(worldId, revision);
  const snapshot = snapshotOf(worldId, revision, tavern);
  const { glb, manifest } = await buildModelExport({
    snapshot,
    objects: tavern.objects,
    regions: tavern.regions,
  });
  const json = parseGlbJson(glb);
  const names = (json.nodes ?? []).map((node) => node.name ?? "");
  assert.equal(names.includes("门"), true);
  assert.equal(names.includes("椅子1"), true);
  assert.equal(names.includes("椅子2"), true);
  assert.equal(names.includes("椅子3"), true);
  assert.equal(names.includes("杯子"), true);
  const cupNode = json.nodes?.find((node) => node.name === "杯子");
  assert.ok(cupNode !== undefined);
  const cupMesh = json.meshes?.[cupNode.mesh ?? -1];
  const posAccessor = json.accessors?.[cupMesh?.primitives[0]?.attributes.POSITION ?? -1];
  assert.ok((posAccessor?.count ?? 0) > 24);
  assert.equal(manifest.profile, "blender_glb");
  assert.equal(manifest.license, "unknown");
  assert.notEqual(manifest.license, "commercial");
  assert.equal(
    manifest.files.every((file) => !/^https?:/i.test(file.posixPath)),
    true,
  );
  assert.equal(manifest.units, "meters");
  assert.equal(manifest.coordinateFrame.up, "y");
  assert.equal(
    manifest.objectMapping.some((entry) => entry.name === "门"),
    true,
  );
});

/**
 * zh: 解析 GLB JSON 块。
 * en: Parse the GLB JSON chunk.
 */
function parseGlbJson(glb: Uint8Array): {
  nodes?: Array<{ name?: string; mesh?: number }>;
  meshes?: Array<{
    primitives: Array<{ attributes: { POSITION: number } }>;
  }>;
  accessors?: Array<{ count?: number }>;
} {
  const view = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert.equal(view.getUint32(0, true), 0x46546c67);
  assert.equal(view.getUint32(4, true), 2);
  const jsonLength = view.getUint32(12, true);
  assert.equal(view.getUint32(16, true), 0x4e4f534a);
  const jsonBytes = glb.subarray(20, 20 + jsonLength);
  return JSON.parse(new TextDecoder().decode(jsonBytes)) as {
    nodes?: Array<{ name?: string; mesh?: number }>;
    meshes?: Array<{
      primitives: Array<{ attributes: { POSITION: number } }>;
    }>;
    accessors?: Array<{ count?: number }>;
  };
}

/**
 * zh: 测试用一致快照。
 * en: Consistent snapshot for tests.
 */
function snapshotOf(
  worldId: string,
  revision: string,
  tavern: ReturnType<typeof buildPrimitiveTavern>,
): WorldSnapshot {
  const createdAt = "2026-09-10T00:00:00.000Z";
  const assetManifest = tavern.regions.flatMap((region) =>
    region.visualRefs.map((posixPath) => ({
      posixPath,
      hash: posixPath.split("/").at(-1)?.replace(/\.mesh$/i, "") ?? posixPath,
    })),
  );
  return {
    revision,
    parentRevision: null,
    worldId,
    createdAt,
    session: {
      sessionId: worldId,
      name: "Tavern",
      schemaVersion: 1,
      lifecycle: "active",
      runState: "paused",
      headRevision: revision,
      controlEpoch: 0,
      simTime: 0,
      playerStateRef: "player",
      worldRulesRef: "WORLD.md",
      ruleDocumentRefs: { "WORLD.md": "abc" },
      globalProfileRef: "def",
      activeRegionId: tavern.regions[0]?.regionId ?? null,
      budgetPolicy: {
        maxAutoJobs: 2,
        maxRepairAttempts: 2,
        maxRunSeconds: 3600,
      },
      createdAt,
      updatedAt: createdAt,
    },
    graph: { version: 0, nodes: [], edges: [] },
    worldRules: compileWorldRules("禁止瞬移。", revision, "hash"),
    regions: tavern.regions,
    objects: tavern.objects,
    simTime: 0,
    controlEpoch: 0,
    assetManifest,
  };
}
