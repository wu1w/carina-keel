@echo off
REM en: Install the WorldGen scene-generation sidecar Python environment on Windows (RTX 5070 Ti).
setlocal
set ROOT=%~dp0
if "%CARINA_WORLDGEN_ROOT%"=="" set CARINA_WORLDGEN_ROOT=C:\Users\wuyw\build\worldgen
set PY=%CARINA_WORLDGEN_ROOT%\.venv\Scripts\python.exe
cd /d %CARINA_WORLDGEN_ROOT% || exit /b 1

if not exist .venv (
  uv venv .venv --python 3.11 || exit /b 1
)

echo [setup] torch 2.10 cu128 (sm_120 Blackwell)
uv pip install --python %PY% torch==2.10.0 torchvision --index-url https://download.pytorch.org/whl/cu128 || exit /b 1

echo [setup] nunchaku (SVDQuant FLUX, NVFP4 on Blackwell)
uv pip install --python %PY% "https://github.com/nunchux-ai/nunchaku/releases/download/v1.3.0dev20260213/nunchaku-1.3.0.dev20260213%%2Bcu12.8torch2.10-cp311-cp311-win_amd64.whl" || exit /b 1

echo [setup] diffusers stack + geometry
uv pip install --python %PY% diffusers transformers accelerate peft sentencepiece protobuf einops pillow scikit-image opencv-python py360convert open3d trimesh timm huggingface_hub safetensors numpy || exit /b 1

REM no --recursive: submodules (ml-sharp via ssh, viser) are splat/viewer only and not needed for the mesh path
if not exist WorldGen (
  git clone https://github.com/ZiYang-xie/WorldGen.git || exit /b 1
)
echo [setup] worldgen (no-deps: pyproject pins a linux-only nunchaku wheel)
uv pip install --python %PY% --no-deps -e WorldGen || exit /b 1

echo [setup] DA-2 360 depth (no-deps)
uv pip install --python %PY% --no-deps "git+https://github.com/EnVision-Research/DA-2.git#subdirectory=src" || exit /b 1

%PY% -c "import torch, nunchaku, diffusers, open3d, trimesh; print('torch', torch.__version__, 'cuda', torch.cuda.is_available(), torch.cuda.get_device_name(0)); print('nunchaku', nunchaku.__version__, 'diffusers', diffusers.__version__)"
echo [setup] DONE
