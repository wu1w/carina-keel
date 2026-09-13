import { NPC_PROXY_SOURCE_LABEL, buildNpcProxyGlb } from "../assets/npc-proxy.js";
import type { SceneObject } from "../schema/index.js";
import type { UePublishAsset } from "./ue-world-runtime-client.js";

export type NpcProxyPublish = {
  objects: SceneObject[];
  assets: UePublishAsset[];
};

/**
 * zh: 把已提交 NPC 做成代理网格发布条目。没有 NPC 则 undefined。
 *     标签固定 proxy-mesh，claimsWorldModelGeneration 永远 false。
 * en: Build WorldRuntime publish entries for committed NPCs. Undefined when there is no NPC.
 *     Label is fixed to proxy-mesh; claimsWorldModelGeneration is always false.
 */
export function buildNpcProxyPublish(
  objects: SceneObject[],
): NpcProxyPublish | undefined {
  const npcs = objects.filter(
    (object) =>
      object.interactionProfile === "npc" || object.mobility === "actor",
  );
  if (npcs.length === 0) {
    return undefined;
  }
  return {
    objects: npcs,
    assets: npcs.map((npc) => ({
      bytes: buildNpcProxyGlb(npc),
      originalFilename: `${npc.sceneObjectId}.glb`,
      objectId: npc.sceneObjectId,
      bakedWorldSpace: false,
      sourceLabel: NPC_PROXY_SOURCE_LABEL,
      claimsWorldModelGeneration: false,
    })),
  };
}
