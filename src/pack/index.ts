/**
 * zh: 世界包目录与 zip。外部只从本文件进入。
 * en: World pack directories and zip. External code enters only here.
 */

/**
 * zh: 按语言创建世界包目录、模板、graph.json 与空编年。
 * en: Create a world pack directory, templates, graph.json, and an empty chronicle.
 */
export { createPack } from "./create.js";

/**
 * zh: 打开世界包并校验 graph.json。已打开的世界包：可变 graph/session，save 原子写回。
 * en: Open a world pack and validate graph.json. Opened pack: mutable graph/session, save writes atomically.
 */
export { openPack, type PackHandle } from "./open.js";

/**
 * zh: 用 fflate 把世界包打成 zip，条目路径为 POSIX。
 * en: Zip a world pack with fflate using POSIX entry paths.
 */
export { exportZip } from "./zip.js";

/**
 * zh: 把包内 POSIX 路径接到宿主文件系统，越界则抛 SANDBOX。
 * en: Join a pack-relative POSIX path onto the host FS; throw SANDBOX on escape.
 */
export { resolvePosix } from "./paths.js";

/**
 * zh: 列出 skills 下各目录中 SKILL.md 的包内 POSIX 路径。
 * en: List pack-relative POSIX paths of SKILL.md files one level under skills.
 */
export { listSkills } from "./skills.js";

/**
 * zh: 读取包内 Markdown（如 WORLD.md），路径经沙箱解析。
 * en: Read pack Markdown (e.g. WORLD.md) after sandbox path resolution.
 */
export { readMarkdown } from "./markdown.js";
