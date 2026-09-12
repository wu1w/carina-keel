import type { RenderResult, RenderView } from "../schema/index.js";
import type { Renderer } from "./renderer.js";

/**
 * zh: 纯文本渲染器。不访问网络，不写图谱；像素不是真相。
 * en: Plain-text renderer. No network, no graph writes; pixels are not source of truth.
 */
export class MockRenderer implements Renderer {
  /**
   * zh: 用 placeId 与 entities 拼一段描述。
   * en: Build a description from placeId and entities.
   */
  render(view: RenderView): RenderResult {
    return { media: describeView(view) };
  }
}

/**
 * zh: 把视图格式化为双语纯文本。像素不是真相。
 * en: Format the view as bilingual plain text. Pixels are not source of truth.
 */
export function describeView(view: RenderView): string {
  const named =
    view.placeName !== undefined && view.placeName.length > 0
      ? `${view.placeName} (${view.placeId})`
      : view.placeId;
  const lines: string[] = [
    `zh: 地点 ${named}。画面不是图谱真相。`,
    `en: Place ${named}. Pixels are not the source of truth.`,
  ];

  if (view.entities.length === 0) {
    lines.push("zh: 视野内没有实体。 en: No entities in view.");
  } else {
    lines.push("zh: 视野内实体： en: Entities in view:");
    for (const entity of view.entities) {
      lines.push(`- ${describeEntity(entity)}`);
    }
  }

  if (view.camera !== undefined) {
    lines.push(`zh: 镜头 ${view.camera}。 en: Camera ${view.camera}.`);
  }
  if (view.style !== undefined) {
    lines.push(`zh: 风格 ${view.style}。 en: Style ${view.style}.`);
  }
  if (view.intent !== undefined) {
    lines.push(`zh: 玩家意图 ${view.intent}。 en: Player intent ${view.intent}.`);
  }
  if (view.fresh === true) {
    lines.push("zh: 重做种子图。 en: Bake a new seed.");
  }

  return lines.join("\n");
}

/**
 * zh: 实体一行：id，有名字则附上。
 * en: One entity line: id, plus name when present.
 */
function describeEntity(entity: RenderView["entities"][number]): string {
  if (entity.name !== undefined && entity.name.length > 0) {
    return `${entity.id} (${entity.name})`;
  }
  return entity.id;
}
