import assert from "node:assert/strict";
import test from "node:test";
import { NPC_PROXY_SOURCE_LABEL } from "../assets/npc-proxy.js";
import { buildConnectedTavern } from "../spatial/primitive-tavern.js";
import { buildNpcProxyPublish } from "./npc-proxy-publish.js";

/**
 * zh: 已提交老板出一条代理网格，不声称世界模型。
 * en: The committed keeper publishes one proxy mesh and never claims world-model generation.
 */
test("npc proxy publish is one proxy-mesh per actor", () => {
  const tavern = buildConnectedTavern("w1", "r1");
  const published = buildNpcProxyPublish(tavern.objects);
  assert.ok(published !== undefined);
  assert.equal(published.objects.length, 1);
  assert.equal(published.objects[0]?.name, "老板");
  assert.equal(published.assets.length, 1);
  const asset = published.assets[0];
  assert.ok(asset !== undefined);
  assert.equal(asset.sourceLabel, NPC_PROXY_SOURCE_LABEL);
  assert.equal(asset.claimsWorldModelGeneration, false);
  assert.equal(asset.bakedWorldSpace, false);
  assert.ok((asset.bytes?.byteLength ?? 0) > 12);
});

test("no npc → no proxy publish", () => {
  const tavern = buildConnectedTavern("w2", "r1");
  const without = tavern.objects.filter(
    (object) =>
      object.interactionProfile !== "npc" && object.mobility !== "actor",
  );
  assert.equal(buildNpcProxyPublish(without), undefined);
});
