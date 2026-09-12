import os
import shutil
import tarfile
from pathlib import Path

root = Path(r"C:\Users\wuyw\carina-rtx-validation")
tar_path = root / "p1_sync.tar"
with tarfile.open(tar_path, "r") as tf:
    tf.extractall(root / "p1_sync")

src_tavern = root / "p1_sync" / "assets" / "sourced-pbr-tavern"
dst_tavern = root / "sourced-pbr-tavern"
if dst_tavern.exists():
    shutil.rmtree(dst_tavern)
shutil.copytree(src_tavern, dst_tavern)

wr = root / "world_runtime"
for name in ["app.py", "pipeline_prepare.py", "merge_host_shaders.py", "p1_tavern_gate.py"]:
    src = root / "p1_sync" / "runtimes" / "unreal" / "world_runtime" / name
    shutil.copy2(src, wr / name)
    print("copied", name)

cpp_src = root / "p1_sync" / "runtimes" / "unreal" / "CarinaPS" / "Source" / "CarinaPS"
cpp_dst = Path(r"G:\carina-ue\CarinaPS\Source\CarinaPS")
for name in ["CarinaWorldRuntimeSubsystem.cpp", "CarinaWorldRuntimeSubsystem.h"]:
    shutil.copy2(cpp_src / name, cpp_dst / name)
    print("copied cpp", name)

print("tavern", dst_tavern, "ok", (dst_tavern / "build_tavern.py").is_file())
print("textures", list((dst_tavern / "textures").iterdir()))
