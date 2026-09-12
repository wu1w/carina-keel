"""Read-only GPU capability probe; the matmul is NOT a DLSS or Lumen benchmark."""
import json
import os
import subprocess
import time

def command(args):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=30)
        return {"exit_code": p.returncode, "stdout": p.stdout, "stderr": p.stderr}
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"error": str(e)}

report = {"purpose": "MI210 compute and graphics preflight; no DLSS inference", "vulkan": command(["vulkaninfo", "--summary"]), "devices": []}
try:
    import torch
    report.update(torch=torch.__version__, hip=torch.version.hip, visible_devices={k: os.environ.get(k) for k in ("HIP_VISIBLE_DEVICES", "ROCR_VISIBLE_DEVICES", "CUDA_VISIBLE_DEVICES")})
    for i in range(torch.cuda.device_count()):
        p = torch.cuda.get_device_properties(i)
        row = {"index": i, "name": p.name, "arch": getattr(p, "gcnArchName", ""), "memory_bytes": p.total_memory}
        report["devices"].append(row)
        if "gfx90a" not in row["arch"] and "MI210" not in p.name:
            continue
        with torch.cuda.device(i), torch.inference_mode():
            a = torch.ones((1024, 1024), device=f"cuda:{i}", dtype=torch.float16)
            b = torch.ones_like(a)
            for _ in range(3):
                out = a @ b
            torch.cuda.synchronize()
            start = time.perf_counter()
            for _ in range(10):
                out = a @ b
            torch.cuda.synchronize()
            row["fp16_matmul_ms"] = (time.perf_counter() - start) * 100
            row["correct"] = bool((out == 1024).all().item())
            del a, b, out
except Exception as e:
    report["compute_error"] = str(e)
print(json.dumps(report, indent=2, ensure_ascii=False))
