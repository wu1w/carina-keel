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
    OPENAI_API_KEY: "sk-test",
  });
  assert.equal(config.lang, "en");
  assert.equal(config.port, 19001);
  assert.equal(config.token, "secret");
  assert.equal(config.model, "local-model");
  assert.equal(config.modelBaseUrl, "http://127.0.0.1:8080/v1");
  assert.equal(config.pack, "./tavern.carina");
  assert.equal(config.apiKey, "sk-test");
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
