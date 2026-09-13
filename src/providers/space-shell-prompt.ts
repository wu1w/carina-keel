import type { SceneSpec } from "../schema/index.js";

/**
 * zh: 把中文 SceneSpec 变成 FLUX/WorldGen 能懂的英文全景描述。全景 LoRA 只在英文提示上训练；
 *     直接喂中文会得到默认的航拍城市（2026-09-13 实测）。这里是确定性词表映射，不是 LLM 翻译，
 *     词表没命中时只保留通用室内取景与原文中的 ASCII 词。
 * en: Deterministic zh→en composer for the space-shell panorama prompt. WorldGen's text2scene
 *     LoRA is English-only; feeding Chinese yields the FLUX default aerial city (observed
 *     2026-09-13). No LLM here: lexicon hits plus any ASCII words from the original prompt.
 */
const VENUES: ReadonlyArray<readonly [RegExp, string]> = [
  [/酒馆|客栈|酒吧|旅店/, "old tavern"],
  [/图书馆|书房/, "library with tall bookshelves"],
  [/教堂|礼拜堂/, "stone chapel"],
  [/神殿|寺庙|庙/, "ancient temple hall"],
  [/城堡|大殿/, "castle great hall"],
  [/地牢|牢房/, "dungeon"],
  [/洞穴|山洞/, "cave"],
  [/舱|飞船|太空站|空间站/, "spaceship cabin"],
  [/铁匠|锻造/, "blacksmith forge"],
  [/工坊|作坊|车间/, "workshop"],
  [/厨房/, "kitchen"],
  [/卧室|寝室/, "bedroom"],
  [/客厅|起居室/, "living room"],
  [/办公室/, "office"],
  [/教室/, "classroom"],
  [/医院|病房/, "hospital ward"],
  [/车站|站台/, "train station hall"],
  [/市场|集市/, "market hall"],
  [/仓库/, "warehouse"],
];

const DETAILS: ReadonlyArray<readonly [RegExp, string]> = [
  [/湖边|湖畔|湖/, "lakeside, view of a lake through the windows"],
  [/海边|海岸|海/, "seaside"],
  [/河边|河/, "riverside"],
  [/森林|林/, "forest outside"],
  [/山/, "mountains outside"],
  [/沙漠/, "desert outside"],
  [/雪/, "snow outside"],
  [/雨夜/, "rainy night, rain on the windows"],
  [/雨/, "rain on the windows"],
  [/夜|晚/, "night"],
  [/黄昏|傍晚/, "dusk"],
  [/清晨|早晨/, "early morning light"],
  [/壁炉|火炉/, "warm glowing stone fireplace"],
  [/吧台/, "old wooden bar counter with space to walk behind it"],
  [/旧木|老木|木/, "worn old wood, wooden beams"],
  [/石/, "stone walls"],
  [/暖色|温暖/, "warm lighting"],
  [/烛光|蜡烛/, "candlelight"],
  [/灯笼|油灯/, "lantern light"],
  [/花园|庭院|院子/, "courtyard garden"],
  [/窗/, "windows"],
  [/桌/, "wooden tables"],
  [/椅/, "wooden chairs"],
  [/书架/, "bookshelves"],
  [/床/, "bed"],
];

const ASCII_WORD = /[A-Za-z][A-Za-z'-]{2,}/g;
const STOP_WORDS = /^(the|and|with|of|to|an|in|on|at|for|new|create|make|build)$/i;

export type SpaceShellPromptInput = {
  prompt: string;
  sceneSpec?: SceneSpec;
};

export type SpaceShellPrompt = {
  /** English panorama prompt sent to the sidecar. */
  visual: string;
  /** Original user-facing description, recorded alongside for provenance. */
  sceneDescription: string;
  /** Lexicon entries that fired; an empty list means the venue fell back to a generic room. */
  hits: string[];
};

export function composeSpaceShellPrompt(input: SpaceShellPromptInput): SpaceShellPrompt {
  const spec = input.sceneSpec;
  const text = [
    input.prompt,
    spec?.prompt ?? "",
    spec?.name ?? "",
    ...(spec?.regions.map((region) => region.name) ?? []),
    ...(spec?.objects.map((object) => object.name) ?? []),
  ].join(" ");
  const venue = VENUES.find(([pattern]) => pattern.test(text))?.[1];
  const details: string[] = [];
  for (const [pattern, phrase] of DETAILS) {
    if (pattern.test(text) && !details.includes(phrase)) {
      details.push(phrase);
    }
  }
  // "雨夜" already says night; avoid a duplicate token.
  const dedupedDetails =
    details.includes("rainy night, rain on the windows")
      ? details.filter((phrase) => phrase !== "rain on the windows" && phrase !== "night")
      : details;
  const ascii = Array.from(new Set(text.match(ASCII_WORD) ?? []))
    .filter((word) => !STOP_WORDS.test(word))
    .slice(0, 24);
  const hasInterior =
    spec === undefined || spec.regions.some((region) => region.kind === "interior");
  const framing =
    venue !== undefined
      ? `interior of a ${venue}, first-person eye-level view standing inside the room`
      : hasInterior
        ? "interior of a room, first-person eye-level view standing inside"
        : "outdoor courtyard, first-person eye-level view standing in the middle";
  const hits = [...(venue !== undefined ? [venue] : []), ...dedupedDetails];
  return {
    visual: [framing, ...dedupedDetails, ...ascii].join(", ").slice(0, 600),
    sceneDescription: input.prompt.trim(),
    hits,
  };
}
