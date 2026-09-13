import assert from "node:assert/strict";
import test from "node:test";
import { fitSpaceShellTransform, SHELL_FIT_RANGE } from "./space-shell-fit.js";

/**
 * zh: 层高是短板时按高度等比缩，不再用 footprints 把壳拉到 7 m 以上。
 * en: When height is the short side, scale by height. Do not keep a footprints-only 7 m shell.
 */
test("fitSpaceShellTransform is limited by height, not footprints", () => {
  const raw = { min: { x: 0, y: 0, z: 0 }, max: { x: 5, y: 3.4, z: 5 } };
  const target = { min: { x: 0, y: 0, z: 0 }, max: { x: 12, y: 4, z: 10 } };
  const fitted = fitSpaceShellTransform(raw, target);
  assert.ok(fitted !== undefined);
  const byHeight = 4 / 3.4;
  const byWidth = 12 / 5;
  const byDepth = 10 / 5;
  assert.ok(byHeight < byWidth && byHeight < byDepth);
  assert.equal(fitted.uniform, byHeight);
  assert.equal(fitted.transform.scale.x, byHeight);
  assert.equal(fitted.transform.scale.y, byHeight);
  assert.equal(fitted.transform.scale.z, byHeight);
  assert.ok(Math.abs(fitted.transform.position.y) < 1e-12);
});

/**
 * zh: 三个轴都够时，uniform 取最小比，壳贴在盒内。
 * en: When every axis fits, uniform is the min ratio and the shell stays inside the box.
 */
test("fitSpaceShellTransform takes the min axis ratio", () => {
  const raw = { min: { x: -1, y: 0, z: -2 }, max: { x: 1, y: 1, z: 2 } };
  const target = { min: { x: 0, y: 0, z: 0 }, max: { x: 8, y: 4, z: 6 } };
  const fitted = fitSpaceShellTransform(raw, target);
  assert.ok(fitted !== undefined);
  assert.equal(fitted.uniform, Math.min(8 / 2, 6 / 4, 4 / 1));
});

/**
 * zh: 壳比盒子大很多时缩到下限，不再除到 0。
 * en: A huge shell clamps to the minimum scale instead of collapsing.
 */
test("fitSpaceShellTransform clamps to SHELL_FIT_RANGE", () => {
  const tiny = fitSpaceShellTransform(
    { min: { x: 0, y: 0, z: 0 }, max: { x: 80, y: 80, z: 80 } },
    { min: { x: 0, y: 0, z: 0 }, max: { x: 2, y: 2, z: 2 } },
  );
  assert.equal(tiny?.uniform, SHELL_FIT_RANGE.min);
  const huge = fitSpaceShellTransform(
    { min: { x: 0, y: 0, z: 0 }, max: { x: 0.1, y: 0.1, z: 0.1 } },
    { min: { x: 0, y: 0, z: 0 }, max: { x: 12, y: 4, z: 10 } },
  );
  assert.equal(huge?.uniform, SHELL_FIT_RANGE.max);
});

/**
 * zh: 坏盒子不拟合。
 * en: Degenerate boxes do not fit.
 */
test("fitSpaceShellTransform rejects invalid boxes", () => {
  assert.equal(
    fitSpaceShellTransform(
      { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 1, z: 1 } },
      { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 1, z: 1 } },
    ),
    undefined,
  );
});
