#!/usr/bin/env python3
"""Repeatable Carina -> Windows validation; completion is not visual acceptance.

CARINA_TOKEN must be set. Submit once, then collect by ID on a later invocation.
No polling loop, secret output, or direct Windows credentials are needed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import time
import urllib.error
import urllib.request
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['upload', 'submit', 'collect'])
    parser.add_argument('--file', type=Path, help='Self-contained GLB to upload through the authenticated Carina API.')
    parser.add_argument('--asset-id', help='Uploaded content-addressed asset ID (preferred).')
    parser.add_argument('--job')
    parser.add_argument('--mode', default='baseline', choices=['baseline', 'hq_pbr', 'lumen_sw', 'lumen_hw', 'lumen_dlss_nr'])
    parser.add_argument('--scene-glb', help='Service-relative assets/...glb path, for hq_pbr only.')
    parser.add_argument('--camera-path', type=Path, help='Local JSON array of eye/target/up camera poses.')
    parser.add_argument('--resolution', default='720p', choices=['720p', '1080p'])
    parser.add_argument('--frames', type=int, default=60)
    parser.add_argument('--port', type=int, default=18790)
    parser.add_argument('--output', type=Path, default=Path('/tmp/carina-graphics-validation'))
    args = parser.parse_args()
    token = os.environ.get('CARINA_TOKEN')
    if not token:
        parser.error('Set CARINA_TOKEN in the environment.')
    if not 1 <= args.frames <= 120 or not 1 <= args.port <= 65535:
        parser.error('Invalid frame count or port.')
    if args.action == 'collect' and not re.fullmatch(r'[a-f0-9]{12}', args.job or ''):
        parser.error('collect requires --job with a 12-character hexadecimal ID.')
    if args.asset_id and not re.fullmatch(r'[a-f0-9]{16}', args.asset_id):
        parser.error('Invalid --asset-id.')
    if args.action == 'upload' and not args.file:
        parser.error('upload requires --file.')
    if args.action == 'submit' and args.mode == 'hq_pbr' and bool(args.scene_glb) == bool(args.asset_id):
        parser.error('hq_pbr requires exactly one of --asset-id or legacy --scene-glb.')
    opener = urllib.request.build_opener(NoRedirect)
    samples = []

    def request(path, body=None, content_type='application/json', timeout=15):
        req = urllib.request.Request(
            f'http://127.0.0.1:{args.port}/v1/graphics{path}',
            data=body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None,
            headers={'Authorization': f'Bearer {token}', 'Content-Type': content_type},
        )
        started = time.perf_counter()
        with opener.open(req, timeout=timeout) as response:
            data = response.read(128 * 1024 * 1024 + 1)
            if len(data) > 128 * 1024 * 1024:
                raise ValueError('Artifact exceeds 128 MiB.')
        samples.append({'path': path, 'bytes': len(data), 'total_ms': round((time.perf_counter() - started) * 1000, 3)})
        return data

    if args.action == 'upload':
        if args.file.stat().st_size > 80 * 1024 * 1024:
            raise ValueError('GLB exceeds 80 MiB.')
        data = args.file.read_bytes()
        digest = hashlib.sha256(data).hexdigest()
        boundary = 'carina-' + uuid.uuid4().hex
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="asset.glb"\r\n'
                'Content-Type: model/gltf-binary\r\n\r\n').encode() + data + f'\r\n--{boundary}--\r\n'.encode()
        result = json.loads(request('/assets/glb', body, f'multipart/form-data; boundary={boundary}', 150))
        asset = result.get('asset', {})
        if asset.get('contentHash') != digest or asset.get('assetId') != digest[:16] or asset.get('byteLength') != len(data):
            raise ValueError('Upload identity mismatch.')
        fetched = json.loads(request('/assets/' + asset['assetId']))
        if fetched.get('asset', {}).get('contentHash') != digest:
            raise ValueError('Stored asset identity mismatch.')
        folder = args.output / 'assets' / asset['assetId']
        folder.mkdir(parents=True, exist_ok=True)
        report = folder / 'upload.json'
        report.write_text(json.dumps({'result': result, 'lookup': fetched, 'network_samples': samples}, indent=2))
        print(json.dumps({'assetId': asset['assetId'], 'deduped': asset.get('deduped'), 'report': str(report)}))
        return 0

    if args.action == 'submit':
        health = json.loads(request('/health'))
        if health.get('state') != 'connected' or not health['health']['ready']:
            print(json.dumps({'health': health, 'submitted': False}))
            return 1
        body = {'mode': args.mode, 'resolution': [1280, 720] if args.resolution == '720p' else [1920, 1080], 'frames': args.frames}
        if args.scene_glb:
            body['scene_glb'] = args.scene_glb
        if args.asset_id:
            body['assetId'] = args.asset_id
        if args.camera_path:
            body['camera_path'] = json.loads(args.camera_path.read_text())
        result = json.loads(request('/jobs', body))
        job = result.get('job', {})
        if not re.fullmatch(r'[a-f0-9]{12}', job.get('id', '')):
            raise ValueError('Invalid job response.')
        folder = args.output / job['id']
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'submission.json').write_text(json.dumps({'health': health, 'result': result, 'network_samples': samples}, indent=2))
        print(json.dumps({'job': job['id'], 'state': job['state'], 'report': str(folder / 'submission.json')}))
        return 0

    result = json.loads(request('/jobs/' + args.job))
    job = result.get('job', {})
    if job.get('state') != 'completed':
        print(json.dumps(result))
        return 2
    folder = args.output / args.job
    folder.mkdir(parents=True, exist_ok=True)
    artifacts = []
    for name in job['artifacts']:
        if not re.fullmatch(r'[A-Za-z0-9_-]+\.(png|jpg|jpeg|json)', name):
            continue  # Still frames and metrics only; avoid large video/strip downloads.
        if name == 'frame_strip.png':
            continue
        target = folder / name
        if target.exists():
            data = target.read_bytes()
        else:
            data = request(f'/artifacts/{args.job}/{name}')
            target.write_bytes(data)
        artifacts.append({'file': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
    report = {'job': job, 'visual_acceptance': 'pending_manual_inspection',
              'timing_scope': 'Individual HTTP samples including transfer; not displayed-frame or input latency.',
              'network_samples': samples, 'artifacts': artifacts}
    (folder / 'collection.json').write_text(json.dumps(report, indent=2))
    print(json.dumps({'job': args.job, 'artifacts': len(artifacts), 'visual_acceptance': report['visual_acceptance'], 'report': str(folder / 'collection.json')}))
    return 0


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except urllib.error.HTTPError as exc:
        raise SystemExit(f'HTTP {exc.code}; request was not retried.') from None
    except (OSError, ValueError) as exc:
        raise SystemExit(f'Validation failed ({type(exc).__name__}); request was not retried.') from None
