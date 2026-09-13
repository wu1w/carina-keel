import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import type { CarinaConfig } from "../config.js";
import {
  createProductionDeps,
  upgradeProductionDeps,
  wrapProvider,
} from "./load-deps.js";

function config(dataDir: string, extra: Partial<CarinaConfig> = {}): CarinaConfig {
  return {
    apiKey: undefined,
    model: "gpt-4o-mini",
    modelBaseUrl: "https://api.openai.com/v1",
    token: "dev-token",
    port: 18790,
    pack: undefined,
    lang: "zh",
    dataDir,
    ...extra,
  };
}

test("upgradeProductionDeps overlays production provider from mesh URL", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-upgrade-"));
  try {
    const deps = createProductionDeps(config(dataDir));
    assert.equal(deps.provider.getCapabilities().id, "mesh-unset");
    upgradeProductionDeps(config(dataDir, { meshProviderUrl: "http://127.0.0.1:18795" }), deps);
    assert.equal(deps.provider.getCapabilities().id, "http-native-mesh");
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});

test("upgradeProductionDeps keeps injected provider", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "carina-upgrade-inj-"));
  try {
    const deps = createProductionDeps(config(dataDir));
    const injected = wrapProvider(config(dataDir, { allowPrimitiveFixture: true }));
    upgradeProductionDeps(
      config(dataDir, { meshProviderUrl: "http://127.0.0.1:18795" }),
      deps,
      { provider: injected },
    );
    assert.equal(deps.provider.getCapabilities().id, injected.getCapabilities().id);
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
