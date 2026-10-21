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
});
