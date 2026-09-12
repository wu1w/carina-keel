import { createUlid } from "../world/ids.js";
import type { IntentKind, WorldCommand } from "../schema/index.js";
import { resolveFurniturePlanObjectId } from "../scene-compiler/index.js";
import { classifyShot, isViewUtterance } from "../steward/world-model-brief.js";

export type FastInterpretInput = {
  text: string;
  worldId?: string;
  origin: WorldCommand["origin"];
  requestedBy: string;
  /**
   * zh: 当前 SceneSpec 物件 id。用来把「吧台」「桌子」编成计划 id。
   * en: Current SceneSpec object ids. Used to compile 吧台 / 桌子 to plan ids.
   */
  planObjectIds?: readonly string[];
  /**
   * zh: 已有可走网格时，「走到吧台」编成导航，不编成镜头。
   * en: When a walkable mesh exists, 走到吧台 compiles to navigate, not a camera shot.
   */
  canNavigate?: boolean;
};

/**
 * zh: 无歧义控制句的确定性识别。不调用 LLM。
 * en: Deterministic recognition for unambiguous control phrases. No LLM.
 */
export function interpretFast(
  input: FastInterpretInput,
): WorldCommand[] | undefined {
  const text = input.text.trim();
  if (text.length === 0) {
    return undefined;
  }
  const pause = matchPauseWorld(text);
  if (pause !== undefined) {
    return [command(input, pause, "author", {})];
  }
  const generationStop = matchStopGeneration(text);
  if (generationStop) {
    return [command(input, "generation.stop", "author", {})];
  }
  const stopMove = matchStopMove(text);
  if (stopMove) {
    return [command(input, "player.stopNavigation", "player", {})];
  }
  const step = matchStep(text);
  if (step !== undefined) {
    return [command(input, "world.step", "author", { seconds: step })];
  }
  const run = matchRun(text);
  if (run) {
    return [command(input, "world.run", "author", {})];
  }
  const created = matchCreateWorld(text);
  if (created !== undefined) {
    return [
      command(input, "session.create", "author", { name: created }, true),
    ];
  }
  const freeze = matchFreeze(text);
  if (freeze) {
    return [command(input, "spatial.freeze", "author", {})];
  }
  const switched = matchSwitchWorld(text);
  if (switched !== undefined) {
    return [
      command(input, "session.switch", "author", { name: switched }, true),
    ];
  }
  const calibrate = matchCalibrate(text, input.planObjectIds);
  if (calibrate !== undefined) {
    return [
      command(input, "spatial.calibrate", "author", {
        objectId: calibrate.objectId,
        delta: calibrate.delta,
      }),
    ];
  }
  const material = matchMaterial(text, input.planObjectIds);
  if (material !== undefined) {
    return [
      command(input, "spatial.calibrate", "author", {
        objectId: material.objectId,
        catalogId: material.catalogId,
      }),
    ];
  }
  const extend = matchExtend(text);
  if (extend !== undefined) {
    const commands = [command(input, "generation.extend", "author", {})];
    if (extend.openDoor) {
      commands.push(
        command(input, "player.act", "player", {
          action: "open",
          name: "门",
        }),
      );
    }
    return commands;
  }
  const pickup = matchPickup(text);
  if (pickup !== undefined) {
    return [
      command(input, "player.act", "player", {
        action: pickup.action,
        ...(pickup.name !== undefined ? { name: pickup.name } : {}),
      }),
    ];
  }
  const restore = matchRestore(text);
  if (restore) {
    return [command(input, "world.restore", "author", {})];
  }
  const exported = matchExport(text);
  if (exported) {
    return [command(input, "export.create", "author", {})];
  }
  const navigate = matchNavigate(text);
  if (navigate !== undefined && input.canNavigate === true) {
    return [
      command(input, "player.navigate", "player", {
        name: navigate.name,
      }),
    ];
  }
  const look = matchLook(text);
  if (look !== undefined) {
    const shotKind = classifyShot(text);
    return [
      command(input, "generation.start", "author", {
        observeOnly: true,
        prompt: input.text,
        fresh: shotKind === "scene",
        shotKind,
      }),
    ];
  }
  if (isViewUtterance(text)) {
    const shotKind = classifyShot(text);
    return [
      command(input, "generation.start", "author", {
        observeOnly: true,
        prompt: input.text,
        fresh: shotKind === "scene",
        shotKind,
      }),
    ];
  }
  const rulePatch = matchRulePatch(text);
  if (rulePatch !== undefined) {
    return [
      command(input, "rules.update", "author", {
        scope: rulePatch.scope,
        documentId: rulePatch.documentId,
        append: rulePatch.append,
      }),
    ];
  }
  return undefined;
}

