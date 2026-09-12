/**
 * zh: P2 资产工厂：小目录、校验与处理清单。目录和 HTTP 网格都不是世界模型。
 * en: P2 asset factory: small catalog, validation, and process log. Catalog and HTTP meshes are not world-model output.
 */
export {
  INTERIOR_CATALOG,
  CATALOG_GENERATOR,
  CATALOG_SOURCE_LABEL,
  catalogFitsObject,
  resolveCatalogById,
  resolveCatalogHit,
  type CatalogEntry,
  type CatalogShape,
} from "./catalog.js";
export {
  CHAIR_VERTEX_COUNT,
  CUP_VERTEX_COUNT,
  DOOR_VERTEX_COUNT,
  TABLE_VERTEX_COUNT,
  makeCatalogGlb,
  vertexCountOf,
} from "./catalog-glb.js";
export { validateFactoryGlb, type FactoryGlbReport } from "./validate-factory-glb.js";
export {
  extractGlbMaterialRefs,
  extractGlbMaterials,
  type BoundGlbMaterial,
} from "./bind-glb-materials.js";
export {
  applyCatalogReuse,
  applyCatalogToObject,
  type CatalogSceneAsset,
} from "./apply-catalog.js";
export {
  glbHashesForRoute,
  runAssetFactory,
} from "./run-asset-factory.js";
