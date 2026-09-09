/**
 * zh: 边类型字面量。`in` 在 TS 里用 EdgeType.In 引用。
 * en: Edge type literals. Refer to `in` as EdgeType.In in TypeScript.
 */
export const EdgeType = {
  In: "in",
  Contains: "contains",
  Knows: "knows",
  Owns: "owns",
  Caused: "caused",
  DepictedAs: "depicted_as",
  DerivedFrom: "derived_from",
} as const;

/**
 * zh: 边类型联合。
 * en: Union of edge types.
 */
export type EdgeType = (typeof EdgeType)[keyof typeof EdgeType];
