/**
 * zh: 空间模块出口。
 * en: Spatial module exports.
 */
export { compileWorldRules } from "./compile-world-rules.js";
export { METRIC_Y_UP } from "./metric-frame.js";
export {
  aabbOverlaps,
  isFiniteVec3,
  isValidAabb,
  pointInAabb,
  uprightAabb,
  xzDistance,
} from "./aabb.js";
export {
  buildPrimitiveTavern,
  buildConnectedTavern,
  extendPrimitiveGarden,
  tavernCandidate,
  type GardenExtension,
  type PrimitiveTavern,
} from "./primitive-tavern.js";
export {
  approachingDoor,
  beyondDoor,
  DOOR_APPROACH_RANGE,
  doorOf,
  hasAdjacentExtension,
  interiorRegion,
  portalSeamOk,
  SEAM_TOLERANCE_M,
  shouldPreGenerateNextRegion,
  spatialWorldId,
} from "./extend-region.js";
export {
  aabbToLocalMesh,
  captureCameraFromPlayer,
  EYE_HEIGHT,
  type CaptureCamera,
  type TriangleMesh,
} from "./box-mesh.js";
export { cupToLocalMesh } from "./cup-mesh.js";
export {
  isArchitectural,
  objectToLocalMesh,
} from "./object-mesh.js";
export {
  applyRuntimeToObjects,
  placeObject,
} from "./live-objects.js";
export {
  bakeMapAssets,
  type BakedMapAssets,
} from "./bake-map.js";
export {
  committedGltfAssetRef,
  hasCommittedGltfAsset,
  isCommittedGltfAssetRef,
} from "./gltf-asset-ref.js";
export { aabbFromGltfBytes } from "./gltf-bounds.js";
export {
  buildCommittedMapView,
  encodeCaptureCamera,
  encodeMeshJson,
  parseCaptureCamera,
  textureHashFromSnapshot,
  type CommittedMapView,
} from "./committed-map.js";
export {
  validateSpatialCandidate,
  type ValidateSpatialOpts,
} from "./validate.js";
export {
  instantiateSceneSpecScaffolds,
  mergeSceneSpecScaffolds,
  objectsForModelExport,
} from "./instantiate-scene-spec.js";
export { composeGeneratedScene } from "./compose-generated-scene.js";
export { buildReferenceBundle } from "./reference-bundle.js";
