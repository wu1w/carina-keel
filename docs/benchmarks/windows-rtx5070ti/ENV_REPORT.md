# CARINA-RTX-20260910 — Environment report

Time: 2026-09-10 ~22:56 CST (Asia/Shanghai)

## Host

| Item | Value |
|------|-------|
| Hostname | `DESKTOP-RLADDRR` |
| User | `wuyw` (`C:\Users\wuyw`) |
| LAN IPv4 | `192.168.5.16` |
| Other IPv4 | `172.18.0.1` (likely WSL/Docker NAT) |
| MachineId (Grok Bot) | `de9fe733-e655-4835-bcb4-bdd079dbed99` |

## GPU / driver

| Item | Value |
|------|-------|
| GPU | NVIDIA GeForce RTX 5070 Ti |
| VRAM | 16303 MiB |
| Driver / KMD | 616.56 |
| CUDA UMD | 13.4 (from nvidia-smi banner) |
| Display | WDDM; idle ~0.8 GiB in use at probe |
| `nvcc` on PATH | **missing** (CUDA toolkit not installed / not on PATH) |

## DirectX

| Item | Present |
|------|---------|
| `System32\D3D12.dll` | yes |
| `System32\D3D12Core.dll` | yes |
| `System32\dxgi.dll` | yes |
| DXR runtime feature probe | **not yet executed** (no UE / no custom probe binary yet) |

## Disk

| Volume | Total | Used | Free |
|--------|-------|------|------|
| C: | ~821 GiB | ~693 GiB | **~128 GiB** |

## Toolchains

| Item | Status |
|------|--------|
| Python | 3.11.15 |
| VS 2022 Build Tools | **present** — `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools` (VC tools via vswhere) |
| Windows SDK Include | **10.0.26100.0** |
| Unreal / Epic Games | **not installed** (`C:\Program Files\Epic Games` absent; `UnrealEditor` not on PATH) |
| Streamline SDK | **not found** |
| DLSS / NGX SDK (dev) | **not found** — only game/NVIDIA App runtime bits (`NvDLISR`, Bannerlord `NGX_Logs`) |
| Port `18793` | **free** |
| Ports `1879x` | none listening |

## Proposed work directory

`C:\Users\wuyw\carina-rtx-validation` (did not exist at probe; to be created)

## Blockers vs work order (honest)

1. **Lumen SW/HW**: blocked until Unreal Engine (or equivalent Lumen-capable UE build) is installed. Installing UE requires Epic account / large download (~tens of GiB); not done without explicit go-ahead beyond this work order’s “report purchases/agreements”.
2. **DLSS 5 Neural Rendering**: blocked — Streamline + DLSS NR SDK/runtime for engine integration not present. Detecting RTX / NGX game DLLs is **not** NR validation.
3. **DLSS Super Resolution**: not validated yet; NGX runtime fragments exist but no Streamline integration / engine path.
4. **meshRender**: feasible via D3D12 + VS Build Tools / Python graphics stack without UE; will implement as baseline.

## Isolation

- Will not touch AIGA llama / `:8008` or other model services.
- Bind planned service to `127.0.0.1:18793` only (tunnel later); no firewall changes, no reboot.
