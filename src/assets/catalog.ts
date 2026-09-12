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
    catalogId: "oak-table-dark",
    objectIds: [],
    names: [],
    roles: [],
    shape: "table",
    defaultDimensions: { x: 1.2, y: 0.75, z: 1.2 },
    metallic: 0.04,
    roughness: 0.82,
    albedo: [0x3d, 0x24, 0x12],
    albedoAlt: [0x1a, 0x10, 0x08],
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
    catalogId: "oak-chair-dark",
    objectIds: [],
    names: [],
    roles: [],
    shape: "chair",
    defaultDimensions: { x: 0.5, y: 0.9, z: 0.5 },
    metallic: 0.03,
    roughness: 0.8,
    albedo: [0x2a, 0x18, 0x0c],
    albedoAlt: [0x12, 0x0a, 0x06],
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

/**
 * zh: 按 catalogId 取目录条目。深色变体不参与自动命中。
 * en: Look up a catalog entry by id. Dark variants are not auto-hits.
 */
export function resolveCatalogById(catalogId: string): CatalogEntry | undefined {
  return INTERIOR_CATALOG.find((entry) => entry.catalogId === catalogId);
}

/**
 * zh: 目录变体只能绑到同形状的 reuse 物件，不能换掉 generate 特色件或墙。
 * en: A catalog variant may bind only to a same-shape reuse object, never a generate feature or wall.
 */
export function catalogFitsObject(
  entry: CatalogEntry,
  object: { sceneObjectId: string; name: string },
  plan?: SceneSpecObject,
): boolean {
  if (plan !== undefined && plan.route !== "reuse") {
    return false;
  }
  if (plan !== undefined && entry.objectIds.includes(plan.objectId)) {
    return true;
  }
  const shape = shapeOfObject(object, plan);
  return shape !== undefined && entry.shape === shape;
}

function shapeOfObject(
  object: { sceneObjectId: string; name: string },
  plan?: SceneSpecObject,
): CatalogShape | undefined {
  if (plan !== undefined) {
    if (plan.objectId === "table" || plan.name === "桌子") {
      return "table";
    }
    if (plan.objectId === "chair" || plan.name === "椅子") {
      return "chair";
    }
    if (plan.objectId === "cup" || plan.name === "杯子") {
      return "cup";
    }
    if (plan.objectId === "door" || plan.role === "door" || plan.name === "门") {
      return "door";
    }
  }
  const id = object.sceneObjectId.toLowerCase();
  const name = object.name.trim();
  if (id === "table" || id.endsWith("-table") || name === "桌子") {
    return "table";
  }
  if (
    id === "chair" ||
    id.endsWith("-chair") ||
    /-chair-\d+$/.test(id) ||
    name === "椅子" ||
    /^椅子\d+$/.test(name)
  ) {
    return "chair";
  }
  if (id === "cup" || id.endsWith("-cup") || name === "杯子") {
    return "cup";
  }
  if (id === "door" || id.endsWith("-door") || name === "门") {
    return "door";
  }
  return undefined;
}
