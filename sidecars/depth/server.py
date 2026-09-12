#!/usr/bin/env python3
"""CPU depth reconstruction, separate from the world-model inference queue.
Depth is estimated, not surveyed geometry. Bind only to loopback.
"""
import base64
import hashlib
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from pathlib import Path

import numpy as np
import torch
from PIL import Image
from transformers import AutoImageProcessor, AutoModelForDepthEstimation

torch.set_num_threads(4)
MODEL = os.environ.get('CARINA_DEPTH_MODEL', '/data/disk1/models/depth-anything-v2-small')
processor = AutoImageProcessor.from_pretrained(MODEL, local_files_only=True)
model = AutoModelForDepthEstimation.from_pretrained(MODEL, local_files_only=True).eval()
LOCK = threading.Lock()
REQUEST_LOCK = threading.Lock()
STILLS = Path(os.environ.get('CARINA_STILL_DIR', '/data/disk1/models/lingbot-stills'))
CACHE = Path(os.environ.get('CARINA_DEPTH_CACHE', '/data/disk1/models/carina-depth-cache'))
CACHE.mkdir(parents=True, exist_ok=True)


def reconstruct(raw):
    key = hashlib.sha256(raw).hexdigest()
    file = CACHE / (key + '.json')
    if file.exists():
        return json.loads(file.read_text())
    source = Image.open(BytesIO(raw))
    mime = Image.MIME.get(source.format, 'image/jpeg')
    image = source.convert('RGB')
    width = 160
    height = min(240, max(2, round(width * image.height / image.width)))
    with LOCK, torch.inference_mode():
        prediction = model(**processor(images=image, return_tensors='pt')).predicted_depth
        inverse = torch.nn.functional.interpolate(prediction.unsqueeze(1), size=(height, width), mode='bilinear', align_corners=False)[0, 0].numpy()
    low, high = np.percentile(inverse, [2, 98])
    normalized = np.clip((inverse - low) / max(float(high - low), 1e-6), 0, 1)
    # Relative inverse depth has no metric scale. Keep a stable, explicit display scale.
    depth = 1 / (1 / 16 + normalized * (1 / 2 - 1 / 16))
    result = dict(schemaVersion=1, quality='estimated-single-view', imageHash=key,
                  image=dict(mime=mime, base64=base64.b64encode(raw).decode()),
                  width=width, height=height, aspect=image.width / image.height,
                  depth=np.round(depth, 4).reshape(-1).tolist())
    temp = file.with_suffix('.tmp')
    temp.write_text(json.dumps(result))
    temp.replace(file)
    return result


class Handler(BaseHTTPRequestHandler):
    def respond(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == '/health':
            self.respond(200, dict(ready=True, device='cpu'))
        elif self.path.startswith('/world/'):
            world = self.path.removeprefix('/world/')
            if not world.isalnum() or len(world) > 80:
                return self.respond(400, dict(error='invalid world'))
            file = STILLS / (world + '.jpg')
            if not file.exists():
                return self.respond(404, dict(error='no generated view'))
            with REQUEST_LOCK:
                self.respond(200, reconstruct(file.read_bytes()))
        else:
            self.respond(404, dict(error='not found'))

    def do_POST(self):
        if self.path != '/reconstruct':
            return self.respond(404, dict(error='not found'))
        try:
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= 12_000_000:
                return self.respond(413, dict(error='image too large'))
            body = json.loads(self.rfile.read(length))
            with REQUEST_LOCK:
                self.respond(200, reconstruct(base64.b64decode(body['base64'], validate=True)))
        except Exception as error:
            print(type(error).__name__, str(error), flush=True)
            self.respond(422, dict(error='reconstruction failed'))


ThreadingHTTPServer(('127.0.0.1', int(os.environ.get('CARINA_DEPTH_PORT', '18792'))), Handler).serve_forever()
