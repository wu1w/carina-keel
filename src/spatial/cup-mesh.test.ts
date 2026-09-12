import assert from "node:assert/strict";
import test from "node:test";
import { buildPrimitiveTavern } from "./primitive-tavern.js";
import { cupToLocalMesh } from "./cup-mesh.js";

/**
 * zh: 杯子网格是杯状，不是 12 三角盒子。
 * en: The cup mesh is cup-shaped, not a 12-triangle box.
 */
test("cupToLocalMesh is not a box", () => {
  const tavern = buildPrimitiveTavern("cup-a", "rev-a");
  const cup = tavern.objects.find((object) => object.name === "杯子");
  assert.ok(cup !== undefined);
  const mesh = cupToLocalMesh(cup);
  assert.equal(mesh.shape, "cup");
  assert.ok(mesh.indices.length > 36);
  assert.equal(mesh.indices.length % 3, 0);
  assert.equal(mesh.textureHash, undefined);
  assert.equal(
    mesh.positions.every((value) => Number.isFinite(value)),
    true,
  );
});
