# Falcor status (CARINA-RTX-20260910)

Times: Asia/Shanghai (UTC+8).

## Summary

| Step | Status |
|------|--------|
| Clone + submodules | DONE (`eb540f6`) |
| packman `setup.bat` | DONE (no 403) |
| cmake `windows-ninja-msvc` | DONE (D3D12 ON, CUDA OFF) |
| `Mogwai.exe` Release | DONE |
| Headless frame capture | **DONE** — `artifacts/falcor_smoke/falcor_cornell_pt.ToneMapper.dst.24.png` |
| Service `mode=falcor_pt` wiring | Pending (offline smoke proven) |

## Verified frame

- Binary: `third_party\Falcor\build\windows-ninja-msvc\bin\Release\Mogwai.exe`
- Script: MinimalPathTracer-style graph (VBufferRT → MinimalPathTracer → Accumulate → ToneMapper)
- Scene: Falcor media `test_scenes/cornell_box.pyscene` (**render-validation sample**, not world-model content)
- Flags: `--headless --device-type d3d12`
- Result PNG shows classic Cornell box with path-trace noise + color bleeding + shadows from ceiling light
- Explicitly **not Lumen**

## Capability

- `falcorPathTrace=true` after verified PNG
- `dlssNeuralRendering=false` (packman DLSS 3.5.0 ≠ NR)
- `lumenSW`/`lumenHW`=false

## Logs

- `logs/falcor_cmake.log`
- `logs/mogwai_frame.log` (note: post-capture `m.shutdown()` AttributeError is harmless; capture already succeeded)
