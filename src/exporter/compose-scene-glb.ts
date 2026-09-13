import {
  Document,
  Logger,
  Node as GltfNode,
  Scene,
  WebIO,
  type GLTF,
  type JSONDocument,
} from "@gltf-transform/core";
import { mergeDocuments, prune, unpartition } from "@gltf-transform/functions";
import { CarinaError } from "../errors.js";
import type { SceneObject, Transform, WorldSnapshot } from "../schema/index.js";
import { committedGltfAssetRef } from "../spatial/gltf-asset-ref.js";
import { objectToLocalMesh } from "../spatial/object-mesh.js";
import {
  eulerXyzToQuaternion,
  isUnsafeAssetRef,
  isUnsupportedMeshAssetRef,
  resolvePackAsset,
  uniqueGlbNodeName,
  type ReadPackAsset,
} from "./asset-ref.js";
import { buildMeshesGlb } from "./glb.js";

const io = new WebIO().setLogger(new Logger(Logger.Verbosity.ERROR));

export type ComposedObjectMapping = {
  sceneObjectId: string;
  name: string;
  glbNode: string;
};

type PrimitiveNode = {
  name: string;
  translation: { x: number; y: number; z: number };
  mesh: ReturnType<typeof objectToLocalMesh>;
  sceneObjectId: string;
};

/**
 * zh: 把已提交 glTF 与粗模对象合成一个场景 GLB。
 * en: Compose committed glTF assets and primitive objects into one scene GLB.
 */
export async function composeSceneGlb(input: {
  objects: SceneObject[];
  snapshot: WorldSnapshot;
  readAsset: ReadPackAsset;
}): Promise<{
  glb: Uint8Array;
  objectMapping: ComposedObjectMapping[];
  materialNames: string[];
}> {
  const dest = new Document().setLogger(new Logger(Logger.Verbosity.ERROR));
  dest.getRoot().getAsset().generator = "Carina";
  dest.getRoot().getAsset().version = "2.0";
  const scene = dest.createScene("Scene");
  dest.getRoot().setDefaultScene(scene);

  const usedNames = new Set<string>();
  const objectMapping: ComposedObjectMapping[] = [];
  const primitiveNodes: PrimitiveNode[] = [];

  for (const object of input.objects) {
    assertSafeRefs(object);
    const gltfRef = committedGltfAssetRef(object);
    if (gltfRef === undefined) {
      const unsupported = object.assetRefs.find(isUnsupportedMeshAssetRef);
      if (unsupported !== undefined) {
        throw exportFailed(
          "unsupported_asset",
          object.sceneObjectId,
          unsupported,
        );
      }
      const name = uniqueGlbNodeName(object, usedNames);
      primitiveNodes.push({
        name,
        translation: object.transform.position,
        mesh: objectToLocalMesh(object),
        sceneObjectId: object.sceneObjectId,
      });
      objectMapping.push({
        sceneObjectId: object.sceneObjectId,
        name: object.name,
        glbNode: name,
      });
      continue;
    }
    const resolved = resolvePackAsset(gltfRef, input.snapshot.assetManifest);
    if (resolved === undefined) {
      throw exportFailed("missing_asset", object.sceneObjectId, gltfRef);
    }
    const bytes = await readCommittedBytes(
      input.readAsset,
      resolved.hash,
      resolved.ext,
      object.sceneObjectId,
      resolved.posixPath,
    );
    const source = await parseGltfBytes(
      bytes,
      resolved.ext,
      object.sceneObjectId,
      resolved.posixPath,
    );
    const name = uniqueGlbNodeName(object, usedNames);
    const wrapper = dest.createNode(name);
    wrapper.setExtras({ sceneObjectId: object.sceneObjectId });
    applyInstanceTransform(wrapper, object.transform);
    attachSourceHierarchy(dest, scene, wrapper, source);
    nameImportedMeshes(wrapper, name, usedNames);
    scene.addChild(wrapper);
    objectMapping.push({
      sceneObjectId: object.sceneObjectId,
      name: object.name,
      glbNode: name,
    });
  }

  if (primitiveNodes.length > 0) {
    await attachPrimitiveMeshes(dest, scene, primitiveNodes);
  }

  dropExtraScenes(dest, scene);
  if (dest.getRoot().listBuffers().length > 1) {
    await dest.transform(unpartition());
  }
  await dest.transform(prune());
  dest.getRoot().getAsset().generator = "Carina";
  const glb = await io.writeBinary(dest);
  const materialNames = dest
    .getRoot()
    .listMaterials()
    .map((material) => material.getName())
    .filter((name) => name.length > 0);
  return { glb, objectMapping, materialNames };
}

function applyInstanceTransform(node: GltfNode, transform: Transform): void {
  node.setTranslation([
    transform.position.x,
    transform.position.y,
    transform.position.z,
  ]);
  node.setRotation(eulerXyzToQuaternion(transform.rotation));
  node.setScale([transform.scale.x, transform.scale.y, transform.scale.z]);
}

