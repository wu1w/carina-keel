import type {
  LookInput,
  NodeRecord,
  RenderView,
  ToolResult,
} from "../schema/index.js";
import { NodeType } from "../schema/index.js";
import { t } from "../i18n/index.js";
import { DEFAULT_HOP_COUNT } from "../world/index.js";
import type { ToolContext } from "./context.js";
import { readNodeName, requirePlace, requirePresence } from "./graph-read.js";

/**
 * zh: 描述「这里」。只调渲染器，不把画面写回图谱当几何。
 * en: Describe "here". Calls the renderer only; does not write pixels back as graph geometry.
 */
export async function runLook(
  input: LookInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const placeId = requirePresence(ctx.packHandle);
  const place = requirePlace(ctx.store, placeId);
  const placeName = readNodeName(place);
  const neighborhood = ctx.store.hopNeighborhood(placeId, DEFAULT_HOP_COUNT);
  const entities = neighborhood.nodes
    .filter(
      (node) => node.type === NodeType.Entity || node.type === NodeType.Object,
    )
    .map((node) => toRenderEntity(node));
  const intent = ctx.userIntent;
  const view: RenderView = {
    placeId,
    entities,
    ...(placeName !== undefined ? { placeName } : {}),
    ...(input.style !== undefined ? { style: input.style } : {}),
    ...(intent !== undefined && intent.length > 0 ? { intent } : {}),
    ...(input.fresh === true ? { fresh: true } : {}),
  };
  // zh: 渲染结果不是地点的权威几何。 en: Render output is not authoritative place geometry.
  const result = await ctx.renderer.render(view);
  return {
    ok: true,
    summary: t("tool.look.ok", ctx.lang),
    data: {
      placeId,
      ...(placeName !== undefined ? { placeName } : {}),
      media: result.media,
      ...(result.warnings !== undefined ? { warnings: result.warnings } : {}),
      ...(result.still !== undefined ? { still: result.still } : {}),
      ...(result.clip !== undefined ? { clip: result.clip } : {}),
    },
  };
}

/**
 * zh: 把图节点收成渲染实体，不写 undefined 可选字段。
 * en: Shape a graph node as a render entity without assigning undefined optionals.
 */
function toRenderEntity(node: NodeRecord): RenderView["entities"][number] {
  const name = readNodeName(node);
  return {
    id: node.id,
    ...(name !== undefined ? { name } : {}),
    props: node.props,
  };
}
