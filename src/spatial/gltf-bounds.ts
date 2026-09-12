import {
  Document,
  Logger,
  WebIO,
  getBounds,
  type GLTF,
  type JSONDocument,
} from "@gltf-transform/core";
import { CarinaError } from "../errors.js";
import type { Aabb, Transform } from "../schema/index.js";
import { isValidAabb } from "./aabb.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

/** zh: 平面网格轴上最少厚度，保证 AABB 可校验。 en: Minimum axis thickness so a planar AABB still validates. */
const MIN_AXIS_EXTENT = 1e-3;

/**
 * zh: 从 glTF/GLB 几何推导世界 AABB。推不出则抛 VALIDATION_FAILED，不给假盒子。
 * en: Derive a world AABB from glTF/GLB geometry. Throw VALIDATION_FAILED if it cannot; no fake box.
 */
export async function aabbFromGltfBytes(
  bytes: Uint8Array,
  ext: string,
  transform: Transform,
): Promise<Aabb> {
  const document = await parseGltfDocument(bytes, ext);
  applyInstanceTransform(document, transform);
  const box = unionSceneBounds(document);
  if (box === undefined) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
  }
  const padded = padDegenerateAxes(box);
  if (!isValidAabb(padded)) {
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
  }
  return padded;
}

async function parseGltfDocument(
  bytes: Uint8Array,
  ext: string,
): Promise<Document> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  try {
    const lower = ext.toLowerCase();
    if (lower === "glb" || isGlbMagic(copy)) {
      return await io.readBinary(copy);
    }
    if (lower === "gltf") {
      const json = JSON.parse(new TextDecoder().decode(copy)) as GLTF.IGLTF;
      if (gltfJsonHasExternalUri(json)) {
        throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
      }
      const jsonDoc: JSONDocument = { json, resources: {} };
      return await io.readJSON(jsonDoc);
    }
  } catch (error) {
    if (error instanceof CarinaError) {
      throw error;
    }
    throw new CarinaError("VALIDATION_FAILED", "error.validationFailed", error);
  }
  throw new CarinaError("VALIDATION_FAILED", "error.validationFailed");
}

function applyInstanceTransform(document: Document, transform: Transform): void {
  const wrapperName = "carina-instance";
  const translation: [number, number, number] = [
    transform.position.x,
    transform.position.y,
    transform.position.z,
  ];
  const rotation = eulerXyzToQuaternion(transform.rotation);
  const scale: [number, number, number] = [
    transform.scale.x,
    transform.scale.y,
    transform.scale.z,
  ];
  const scenes = document.getRoot().listScenes();
  if (scenes.length > 0) {
    for (const scene of scenes) {
      const roots = scene.listChildren();
      const wrapper = document.createNode(wrapperName);
      wrapper.setTranslation(translation);
      wrapper.setRotation(rotation);
      wrapper.setScale(scale);
      for (const root of roots) {
        wrapper.addChild(root);
      }
      scene.addChild(wrapper);
    }
    return;
  }
  const floating = document
    .getRoot()
    .listNodes()
    .filter((node) => node.getParentNode() === null);
  if (floating.length === 0) {
    return;
  }
  const scene = document.createScene("carina-bounds");
  const wrapper = document.createNode(wrapperName);
  wrapper.setTranslation(translation);
  wrapper.setRotation(rotation);
  wrapper.setScale(scale);
  for (const node of floating) {
    wrapper.addChild(node);
  }
  scene.addChild(wrapper);
}

function unionSceneBounds(document: Document): Aabb | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let found = false;
  const scenes = document.getRoot().listScenes();
  const targets = scenes.length > 0 ? scenes : document.getRoot().listNodes();
  for (const target of targets) {
    const bounds = getBounds(target);
    if (
      !bounds.min.every(Number.isFinite) ||
      !bounds.max.every(Number.isFinite)
    ) {
      continue;
    }
    found = true;
    minX = Math.min(minX, bounds.min[0]);
    minY = Math.min(minY, bounds.min[1]);
    minZ = Math.min(minZ, bounds.min[2]);
    maxX = Math.max(maxX, bounds.max[0]);
    maxY = Math.max(maxY, bounds.max[1]);
    maxZ = Math.max(maxZ, bounds.max[2]);
  }
  if (!found) {
    return undefined;
  }
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
  };
}

function padDegenerateAxes(box: Aabb): Aabb {
  const padAxis = (min: number, max: number): { min: number; max: number } => {
    if (max - min >= MIN_AXIS_EXTENT) {
      return { min, max };
    }
    const mid = (min + max) / 2;
    const half = MIN_AXIS_EXTENT / 2;
    return { min: mid - half, max: mid + half };
  };
  const x = padAxis(box.min.x, box.max.x);
  const y = padAxis(box.min.y, box.max.y);
  const z = padAxis(box.min.z, box.max.z);
  return {
    min: { x: x.min, y: y.min, z: z.min },
    max: { x: x.max, y: y.max, z: z.max },
  };
}

function gltfJsonHasExternalUri(json: GLTF.IGLTF): boolean {
  const lists = [json.buffers, json.images];
  for (const list of lists) {
    if (list === undefined) {
      continue;
    }
    for (const item of list) {
      const uri = item.uri;
      if (typeof uri === "string" && uri.length > 0 && !uri.startsWith("data:")) {
        return true;
      }
    }
  }
  return false;
}


function eulerXyzToQuaternion(rotation: {
  x: number;
  y: number;
  z: number;
}): [number, number, number, number] {
  const cx = Math.cos(rotation.x / 2);
  const sx = Math.sin(rotation.x / 2);
  const cy = Math.cos(rotation.y / 2);
  const sy = Math.sin(rotation.y / 2);
  const cz = Math.cos(rotation.z / 2);
  const sz = Math.sin(rotation.z / 2);
  return [
    sx * cy * cz + cx * sy * sz,
    cx * sy * cz - sx * cy * sz,
    cx * cy * sz + sx * sy * cz,
    cx * cy * cz - sx * sy * sz,
  ];
}

function isGlbMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  );
}
