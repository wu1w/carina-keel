# p0_glb_spawn_bp — SoftRef spawn BP + incremental IoStore + visual proof

Date: 2026-09-11 Asia/Shanghai. Windows evidence: `C:\Users\wuyw\carina-rtx-validation\logs\p0_glb_spawn_bp.json`.

## Result

| Item | Status |
|------|--------|
| BP SoftRef authoring | PARTIAL (SCS+metadata; no BeginPlay Soft Load graph — needs Editor GUI or C++) |
| Incremental cook + IoStore inject | WORKS (no full BuildCookRun) |
| Packaged LoadMap / soft path | WORKS (log) |
| Helmet visible in Pixel Streaming | **PROVEN** (`visual_proven: true`) |
| PS2 green / sidecar 18793 | PRESERVED |

## Visual proof (2026-09-11 14:17–14:19 CST)

Winning map: `/Game/Imported/DamagedHelmet/Lvl_HelmetVis` (Engine `Template_Default` non-WP + HardRef DamagedHelmet + Engine `BasicShapeMaterial` + Lit + BugItGo).

Primary PS screenshot:

- `C:\Users\wuyw\carina-rtx-validation\logs\p0_glb_spawn_bp_player_helmet_vis_lit.png` (mean~36, 1280x720, readyState=4)
- HighResShot: `...\logs\p0_highres_helmet_vis_lit.png`
- Wide: `...\logs\p0_glb_spawn_bp_player_helmet_vis_wide.png`

DamagedHelmet jagged/damaged-edge silhouette visible (not empty sky, not pure black). `Material_MR` still SM6-shader-missing; lit via Engine BasicShapeMaterial.

Streamer helper: `G:\carina-ue\CarinaPS\scripts\start_streamer_ps2_helmet.bat` → `Lvl_HelmetVis`.

## Assets

- `/Game/Imported/DamagedHelmet/BP_SpawnDamagedHelmet`
- `/Game/Imported/DamagedHelmet/Lvl_HelmetVis` ← **visual proof**
- `/Game/Imported/DamagedHelmet/Lvl_HelmetSpawn` (non-WP; packaged frames stayed black/empty)
- `/Game/Imported/DamagedHelmet/Lvl_HelmetFromTP` (WP; sky-only — OFPA ExternalActors never cook into Saved/Cooked)
- Soft path: `/Game/Imported/DamagedHelmet/DamagedHelmet/StaticMeshes/DamagedHelmet`

## Remaining / non-blockers for P0 visual

1. SoftRef BeginPlay LoadObject→Spawn still needs Editor GUI Blueprint wiring or C++ (SCS hard mesh already proves geometry path).
2. WP OFPA cook into side IoStore still blocked (0 pkgs via `-package`/`-Map`/`-Iterate`).
3. `Material_MR` shadermap not in side-container-only cook (Engine material workaround OK for silhouette proof).
