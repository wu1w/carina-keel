import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

/**
 * zh: 缺省语言为中文，端口为 18790。
 * en: Default language is Chinese and the port is 18790.
 */
test("loadConfig defaults lang to zh and port to 18790", () => {
  const config = loadConfig({});
  assert.equal(config.lang, "zh");
  assert.equal(config.port, 18790);
  assert.equal(config.token, "dev-token");
  assert.equal(config.model, "gpt-4o-mini");
  assert.equal(config.apiKey, undefined);
  assert.equal(config.pack, undefined);
  assert.equal(config.rendererUrl, undefined);
  assert.ok(config.dataDir.endsWith(".carina"));
  assert.equal(config.pixelStreamingUrl, "http://192.168.5.16:8080");
});

/**
 * zh: CARINA_* 覆盖缺省；OPENAI_API_KEY 可作 fallback。
 * en: CARINA_* overrides defaults; OPENAI_API_KEY is an allowed fallback.
 */
test("loadConfig reads CARINA_* and falls back to OPENAI_API_KEY", () => {
  const config = loadConfig({
    CARINA_LANG: "en",
    CARINA_PORT: "19001",
    CARINA_TOKEN: "secret",
    CARINA_MODEL: "local-model",
    CARINA_MODEL_BASE_URL: "http://127.0.0.1:8080/v1",
    CARINA_PACK: "./tavern.carina",
    CARINA_DATA_DIR: "/tmp/carina-data",
    CARINA_RENDERER_URL: "http://127.0.0.1:18791",
    OPENAI_API_KEY: "sk-test",
  });
  assert.equal(config.lang, "en");
  assert.equal(config.port, 19001);
  assert.equal(config.token, "secret");
  assert.equal(config.model, "local-model");
  assert.equal(config.modelBaseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(config.pack, "./tavern.carina");
  assert.equal(config.dataDir, "/tmp/carina-data");
  assert.equal(config.apiKey, "sk-test");
  assert.equal(config.rendererUrl, "http://127.0.0.1:18791");
});

/**
 * zh: CARINA_API_KEY 优先于 OPENAI_API_KEY。
 * en: CARINA_API_KEY wins over OPENAI_API_KEY.
 */
test("loadConfig prefers CARINA_API_KEY over OPENAI_API_KEY", () => {
  const config = loadConfig({
    CARINA_API_KEY: "carina-key",
    OPENAI_API_KEY: "openai-key",
  });
  assert.equal(config.apiKey, "carina-key");
});

/**
 * zh: 空的 CARINA_RENDERER_URL 视为未设置。
 * en: An empty CARINA_RENDERER_URL is treated as unset.
 */
test("loadConfig treats empty CARINA_RENDERER_URL as unset", () => {
  const config = loadConfig({ CARINA_RENDERER_URL: "" });
  assert.equal(config.rendererUrl, undefined);
});

/**
 * zh: 空的网格提供者 URL / 密钥文件视为未设置。
 * en: Empty mesh-provider URL and key-file paths are treated as unset.
 */
test("loadConfig treats empty mesh provider URL and key file as unset", () => {
  const empty = loadConfig({
    CARINA_MESH_PROVIDER_URL: "",
    CARINA_MESH_PROVIDER_KEY_FILE: "",
  });
  assert.equal(empty.meshProviderUrl, undefined);
  assert.equal(empty.meshProviderKeyFile, undefined);
  const set = loadConfig({
    CARINA_MESH_PROVIDER_URL: "http://127.0.0.1:18795",
    CARINA_MESH_PROVIDER_KEY_FILE: "/tmp/mesh-key",
  });
  assert.equal(set.meshProviderUrl, "http://127.0.0.1:18795");
  assert.equal(set.meshProviderKeyFile, "/tmp/mesh-key");
  const stream = loadConfig({
    CARINA_PIXEL_STREAMING_URL: "http://192.168.5.16:8080",
  });
  assert.equal(stream.pixelStreamingUrl, "http://192.168.5.16:8080");
  const wr = loadConfig({
    CARINA_WORLD_RUNTIME_URL: "http://127.0.0.1:18794",
    CARINA_WORLD_RUNTIME_COOK: "1",
  });
  assert.equal(wr.worldRuntimeUrl, "http://127.0.0.1:18794");
  assert.equal(wr.worldRuntimeCook, true);
  const wrOff = loadConfig({ CARINA_WORLD_RUNTIME_URL: "" });
  assert.equal(wrOff.worldRuntimeUrl, undefined);
  assert.equal(wrOff.worldRuntimeCook, undefined);
  const solarOff = loadConfig({ CARINA_SOLARWM_ROOT: "" });
  assert.equal(solarOff.solarWmRoot, undefined);
  const solarOn = loadConfig({ CARINA_SOLARWM_ROOT: "/tmp/carina-solarwm" });
  assert.equal(solarOn.solarWmRoot, "/tmp/carina-solarwm");
});

test("exploration defaults are proactive and invalid budgets stay bounded", () => {
  const defaults=loadConfig({});
  assert.equal(defaults.explorationBudget,192);
  assert.equal(defaults.explorationWarmupViews,24);
  const invalid=loadConfig({CARINA_EXPLORATION_BUDGET:"Infinity",CARINA_WARMUP_VIEWS:"-2"});
  assert.equal(invalid.explorationBudget,192);
  assert.equal(invalid.explorationWarmupViews,24);
  assert.equal(loadConfig({CARINA_EXPLORATION_BUDGET:"99999"}).explorationBudget,1024);
});
