/**
 * zh: 场景计划编译器。自然语言 → SceneSpec。不是三维生成。
 * en: Scene plan compiler. Natural language to SceneSpec. Not 3D generation.
 */
export {
  applySceneSpecCalibrate,
  applySceneSpecExtend,
  attachSceneSpec,
  carrySceneSpec,
  compileSceneSpec,
  encodeSceneSpecBytes,
  findSceneSpecObject,
  firstGenerateObject,
  heuristicSceneSpec,
  resolveBarPlanObjectId,
  sceneSpecFromSnapshot,
  SCENE_SPEC_ASSET_EXT,
  type CompileSceneSpec,
  type CompileSceneSpecInput,
} from "./compile-scene-spec.js";
export {
  compileAssetPlan,
  type CompileAssetPlanInput,
} from "./compile-asset-plan.js";
