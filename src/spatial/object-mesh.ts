import type { SceneObject } from "../schema/index.js";
import {
  aabbToLocalMesh,
  type CaptureCamera,
  type TriangleMesh,
} from "./box-mesh.js";
import { cupToLocalMesh } from "./cup-mesh.js";

/**
 * zh: 室内墙和地板可贴房间静帧。花园不贴。
 * en: Interior walls and floor may take the room still. The garden does not.
 */
export function isArchitectural(object: SceneObject): boolean {
  if (object.name.includes("花园")) {
    return false;
  }
  return object.name.includes("墙") || object.name.includes("地板");
}

/**
 * zh: 按对象种类生成局部网格。杯子不是盒子。
 * en: Build a local mesh by object kind. A cup is not a box.
 */
export function objectToLocalMesh(
  object: SceneObject,
  camera?: CaptureCamera,
  textureHash?: string,
): TriangleMesh {
  if (object.interactionProfile === "pickup") {
    return cupToLocalMesh(object);
  }
  if (isArchitectural(object) && textureHash !== undefined) {
    return aabbToLocalMesh(object, camera, textureHash);
  }
  return aabbToLocalMesh(object);
}
