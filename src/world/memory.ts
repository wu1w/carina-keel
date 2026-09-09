import { writeFile } from "node:fs/promises";
import { CarinaError } from "../errors.js";
import { readMarkdown, resolvePosix, type PackHandle } from "../pack/index.js";
import { NodeType, type ClaimNode } from "../schema/index.js";

/**
 * zh: remember 选项。默认同时写 MEMORY.md 与 Claim 节点。
 * en: remember options. Defaults to writing both MEMORY.md and a Claim node.
 */
export type RememberOptions = {
  relatedNodeIds?: readonly string[] | undefined;
  writeMemory?: boolean | undefined;
  createClaim?: boolean | undefined;
};

/**
 * zh: remember 结果。
 * en: remember result.
 */
export type RememberResult = {
  claimNode: ClaimNode | undefined;
};

/**
 * zh: 构造 Claim 节点。
 * en: Build a Claim node.
 */
export function createClaimNode(
  id: string,
  fact: string,
  relatedNodeIds: readonly string[],
  createdAt: string,
): ClaimNode {
  return {
    id,
    type: NodeType.Claim,
    props: { fact, relatedNodeIds: [...relatedNodeIds] },
    createdAt,
  };
}

/**
 * zh: 向 MEMORY.md 追加一条精炼事实。文件不存在则创建。
 * en: Append one curated fact to MEMORY.md. Creates the file if missing.
 */
export async function appendMemoryFact(
  packHandle: PackHandle,
  fact: string,
  occurredAt: string,
): Promise<void> {
  const memoryPath = resolvePosix(packHandle.packDir, "MEMORY.md");
  const oneLine = fact.replace(/\r\n/g, "\n").replace(/\n/g, " ").trim();
  const line = `- ${occurredAt} ${oneLine}\n`;
  let existing = "";
  try {
    existing = await readMarkdown(packHandle, "MEMORY.md");
  } catch (error) {
    if (!(error instanceof CarinaError) || error.code !== "NOT_FOUND") {
      throw error;
    }
  }
  if (existing.length > 0 && !existing.endsWith("\n")) {
    existing += "\n";
  }
  await writeFile(memoryPath, `${existing}${line}`, "utf8");
}
