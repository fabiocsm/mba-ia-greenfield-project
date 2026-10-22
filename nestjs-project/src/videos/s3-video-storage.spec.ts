import storageConfig from '../config/storage.config';
import { S3VideoStorage } from './s3-video-storage';

describe('S3VideoStorage signing configuration', () => {
  it('signs upload and GET URLs for the public endpoint while storage uses Docker DNS', async () => {
    const storage = new S3VideoStorage({
      ...storageConfig(),
      endpoint: 'minio',
      publicEndpoint: 'https://media.example.com',
    });

    const part = new URL(
      await storage.signPart('originals/video', 'upload', 1),
    );
    const playback = new URL(await storage.signGet('originals/video', false));
    const download = new URL(await storage.signGet('originals/video', true));

    for (const url of [part, playback, download]) {
      expect(url.origin).toBe('https://media.example.com');
      expect(url.searchParams.get('X-Amz-Signature')).toMatch(/^[a-f0-9]{64}$/);
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
    }
    expect(part.searchParams.get('partNumber')).toBe('1');
    expect(download.searchParams.get('response-content-disposition')).toBe(
      'attachment',
    );
    expect(playback.searchParams.has('response-content-disposition')).toBe(
      false,
    );
  });
});
