# world_runtime (portable mirror)

Windows source of truth: `C:\Users\wuyw\carina-rtx-validation\world_runtime`

HTTP WorldRuntime on **127.0.0.1:18794** (loopback). Contract: review-1 (Euler XYZ rad, opaque revision, commandId, assetId+hash).

- `shaderMergeOk=false` → **REQUIRED host cook** for new materials; fail keeps previous scene.
- Shader merge: MERGE hashes only — full ShaderArchive replace forbidden (D3D12 residency fatal).
- IPC ops (packaged host): activate, spawn, move, destroy, ping, **player_pose**, **highresshot**.

Content/artifacts/paks are Windows-only and are not mirrored here.
