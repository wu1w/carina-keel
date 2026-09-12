# CARINA-RTX-20260910 validation (Windows RTX 5070 Ti)

Local-only graphics validation service. **Bind: `127.0.0.1:18793`**. No public endpoints. Does not touch llama/LLM services.

## Layout

- `service/` — FastAPI app + ModernGL mesh renderer
- `scene/` — procedural textured interior + camera path
- `artifacts/` — per-job outputs (`benchmark.json`, PNGs)
- `logs/` — job JSON + service logs
- `queue/` — reserved
- `bin/` — reserved
- `.api_key` — **API key on disk only; never paste into chat/reports**

## Setup (once)

```bat
C:\Users\wuyw\AppData\Roaming\uv\python\cpython-3.11.15-windows-x86_64-none\python.exe scripts\setup_env.py
```

## Start / stop

```bat
venv\Scripts\python.exe scripts\start_service.py
venv\Scripts\python.exe scripts\stop_service.py
```

Or: `start.cmd` / `stop.cmd`

## Health

```bat
venv\Scripts\python.exe scripts\curl_health.py
```

Auth: `Authorization: Bearer <key>` or `X-Api-Key: <key>` where key is read from `.api_key`.

## Jobs

- `POST /jobs` body examples:
  - `{"mode":"baseline","resolution":[1280,720],"frames":60}`
  - `{"mode":"baseline","resolution":[1920,1080],"frames":60}`
  - `{"mode":"lumen_sw"}` → `blocked` (UE missing)
  - `{"mode":"lumen_hw"}` → `blocked`
  - `{"mode":"lumen_dlss_nr"}` → `blocked`

## Capabilities

Honest flags in `/health` and `capabilities.json`. `meshRender` flips true only after a successful NVIDIA GPU frame render. Lumen / DLSS NR remain false until UE + Streamline SDK exist (see `BLOCKERS.md`).
