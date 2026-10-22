#!/usr/bin/env python3
"""Opt-in real multipart/worker/Range smoke. Run on the host with Compose up.

Creates a confirmed test account through HTTP/Mailpit and retains its video for
inspection. Streams a valid tiny MP4 plus padding, bounded to four 5 MiB parts in
flight, without allocating a 10GB file in client memory. No database shortcuts.
Do not run database-cleaning Jest suites concurrently with this smoke.
"""

import argparse
import concurrent.futures
import hashlib
import json
from pathlib import Path
import re
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--api', default='http://localhost:3000')
    parser.add_argument('--mailpit', default='http://localhost:8025')
    parser.add_argument('--size', type=int, default=10_000_000_000)
    parser.add_argument('--report', default='/tmp/phase03-large-upload.json')
    args = parser.parse_args()
    fixture = (Path(__file__).resolve().parent.parent / 'test/fixtures/tiny.mp4').read_bytes()
    assert len(fixture) <= args.size <= 10_000_000_000
    token = None

    def api(path, body=None, method=None):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['Authorization'] = f'Bearer {token}'
        data = None if body is None else json.dumps(body).encode()
        req = urllib.request.Request(args.api + path, data, headers, method=method)
        with urllib.request.urlopen(req, timeout=15) as response:
            raw = response.read()
            return json.loads(raw) if raw else None

    email = f'video_smoke_{secrets.token_hex(6)}@example.com'
    password = secrets.token_urlsafe(24)
    api('/auth/register', {'email': email, 'password': password})
    with urllib.request.urlopen(args.mailpit + '/api/v1/messages') as response:
        messages = json.load(response)['messages']
    message = next(m for m in messages if any(a['Address'] == email for a in m['To']))
    with urllib.request.urlopen(args.mailpit + '/api/v1/message/' + message['ID']) as response:
        html = json.load(response)['HTML']
    confirmation = re.search(r'confirm-email\?token=([^"&<\s]+)', html).group(1)
    api('/auth/confirm-email?token=' + urllib.parse.quote(confirmation))
    token = api('/auth/login', {'email': email, 'password': password})['access_token']
    draft = api('/videos', {'title': 'Phase 03 acceptance smoke'})
    video_id = draft['id']
    assert draft['status'] == 'draft'
    assert api(draft['url'])['id'] == video_id
    assert api('/videos/' + video_id)['file']['associated'] is False
    endpoint = '/videos/' + video_id
    try:
        api(endpoint + '/upload', {'sizeBytes': 10_000_000_001, 'contentType': 'video/mp4'})
        raise AssertionError('Oversized upload accepted')
    except urllib.error.HTTPError as error:
        assert error.code == 422
        assert json.load(error)['error'] == 'VIDEO_FILE_TOO_LARGE'

    opened = api(endpoint + '/upload', {'sizeBytes': args.size, 'contentType': 'video/mp4'})
    part_size = opened['partSizeBytes']
    zero_part = bytes(part_size)
    assert len(opened['parts']) == (args.size + part_size - 1) // part_size
    stopped = threading.Event()
    latencies, health_errors = [], []

    def monitor():
        while not stopped.is_set():
            started = time.monotonic()
            try:
                with urllib.request.urlopen(args.api + '/', timeout=5) as response:
                    assert response.status == 200
                    response.read()
                latencies.append(time.monotonic() - started)
            except Exception as error:
                health_errors.append(str(error))
            stopped.wait(0.2)

    def upload(part):
        offset = (part['partNumber'] - 1) * part_size
        length = min(part_size, args.size - offset)
        body = zero_part[:length]
        if offset == 0:
            body = fixture + body[len(fixture):]
        req = urllib.request.Request(part['url'], body, method='PUT')
        with urllib.request.urlopen(req, timeout=120) as response:
            assert response.status == 200
            response.read()

    monitor_thread = threading.Thread(target=monitor)
    monitor_thread.start()
    start = time.monotonic()
    try:
        upload(opened['parts'][0])
        resumed = api(endpoint + '/upload', {'sizeBytes': args.size, 'contentType': 'video/mp4'})
        assert all(p['partNumber'] != 1 for p in resumed['parts'])
        assert len(resumed['parts']) == len(opened['parts']) - 1
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            for index, _ in enumerate(pool.map(upload, resumed['parts']), 2):
                if index % 200 == 0:
                    print(f'Uploaded {index}/{len(opened["parts"])} parts', flush=True)
        upload_seconds = time.monotonic() - start
        completed = api(endpoint + '/upload/complete', method='POST')
        assert completed['file']['associated'] is True
        states = [draft['status'], completed['status']]
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline:
            detail = api(endpoint)
            if detail['status'] != states[-1]:
                states.append(detail['status'])
            if detail['status'] in ('ready', 'error'):
                break
            time.sleep(0.2)
        assert detail['status'] == 'ready', detail
        assert detail['thumbnailStored'] is True
        assert detail['durationSeconds'] > 0
        assert detail['technicalMetadata']['streams']
        assert detail['file']['sizeBytes'] == args.size
        processing_seconds = time.monotonic() - start - upload_seconds
    finally:
        stopped.set()
        monitor_thread.join()

    playback = api(endpoint + '/playback')['fileUrl']
    ranges = []
    for offset in [0, args.size // 2, args.size - 1024]:
        req = urllib.request.Request(playback, headers={'Range': f'bytes={offset}-{offset + 1023}'})
        with urllib.request.urlopen(req, timeout=15) as response:
            assert response.status == 206
            assert response.headers['Content-Range'] == f'bytes {offset}-{offset + 1023}/{args.size}'
            body = response.read()
            assert len(body) == 1024
            expected = (fixture + bytes(1024))[:1024] if offset == 0 else bytes(1024)
            assert body == expected
        ranges.append({'start': offset, 'status': 206, 'bytes': len(body)})

    download_url = api(endpoint + '/download')['fileUrl']
    downloaded, actual_hash, expected_hash = 0, hashlib.sha256(), hashlib.sha256()
    with urllib.request.urlopen(download_url, timeout=120) as response:
        assert response.status == 200
        assert 'attachment' in response.headers['Content-Disposition']
        assert int(response.headers['Content-Length']) == args.size
        while chunk := response.read(part_size):
            actual_hash.update(chunk)
            downloaded += len(chunk)
    expected_hash.update(fixture)
    remaining = args.size - len(fixture)
    while remaining:
        chunk = zero_part[:min(remaining, part_size)]
        expected_hash.update(chunk)
        remaining -= len(chunk)
    assert downloaded == args.size
    assert actual_hash.digest() == expected_hash.digest()
    assert latencies and not health_errors, health_errors

    report = {
        'status': 'passed', 'sizeBytes': args.size, 'parts': len(opened['parts']),
        'videoId': video_id, 'url': draft['url'], 'states': states,
        'uploadSeconds': round(upload_seconds, 3),
        'processingSeconds': round(processing_seconds, 3),
        'apiHealthSamples': len(latencies), 'apiHealthFailures': len(health_errors),
        'apiMaxLatencyMs': round(max(latencies) * 1000, 3),
        'durationSeconds': detail['durationSeconds'], 'thumbnailStored': True,
        'rangeRequests': ranges, 'downloadedBytes': downloaded,
        'sha256': actual_hash.hexdigest(), 'sha256Matches': True,
    }
    Path(args.report).write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)


if __name__ == '__main__':
    main()
