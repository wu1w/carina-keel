import assert from "node:assert/strict";
import test from "node:test";
import { NodeIO } from "@gltf-transform/core";
import { buildConnectedTavern } from "../spatial/primitive-tavern.js";
import {
  NPC_PROXY_SOURCE_LABEL,
  buildNpcProxyGlb,
  npcProxyAppearance,
} from "./npc-proxy.js";

/**
 * zh: 老板代理网格是命名人偶，不是单胶囊，也不声称世界模型。
 * en: The keeper proxy is a named figure, not a single capsule, and does not claim world-model generation.
 */
test("npc proxy glb is a named figure, not a capsule", async () => {
  const tavern = buildConnectedTavern("w1", "r1");
  const keeper = tavern.objects.find((object) => object.interactionProfile === "npc");
  assert.ok(keeper !== undefined);
  const bytes = buildNpcProxyGlb(keeper);
  assert.ok(bytes.byteLength > 12);
  const doc = await new NodeIO().readBinary(bytes);
  const names = doc
    .getRoot()
    .listNodes()
    .map((node) => node.getName());
  assert.ok(names.some((name) => name.includes("腿")));
  assert.ok(names.some((name) => name.includes("身")));
  assert.ok(names.some((name) => name.includes("头")));
  assert.ok(names.length >= 5, "legs/torso/head/arms — not one capsule");
  const appearance = npcProxyAppearance();
  assert.equal(appearance.kind, "proxy-mesh");
  assert.equal(appearance.sourceLabel, NPC_PROXY_SOURCE_LABEL);
});