/**
 * zh: 组装一条命令。
 * en: Build one command.
 */
function command(
  input: FastInterpretInput,
  intentKind: IntentKind,
  mode: WorldCommand["mode"],
  args: Record<string, unknown>,
  omitWorldId = false,
): WorldCommand {
  const base: WorldCommand = {
    commandId: createUlid(),
    intentKind,
    arguments: args,
    origin: input.origin,
    mode,
    requestedBy: input.requestedBy,
    text: input.text,
  };
  if (!omitWorldId && input.worldId !== undefined) {
    return { ...base, worldId: input.worldId };
  }
  return base;
}

function matchPauseWorld(text: string): IntentKind | undefined {
  const normalized = text.replace(/[。！!]/g, "").trim();
  if (
    /^(暂停世界|暂停时间|把世界停下来)$/.test(normalized) ||
    /^(pause(\s+the)?\s+world|pause)$/i.test(normalized)
  ) {
    return "world.pause";
  }
  return undefined;
}

function matchStopGeneration(text: string): boolean {
  return /^(暂停生成|停止生成|stop\s+generation)$/i.test(
    text.replace(/[。！!]/g, "").trim(),
  );
}

function matchStopMove(text: string): boolean {
  return /^(停下移动|停下|别走了|stop\s+moving)$/i.test(
    text.replace(/[。！!]/g, "").trim(),
  );
}

function matchStep(text: string): number | undefined {
  const normalized = text.replace(/[。！!]/g, "").trim();
  if (/^(前进一步|step)$/i.test(normalized)) {
    return 1 / 20;
  }
  const seconds = normalized.match(/^运行\s*(\d+)\s*秒(?:再暂停)?$/);
  if (seconds !== null && seconds[1] !== undefined) {
    return Number.parseInt(seconds[1], 10);
  }
  return undefined;
}

function matchRun(text: string): boolean {
  const normalized = text.replace(/[。！!]/g, "").trim();
  return /^(继续运行|继续|恢复运行|resume|run)$/i.test(normalized);
}

function matchFreeze(text: string): boolean {
  const normalized = text.replace(/[。！!]/g, "").trim();
  return /^(固化|落盘|固化这间屋子|把这间屋子固化|固化落盘|freeze(\s+the)?(\s+room)?)$/i.test(
    normalized,
  );
}

