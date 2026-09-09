import fs from "node:fs/promises";
import path from "node:path";
import { CarinaError } from "../errors.js";
import type {
  AssetSidecar,
  AttachInput,
  EdgeRecord,
  NodeRecord,
  ToolResult,
} from "../schema/index.js";
import { EdgeType, NodeType } from "../schema/index.js";
import { t } from "../i18n/index.js";
import { resolvePosix } from "../pack/index.js";
import type { ToolContext } from "./context.js";
import { requireNode } from "./graph-read.js";
import { newRecordId, utcNow } from "./stamp.js";

/**
 * zh: 把包内文件拷进 assets/，写 sidecar，并挂到目标节点。
 * en: Copy a pack file into assets/, write a sidecar, and bind it to the target node.
 */
export async function runAttach(
  input: AttachInput,
  ctx: ToolContext,
): Promise<ToolResult> {
  const packDir = ctx.packHandle.packDir;
  const sourceAbs = resolvePosix(packDir, input.posixPath);
  requireNode(ctx.store, input.nodeId);
  const destPosix = destinationPosix(input.posixPath);
  const destAbs = resolvePosix(packDir, destPosix);
  await ensureSourceExists(sourceAbs);
  await fs.mkdir(path.dirname(destAbs), { recursive: true });
  if (sourceAbs !== destAbs) {
    await fs.copyFile(sourceAbs, destAbs);
  }
  const createdAt = utcNow();
  const kind = input.kind ?? "file";
  const sidecar: AssetSidecar = {
    nodeId: input.nodeId,
    kind,
    posixPath: destPosix,
    createdAt,
  };
  const sidecarAbs = `${destAbs}.json`;
  await fs.writeFile(
    sidecarAbs,
    `${JSON.stringify(sidecar, null, 2)}\n`,
    "utf8",
  );
  const assetNode: NodeRecord = {
    id: newRecordId(),
    type: NodeType.Asset,
    props: {
      posixPath: destPosix,
      kind,
      boundNodeId: input.nodeId,
    },
    createdAt,
  };
  const edge: EdgeRecord = {
    id: newRecordId(),
    type: EdgeType.DepictedAs,
    fromId: input.nodeId,
    toId: assetNode.id,
    props: {},
    createdAt,
  };
  await ctx.store.mutate({ addNodes: [assetNode], addEdges: [edge] });
  const chronicleEvent = await ctx.store.appendEvent({
    kind: "attach",
    payload: {
      nodeId: input.nodeId,
      assetId: assetNode.id,
      posixPath: destPosix,
      kind,
    },
    relatedNodeIds: [input.nodeId, assetNode.id],
  });
  return {
    ok: true,
    summary: t("tool.attach.ok", ctx.lang),
    data: {
      asset: assetNode,
      posixPath: destPosix,
      eventId: chronicleEvent.id,
    },
  };
}

/**
 * zh: 不在 assets/ 下的文件拷到 assets/文件名；已在其中则保持原 POSIX 路径。
 * en: Copy files outside assets/ to assets/<basename>; keep the POSIX path when already there.
 */
function destinationPosix(sourcePosix: string): string {
  if (sourcePosix === "assets" || sourcePosix.startsWith("assets/")) {
    return sourcePosix;
  }
  const segments = sourcePosix
    .split("/")
    .filter((segment) => segment.length > 0);
  const baseName = segments[segments.length - 1];
  if (baseName === undefined) {
    throw new CarinaError("SANDBOX", "error.sandbox");
  }
  return `assets/${baseName}`;
}

/**
 * zh: 源文件必须存在于包内。
 * en: The source file must exist inside the pack.
 */
async function ensureSourceExists(absolutePath: string): Promise<void> {
  try {
    await fs.access(absolutePath);
  } catch (cause) {
    throw new CarinaError("NOT_FOUND", "error.notFound", cause);
  }
}
