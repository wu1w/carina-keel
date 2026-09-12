import type { SceneSpecObject } from "../schema/index.js";

export const CATALOG_GENERATOR = "carina-catalog-v1";
export const CATALOG_SOURCE_LABEL = "carina-catalog";

export type CatalogShape = "door" | "table" | "chair" | "cup";

export type CatalogEntry = {
  catalogId: string;
  objectIds: readonly string[];
  names: readonly string[];
  roles: readonly string[];
  shape: CatalogShape;
  defaultDimensions: { x: number; y: number; z: number };
  metallic: number;
  roughness: number;
  albedo: readonly [number, number, number];
  albedoAlt: readonly [number, number, number];
};

/**
 * zh: 酒馆变化用的小资产目录。目录命中不是世界模型生成。
 * en: Small catalog for tavern variations. A catalog hit is not world-model generation.
 */
export const INTERIOR_CATALOG: readonly CatalogEntry[] = [
  {
    catalogId: "oak-door",
    objectIds: ["door"],
    names: ["门"],
    roles: ["door"],
    shape: "door",
    defaultDimensions: { x: 1.1, y: 2.2, z: 0.12 },
    metallic: 0.02,
    roughness: 0.78,
    albedo: [0x5c, 0x33, 0x17],
    albedoAlt: [0x8a, 0x55, 0x28],
  },
  {
    catalogId: "oak-table",
    objectIds: ["table"],
    names: ["桌子"],
    roles: [],
    shape: "table",
    defaultDimensions: { x: 1.2, y: 0.75, z: 1.2 },
    metallic: 0.04,
    roughness: 0.7,
    albedo: [0x6b, 0x3f, 0x1d],
    albedoAlt: [0x3d, 0x24, 0x12],
  },
  {
    catalogId: "oak-chair",
    objectIds: ["chair"],
    names: ["椅子"],
    roles: [],
    shape: "chair",
    defaultDimensions: { x: 0.5, y: 0.9, z: 0.5 },
    metallic: 0.03,
    roughness: 0.68,
    albedo: [0x4a, 0x2c, 0x14],
    albedoAlt: [0x7a, 0x4a, 0x22],
  },
  {
    catalogId: "ceramic-cup",
    objectIds: ["cup"],
    names: ["杯子"],
    roles: ["prop"],
    shape: "cup",
    defaultDimensions: { x: 0.08, y: 0.12, z: 0.08 },
    metallic: 0.0,
    roughness: 0.35,
    albedo: [0xe8, 0xdc, 0xcc],
    albedoAlt: [0xc4, 0xb4, 0xa0],
  },
];

/**
 * zh: 按 objectId / 名称 / 安全 role 解析目录。generate 与 scaffold 不命中。
 * en: Resolve a catalog entry by objectId, name, or a safe role. generate and scaffold never hit.
 */
export function resolveCatalogHit(
  object: SceneSpecObject,
): CatalogEntry | undefined {
  if (object.route !== "reuse") {
    return undefined;
  }
  const byId = INTERIOR_CATALOG.find((entry) =>
    entry.objectIds.includes(object.objectId),
  );
  if (byId !== undefined) {
    return byId;
  }
  const byName = INTERIOR_CATALOG.find((entry) =>
    entry.names.includes(object.name),
  );
  if (byName !== undefined) {
    return byName;
  }
  if (object.role === "door") {
    return INTERIOR_CATALOG.find((entry) => entry.roles.includes("door"));
  }
  if (object.role === "prop") {
    return INTERIOR_CATALOG.find((entry) => entry.roles.includes("prop"));
  }
  return undefined;
}