const CN_METERS: Record<string, number> = {
  半: 0.5,
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

const FURNITURE_LABEL =
  "吧台正面|吧台|桌子|椅子\\d+|椅子|杯子|门|bar-front|bar\\s+counter|bar|table|chair|cup|door";

/**
 * zh: 酒馆校准句。无 LLM。左 = −X，单位米。桌/椅/杯/门/吧台均可。
 * en: Tavern calibrate phrase. No LLM. Left = −X, meters. Table/chair/cup/door/bar.
 */
function matchCalibrate(
  text: string,
  planObjectIds: readonly string[] | undefined,
): { objectId: string; delta: { x: number; y: number; z: number } } | undefined {
  const normalized = text.replace(/[。！!？?]/g, "").trim();
  const zh = normalized.match(
    new RegExp(
      `把?(${FURNITURE_LABEL})\\s*(?:往|向|朝)?\\s*(左|右|前|后|上|下)\\s*(?:边|面|侧)?\\s*(?:移(?:动)?|挪(?:动)?)\\s*(半|[0-9]+(?:\\.[0-9]+)?|[一二两三四五六七八九十])\\s*(?:米|m|meters?|metres?)?`,
      "i",
    ),
  );
  if (zh !== null && zh[1] !== undefined && zh[2] !== undefined && zh[3] !== undefined) {
    const meters = parseMeters(zh[3]);
    const delta = directionDelta(zh[2], meters);
    if (delta !== undefined) {
      return {
        objectId: resolveFurniturePlanObjectId(zh[1], planObjectIds),
        delta,
      };
    }
  }
  const en = normalized.match(
    new RegExp(
      `(?:move|shift)\\s+(?:the\\s+)?(${FURNITURE_LABEL})\\s+(?:to\\s+the\\s+)?(left|right|up|down|forward|back)\\s+(?:by\\s+)?([0-9]+(?:\\.[0-9]+)?)\\s*(?:m|meters?|metres?)?`,
      "i",
    ),
  );
  if (en !== null && en[1] !== undefined && en[2] !== undefined && en[3] !== undefined) {
    const meters = parseMeters(en[3]);
    const delta = directionDelta(en[2], meters);
    if (delta !== undefined) {
      return {
        objectId: resolveFurniturePlanObjectId(en[1], planObjectIds),
        delta,
      };
    }
  }
  return undefined;
}

/**
 * zh: 单物件换目录材质。目录 PBR 不是世界模型材质。
 * en: Swap one object's catalog material. Catalog PBR is not a world-model material.
 */
function matchMaterial(
  text: string,
  planObjectIds: readonly string[] | undefined,
): { objectId: string; catalogId: string } | undefined {
  const normalized = text.replace(/[。！!？?]/g, "").trim();
  if (/^(木头旧一些|木头再旧一点|木头旧一点)$/.test(normalized)) {
    return {
      objectId: resolveFurniturePlanObjectId("桌子", planObjectIds),
      catalogId: "oak-table-dark",
    };
  }
  const zh = normalized.match(
    new RegExp(
      `(?:把|给)?(${FURNITURE_LABEL})(?:的)?(?:材质)?\\s*换成\\s*(深色木头|深色木纹|深色橡木|橡木|陶瓷)`,
    ),
  );
  if (zh !== null && zh[1] !== undefined && zh[2] !== undefined) {
    const objectId = resolveFurniturePlanObjectId(zh[1], planObjectIds);
    const catalogId = catalogIdFor(objectId, zh[2]);
    if (catalogId !== undefined) {
      return { objectId, catalogId };
    }
  }
  const en = normalized.match(
    /(?:change|swap)\s+(?:the\s+)?(table|chair|cup|door|bar(?:-front)?|bar\s+counter)\s+(?:material\s+)?to\s+(dark\s+oak|oak|ceramic)/i,
  );
  if (en !== null && en[1] !== undefined && en[2] !== undefined) {
    const objectId = resolveFurniturePlanObjectId(en[1], planObjectIds);
    const catalogId = catalogIdFor(objectId, en[2]);
    if (catalogId !== undefined) {
      return { objectId, catalogId };
    }
  }
  return undefined;
}

function catalogIdFor(objectId: string, finish: string): string | undefined {
  const finishKey = finish.trim().toLowerCase();
  const dark = /深色|dark/.test(finishKey);
  if (objectId === "table") {
    return dark ? "oak-table-dark" : "oak-table";
  }
  if (objectId === "chair") {
    return dark ? "oak-chair-dark" : "oak-chair";
  }
  if (objectId === "cup") {
    return "ceramic-cup";
  }
  if (objectId === "door") {
    return dark ? undefined : "oak-door";
  }
  return undefined;
}

function matchSwitchWorld(text: string): string | undefined {
  const normalized = text.replace(/[。！!？?]/g, "").trim();
  const match = normalized.match(
    /^(?:切换到|切到|switch\s+to(?:\s+the)?)\s*(.+)$/i,
  );
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  const name = match[1].trim();
  return name.length > 0 ? name : undefined;
}

function parseMeters(raw: string): number | undefined {
  const named = CN_METERS[raw];
  if (named !== undefined) {
    return named;
  }
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function directionDelta(
  direction: string,
  meters: number | undefined,
): { x: number; y: number; z: number } | undefined {
  if (meters === undefined) {
    return undefined;
  }
  const key = direction.toLowerCase();
  if (key === "左" || key === "left") {
    return { x: -meters, y: 0, z: 0 };
  }
  if (key === "右" || key === "right") {
    return { x: meters, y: 0, z: 0 };
  }
  if (key === "上" || key === "up") {
    return { x: 0, y: meters, z: 0 };
  }
  if (key === "下" || key === "down") {
    return { x: 0, y: -meters, z: 0 };
  }
  if (key === "前" || key === "forward") {
    return { x: 0, y: 0, z: meters };
  }
  if (key === "后" || key === "back") {
    return { x: 0, y: 0, z: -meters };
  }
  return undefined;
}

function matchExtend(
  text: string,
): { openDoor: boolean } | undefined {
  const normalized = text.replace(/[。！!]/g, "").trim();
  if (/^(走进花园|开门走进去)$/.test(normalized)) {
    return { openDoor: true };
  }
  if (
    /^(在门外生成花园|门外生成花园|扩展花园|把花园接上|门外增加露台|增加露台|extend(\s+the)?\s+garden|add\s+(a\s+)?(garden|terrace))$/i.test(
      normalized,
    )
  ) {
    return { openDoor: false };
  }
  return undefined;
}

function matchPickup(
  text: string,
): { action: "pickup" | "drop"; name?: string } | undefined {
  const normalized = text.replace(/[。！!]/g, "").trim();
  if (
    /^(拿起杯子|捡起杯子|拿起那只杯子|pickup(\s+the)?\s+cup)$/i.test(
      normalized,
    )
  ) {
    return { action: "pickup", name: "杯子" };
  }
  if (/^(放下杯子|放下|drop(\s+the)?\s+cup|drop)$/i.test(normalized)) {
    return { action: "drop" };
  }
  return undefined;
}

function matchCreateWorld(text: string): string | undefined {
  const match = text.match(
    /^(?:新建一个|新开一个|创建一个)(.+?)(?:世界)?[。!！]?$/,
  );
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  const name = match[1].trim();
  return name.length > 0 ? name : undefined;
}

function matchRestore(text: string): boolean {
  const normalized = text.replace(/[。！!]/g, "").trim();
  return /^(恢复检查点|恢复上一个检查点|退回刚才|撤销|撤销上一笔|undo|restore(\s+the)?\s+checkpoint)$/i.test(
    normalized,
  );
}

function matchExport(text: string): boolean {
  const normalized = text.replace(/[。！!]/g, "").trim();
  return /^(导出这间屋子|导出建模资源|把这间屋子导出|导出\s*glb|export(\s+this)?(\s+room)?)$/i.test(
    normalized,
  );
}

function matchNavigate(text: string): { name: string } | undefined {
  const normalized = text.replace(/[。！!？?]/g, "").trim();
  if (/^(走进花园|开门走进去)$/.test(normalized)) {
    return undefined;
  }
  const match = normalized.match(
    /^(?:慢慢)?(?:走到|走进|walk\s+to|go\s+to)\s*(吧台正面|吧台|门口|门边|那扇门|门|窗边|窗外|窗|桌子|the\s+bar|the\s+door|the\s+window|the\s+table)$/i,
  );
  if (match === null || match[1] === undefined) {
    return undefined;
  }
  return { name: navigateNameOf(match[1]) };
}

function navigateNameOf(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (key === "the bar" || key.includes("吧台")) {
    return "吧台";
  }
  if (key === "the door" || key.includes("门")) {
    return "门";
  }
  if (key === "the window" || key.includes("窗")) {
    return "窗";
  }
  if (key === "the table" || key.includes("桌")) {
    return "桌子";
  }
  return raw.trim();
}

function matchLook(text: string): { fresh: boolean } | undefined {
  const normalized = text.replace(/[。！!？?]/g, "").trim();
  if (
    /^(看一眼|看一看|看一下|看看|look(\s+around)?)$/i.test(normalized)
  ) {
    return { fresh: true };
  }
  if (/^(看一眼|看一看|看一下|看看)\s*.+/.test(normalized)) {
    return { fresh: true };
  }
  if (/^look(\s+at)?\s+.+/i.test(normalized)) {
    return { fresh: true };
  }
  if (
    /^(生成|做一间|做个|来一间|来一个|出一张|帮我看)/.test(
      normalized,
    )
  ) {
    return { fresh: true };
  }
  return undefined;
}

function matchRulePatch(
  text: string,
): { scope: "global" | "world"; documentId: string; append: string } | undefined {
  const global = text.match(
    /^(?:全局记住|全局规则[:：]|全局[:：])\s*(.+)$/,
  );
  if (global !== null && global[1] !== undefined) {
    return {
      scope: "global",
      documentId: "IDENTITY.md",
      append: global[1].trim(),
    };
  }
  const world = text.match(
    /^(?:打开世界规则[，, ]*写上|世界规则[:：]|以后这个世界)\s*(.+)$/,
  );
  if (world !== null && world[1] !== undefined) {
    return {
      scope: "world",
      documentId: "WORLD.md",
      append: world[1].trim(),
    };
  }
  return undefined;
}
