import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { CarinaError } from "../errors.js";
import { resolvePosix } from "./index.js";

/**
 * zh: 断言抛出 SANDBOX / error.sandbox。
 * en: Assert a SANDBOX / error.sandbox throw.
 */
function assertSandbox(run: () => void): void {
  assert.throws(
    run,
    (error: unknown) =>
      error instanceof CarinaError &&
      error.code === "SANDBOX" &&
      error.messageKey === "error.sandbox",
  );
}

test("resolvePosix joins a safe POSIX path with node:path", () => {
  const packRoot = path.join(os.tmpdir(), "tavern.carina");
  const resolved = resolvePosix(packRoot, "assets/vase.png");
  assert.equal(
    resolved,
    path.join(path.resolve(packRoot), "assets", "vase.png"),
  );
  assert.equal(
    resolvePosix(packRoot, "WORLD.md"),
    path.join(path.resolve(packRoot), "WORLD.md"),
  );
});

test("resolvePosix rejects parent segments, absolute paths, and backslashes", () => {
  const packRoot = path.join(os.tmpdir(), "tavern.carina");
  assertSandbox(() => {
    resolvePosix(packRoot, "..");
  });
  assertSandbox(() => {
    resolvePosix(packRoot, "../WORLD.md");
  });
  assertSandbox(() => {
    resolvePosix(packRoot, "assets/../../etc/passwd");
  });
  assertSandbox(() => {
    resolvePosix(packRoot, "/etc/passwd");
  });
  assertSandbox(() => {
    resolvePosix(packRoot, "C:/windows/notepad.exe");
  });
  assertSandbox(() => {
    resolvePosix(packRoot, "assets\\vase.png");
  });
  assertSandbox(() => {
    resolvePosix(packRoot, "");
  });
});
