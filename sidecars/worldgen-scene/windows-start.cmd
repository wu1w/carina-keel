@echo off
REM en: Start the WorldGen scene sidecar on Windows. Loopback only; Mac reaches it via SSH -L.
setlocal
if "%CARINA_WORLDGEN_ROOT%"=="" set CARINA_WORLDGEN_ROOT=C:\Users\wuyw\build\worldgen
set PY=%CARINA_WORLDGEN_ROOT%\.venv\Scripts\python.exe
if "%HF_HOME%"=="" set HF_HOME=%CARINA_WORLDGEN_ROOT%\hf-home
if "%CARINA_WORLDGEN_OUT%"=="" set CARINA_WORLDGEN_OUT=%CARINA_WORLDGEN_ROOT%\jobs
if "%CARINA_WORLDGEN_HOST%"=="" set CARINA_WORLDGEN_HOST=127.0.0.1
if "%CARINA_WORLDGEN_PORT%"=="" set CARINA_WORLDGEN_PORT=18796
set CUDA_VISIBLE_DEVICES=0
set PYTHONUTF8=1
cd /d %CARINA_WORLDGEN_ROOT%
%PY% -u %CARINA_WORLDGEN_ROOT%\server.py
