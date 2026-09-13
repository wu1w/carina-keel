# 世界模型 spike：WorldGen 空间壳（Windows RTX 5070 Ti）

日期：2026-09-12 → 2026-09-13。预算：3 个开发日；实际约 1 个工作夜。
结论：**通过（有明确边界）**。自然语言 → 房间尺度网格 + 来源记录 → 几何验证 → 进 SceneSpec 世界包 → 冻结/重开/导出，全链路在真实 sidecar 上跑通，证据见 `ng1-space-shell.json`。

## 这是什么，不是什么

- 是：一个**单视点球面壳**。FLUX.1-dev（nunchaku SVDQuant fp4）+ WorldGen text2scene LoRA 生成 1600×800 等距全景，DA-2（SphereViT）估 360° 深度，按球面网格连成带贴图的 GLB。sidecar 自报 `provider: "worldgen-flux-pano-da2"`、`claimsWorldModelGeneration: true`、`coverage: "single-viewpoint"`。
- 不是：多视角重建、可绕行的完整场景、度量级尺度。DA-2 输出是尺度不变的（归一化到 max 20），尺度全靠先验；从视点走开后会看到拉伸与背面空洞。
- 与物件路径的关系：吧台、壁炉仍由 AIGA TripoSR（`http-native-mesh`）出物件网格，`claimsWorldModelGeneration: false` 不变；壳只是"整空间"候选，不替代物件。
- 诚实闸门：`claimsWorldModelGeneration` 只在 AssetPlan 里能找到白名单 provider、且已入包（`assetHash`）的壳时为 true；工厂 GLB 校验器拒绝带世界模型戳的 GLB，壳不能伪装成物件。

## 数字（`ng1-space-shell.json`，seed 42）

| 项 | 值 |
| --- | --- |
| 全景生成（28 步，1600×800，fp4） | ≈ 44 s |
| DA-2 深度 | ≈ 0.2–0.7 s |
| 成网 + GLB | ≈ 0.4–0.7 s |
| sidecar 端到端 | ≈ 45 s |
| Carina `session.create`（含吧台/壁炉 TripoSR + 壳） | ≈ 54 s |
| 壳 GLB | 320 400 顶点 / 638 400 三角 / 16.2 MB（2.1 MB 贴图） |
| 显存 | 5070 Ti 16 GB，常驻约 10.9 GB（DA-2 + fp4 transformer + T5 int4） |
| 模型冷加载 | 首次下载约 13.5 min；命中缓存后 19 s |

## 尺度：先验不稳，SceneSpec 兜底

同一英文提示、三个 seed 的 sidecar 先验房宽：3.5 m / 9.8 m / 10.4 m（`camera-height-prior`，脚下地面 = 1.6 m）。sidecar 现在同时记录 nadir/zenith 与推算层高，层高不在 2.2–6 m 时退回层高先验（3.0 m）；置信度一律 `low`。
Carina 侧不信这个先验：`fitSpaceShellTransform` 把壳 AABB **三轴 min 等比**缩进 SceneSpec 室内盒并居中，只改 transform（GLB 字节与来源戳不变），记录为 `worldModel.regionFit = { regionId, method: "scenespec-aabb", uniformScale }`（限幅 0.25–4）。
首次 cook 仍用旧 footprints 2.18×，UE 层高 7.4 m。2026-09-13 live PATCH（`ng1-space-shell-refit.json`）改为 aabb 1.18×，高 4 m，同一 hash `2cbef055…`，不是新 WorldGen。拟合 overlay ≠ 修好的度量。

## 提示语言

中文直接喂 FLUX+LoRA 得到默认的夜景航拍城市（见 `~/.carina/evidence/worldgen/smoke/panorama.jpg`）。`composeSpaceShellPrompt` 是确定性 zh→en 词表（酒馆/湖边/雨夜/壁炉/吧台/旧木…），不是 LLM 翻译；词表没命中时只给"室内第一人称"取景与原文 ASCII 词。原文保留在 `worldModel.sceneDescription`。

## 环境事实（Windows，`ssh carina-win`）

- `C:\Users\wuyw\build\worldgen\.venv` Python 3.11，torch 2.10.0+cu128，nunchaku 1.3.0.dev20260213（win cp311），diffusers，open3d，trimesh，DA-2，WorldGen（`--no-deps -e`）。
- xformers 0.0.35 无 sm_120 内核 → sidecar 启动时让 `import xformers` 失败，DA-2 DINOv2 回退纯 torch 注意力（`WORLDGEN_XFORMERS=1` 可关）。pytorch3d 无 cp311 轮子 → 最小替身（只有 splat 路径用）。
- DA-2 SphereViT 把 `.to("cuda")` 的字串存成 `model.device`，WorldGen 读 `.device.type` 崩 → 传 `torch.device`。
- 服务：`schtasks` 任务 `CarinaWorldgenServer`（`windows-start.cmd`，127.0.0.1:18796），日志 `server.log`。重启要先 `taskkill` 再等几秒再 `/run`，否则日志文件仍被占用、任务立即退出（上次结果 1）。
- Mac 隧道：`ssh -N -f -L 127.0.0.1:18796:127.0.0.1:18796 carina-win`；`scripts/start-mac-control-plane.sh` 探测到 `ready: true` 才导出 `CARINA_SPACE_PROVIDER_URL`。
- 许可：FLUX.1-dev 非商用；WorldGen Apache-2.0；DA-2 见其仓库。二进制证据（GLB / 全景 / distance.npy）在 `~/.carina/evidence/worldgen/<jobId>/`，不入库。

## 下一步（不在本 spike 内）

1. 已提交壳已 cook/spawn 进 `ng1-i23d`（`ng1-space-shell-cook.json`）。仍是单视点 overlay，不是可行走多视点房间。地面环带碰撞与多视点补洞仍未做。Unlit→Opaque 重 cook 走 `forcePrepare`、同一 hash `2cbef055…`（`ng1-space-shell-reparent-cook.json`），不是新 WorldGen，不是 P1。
2. 多视点补洞（WorldGen 自带 inpaint 路径需 pytorch3d/splat，本环境不可用）或换整场景模型时，`coverage` 改 `multi-view`，白名单再加一项。
3. 用 Carina 校准（`scene-spec-calibrate`）替代 footprint 先验，让层高也可信。