function attachSourceHierarchy(
  dest: Document,
  destScene: Scene,
  wrapper: GltfNode,
  source: Document,
): void {
  const map = mergeDocuments(dest, source);
  const sourceScenes = source.getRoot().listScenes();
  if (sourceScenes.length > 0) {
    for (const sourceScene of sourceScenes) {
      for (const child of sourceScene.listChildren()) {
        const copied = map.get(child);
        if (copied instanceof GltfNode) {
          wrapper.addChild(copied);
        }
      }
      const copiedScene = map.get(sourceScene);
      if (copiedScene instanceof Scene) {
        copiedScene.dispose();
      }
    }
  } else {
    for (const node of source.getRoot().listNodes()) {
      const copied = map.get(node);
      if (copied instanceof GltfNode && copied.getParentNode() === null) {
        wrapper.addChild(copied);
      }
    }
  }
  dropExtraScenes(dest, destScene);
}

const GENERIC_MESH = /^(geometry(_\d+)?|\d+)$/i;
const GENERIC_MATERIAL = /^(material(_\d+)?)$/i;
const GENERIC_TEXTURE = /^(image(_\d+)?)$/i;

/**
 * zh: 把 TripoSR 的 geometry_0 / Material_0 改成物件名，方便 DCC 点选。已有 bar-body 等名字不动。
 * en: Rename TripoSR geometry_0 / Material_0 to the object name for DCC picking. Keep names like bar-body.
 */
function nameImportedMeshes(
  wrapper: GltfNode,
  objectName: string,
  used: Set<string>,
): void {
  const stack = [...wrapper.listChildren()];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined) {
      continue;
    }
    stack.push(...node.listChildren());
    const mesh = node.getMesh();
    if (mesh === null) {
      continue;
    }
    if (isGenericName(node.getName(), GENERIC_MESH)) {
      node.setName(uniqueImportedName(`${objectName}_mesh`, used));
    }
    if (isGenericName(mesh.getName(), GENERIC_MESH)) {
      mesh.setName(node.getName());
    }
    for (const prim of mesh.listPrimitives()) {
      const material = prim.getMaterial();
      if (material === null) {
        continue;
      }
      if (isGenericName(material.getName(), GENERIC_MATERIAL)) {
        material.setName(`${objectName}-pbr`);
      }
      const texture = material.getBaseColorTexture();
      if (texture !== null && isGenericName(texture.getName(), GENERIC_TEXTURE)) {
        texture.setName(`${objectName}-albedo`);
      }
    }
  }
}

function isGenericName(name: string, pattern: RegExp): boolean {
  const trimmed = name.trim();
  return trimmed.length === 0 || pattern.test(trimmed);
}

function uniqueImportedName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}_${n}`)) {
    n += 1;
  }
  const name = `${base}_${n}`;
  used.add(name);
  return name;
}

async function attachPrimitiveMeshes(
  dest: Document,
  destScene: Scene,
  nodes: PrimitiveNode[],
): Promise<void> {
  const primGlb = buildMeshesGlb(
    nodes.map((node) => ({
      name: node.name,
      translation: node.translation,
      mesh: {
        positions: node.mesh.positions,
        normals: node.mesh.normals,
        indices: node.mesh.indices,
        albedo: node.mesh.albedo,
      },
    })),
  );
  const primDoc = await io.readBinary(primGlb);
  const map = mergeDocuments(dest, primDoc);
  const sourceScene = primDoc.getRoot().listScenes()[0];
  if (sourceScene === undefined) {
    return;
  }
  const copiedScene = map.get(sourceScene);
  if (!(copiedScene instanceof Scene)) {
    return;
  }
  const idByName = new Map(
    nodes.map((node) => [node.name, node.sceneObjectId]),
  );
  for (const child of copiedScene.listChildren()) {
    destScene.addChild(child);
    const sceneObjectId = idByName.get(child.getName());
    if (sceneObjectId !== undefined) {
      child.setExtras({ ...child.getExtras(), sceneObjectId });
    }
  }
  copiedScene.dispose();
  dropExtraScenes(dest, destScene);
}

async function readCommittedBytes(
  readAsset: ReadPackAsset,
  hash: string,
  ext: string,
  sceneObjectId: string,
  posixPath: string,
): Promise<Uint8Array> {
  try {
    const bytes = await readAsset(hash, ext);
    return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  } catch (error) {
    throw exportFailed("missing_asset", sceneObjectId, posixPath, error);
  }
}

async function parseGltfBytes(
  bytes: Uint8Array,
  ext: string,
  sceneObjectId: string,
  posixPath: string,
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
        throw exportFailed("unsupported_asset", sceneObjectId, posixPath);
      }
      const jsonDoc: JSONDocument = { json, resources: {} };
      return await io.readJSON(jsonDoc);
    }
    throw exportFailed("unsupported_asset", sceneObjectId, posixPath);
  } catch (error) {
    if (error instanceof CarinaError) {
      throw error;
    }
    throw exportFailed("corrupt_asset", sceneObjectId, posixPath, error);
  }
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

function isGlbMagic(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46
  );
}

function dropExtraScenes(dest: Document, keep: Scene): void {
  for (const extra of dest.getRoot().listScenes()) {
    if (extra !== keep) {
      extra.dispose();
    }
  }
}

function assertSafeRefs(object: SceneObject): void {
  for (const ref of object.assetRefs) {
    if (isUnsafeAssetRef(ref)) {
      throw exportFailed("unsafe_asset_path", object.sceneObjectId, ref);
    }
  }
}

function exportFailed(
  reason: string,
  sceneObjectId: string,
  posixPath: string,
  cause?: unknown,
): CarinaError {
  return new CarinaError("EXPORT_FAILED", "error.exportFailed", {
    reason,
    sceneObjectId,
    posixPath,
    ...(cause !== undefined ? { cause } : {}),
  });
}
