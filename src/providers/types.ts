import type {
  CandidateRevision,
  GenerationPlan,
  ProviderCapabilities,
  SceneSpec,
} from "../schema/index.js";

/**
 * zh: 生成适配器带回的网格字节。assetRefs 的内容哈希要等 pack.stageAsset 之后才能填。
 * en: Mesh bytes from a generation adapter. Content-hash assetRefs are filled after pack.stageAsset.
 */
export type GeneratedMeshAsset = {
  bytes: Uint8Array;
  ext: "glb" | "gltf";
  objectId?: string;
};

/**
 * zh: 本次要向 native-mesh HTTP 请求的特色物件。来自 SceneSpec route: generate，不是已生成网格。
 * en: Featured object for one native-mesh HTTP request. Taken from SceneSpec route: generate; not an already generated mesh.
 */
export type NativeMeshGenerateTarget = {
  objectId: string;
  name: string;
  role: string;
  dimensions?: { x: number; y: number; z: number };
  anchor?: { x: number; y: number; z: number };
};

/**
 * zh: submitGeneration 可选上下文。计划来源不得改写成 native-mesh / world-model。
 * en: Optional submitGeneration context. Plan provenance must not be rewritten to native-mesh / world-model.
 */
export type NativeMeshSubmitExtras = {
  sceneSpec?: SceneSpec;
  generateTarget?: NativeMeshGenerateTarget;
};

/**
 * zh: 生成适配器。能力必须如实声明，不得用文字假装已支持。
 * en: Generation adapter. Capabilities must be honest; text must not fake support.
 */
export type GenerationProvider = {
  getCapabilities(): ProviderCapabilities;
  submitGeneration(
    plan: GenerationPlan,
    extras?: NativeMeshSubmitExtras,
  ): Promise<{
    jobId: string;
    candidate?: CandidateRevision;
    assets?: GeneratedMeshAsset[];
  }>;
  cancelJob(
    jobId: string,
  ): Promise<{
    cancelCapability: "none" | "stop_commit" | "stop_compute";
  }>;
};
