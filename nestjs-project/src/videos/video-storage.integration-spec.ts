import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import storageConfig from '../config/storage.config';
import { S3VideoStorage } from './s3-video-storage';

describe('S3VideoStorage (integration)', () => {
  const storage = new S3VideoStorage(storageConfig());
  const key = `originals/storage-spec-${Date.now()}`;
  let uploadId: string | undefined;

  afterEach(async () => {
    if (!uploadId) {
      return;
    }
    const id = uploadId;
    uploadId = undefined;
    await storage.abortMultipart(key, id);
  });

  it('opens a multipart upload, lists an uploaded part, and aborts it', async () => {
    uploadId = await storage.createMultipart(key, 'video/mp4');

    expect(await storage.listUploadedPartNumbers(key, uploadId)).toEqual([]);

    const url = await storage.signPart(key, uploadId, 1);
    const uploaded = await fetch(url, {
      method: 'PUT',
      body: new TextEncoder().encode('part-one'),
    });
    expect(uploaded.ok).toBe(true);

    expect(await storage.listUploadedPartNumbers(key, uploadId)).toEqual([1]);

    const id = uploadId;
    uploadId = undefined;
    await storage.abortMultipart(key, id);

    await expect(storage.listUploadedPartNumbers(key, id)).rejects.toThrow();
  });

  it('serves a playback range and the full download of the original', async () => {
    const objectKey = `originals/range-spec-${Date.now()}`;
    const body = Buffer.alloc(3072);
    for (let index = 0; index < body.length; index++) {
      body[index] = index % 251;
    }
    const directory = await mkdtemp(join(tmpdir(), 'streamtube-range-'));
    const filePath = join(directory, 'original.bin');
    await writeFile(filePath, body);
    await storage.putFile(objectKey, filePath, 'video/mp4');
    await rm(directory, { recursive: true, force: true });

    const playbackUrl = await storage.signGet(objectKey, false);
    for (const start of [0, 1024, 2048]) {
      const response = await fetch(playbackUrl, {
        headers: { Range: `bytes=${start}-${start + 1023}` },
      });
      expect(response.status).toBe(206);
      const received = Buffer.from(await response.arrayBuffer());
      expect(received.equals(body.subarray(start, start + 1024))).toBe(true);
    }

    const downloadUrl = await storage.signGet(objectKey, true);
    const download = await fetch(downloadUrl);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-disposition')).toContain('attachment');
    const downloaded = Buffer.from(await download.arrayBuffer());
    expect(downloaded.equals(body)).toBe(true);
  });
});
