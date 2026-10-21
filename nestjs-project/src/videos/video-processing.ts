import { execFile } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import { randomUUID } from 'node:crypto';
import { EntityManager } from 'typeorm';
import { Video } from './entities/video.entity';
import { VideoStorage } from './video-storage';

const execFileAsync = promisify(execFile);

function updatedRows(result: unknown): unknown[] {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0];
  }
  return [];
}

export interface ProbeResult {
  durationSeconds: number;
  technicalMetadata: { format: unknown; streams: unknown };
}

export async function claimDraft(
  manager: EntityManager,
  videoId: string,
): Promise<string | null> {
  const claim = randomUUID();
  const rows = updatedRows(
    await manager.query(
      `UPDATE "videos"
       SET "status" = 'processing', "processing_claim" = $1, "updated_at" = now()
       WHERE "id" = $2 AND "status" = 'draft'
       RETURNING "id"`,
      [claim, videoId],
    ),
  );
  return rows.length > 0 ? claim : null;
}

export async function markReady(
  manager: EntityManager,
  videoId: string,
  claim: string,
  outcome: {
    durationSeconds: number;
    technicalMetadata: ProbeResult['technicalMetadata'];
    thumbnailStorageKey: string;
  },
): Promise<boolean> {
  const rows = updatedRows(
    await manager.query(
      `UPDATE "videos"
       SET "status" = 'ready',
           "duration_seconds" = $3,
           "technical_metadata" = $4::jsonb,
           "thumbnail_storage_key" = $5,
           "updated_at" = now()
       WHERE "id" = $1 AND "processing_claim" = $2 AND "status" = 'processing'
       RETURNING "id"`,
      [
        videoId,
        claim,
        outcome.durationSeconds,
        JSON.stringify(outcome.technicalMetadata),
        outcome.thumbnailStorageKey,
      ],
    ),
  );
  return rows.length > 0;
}

export async function markError(
  manager: EntityManager,
  videoId: string,
  claim: string,
): Promise<boolean> {
  const rows = updatedRows(
    await manager.query(
      `UPDATE "videos"
       SET "status" = 'error', "updated_at" = now()
       WHERE "id" = $1 AND "processing_claim" = $2 AND "status" = 'processing'
       RETURNING "id"`,
      [videoId, claim],
    ),
  );
  return rows.length > 0;
}

export async function probeMedia(inputPath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    inputPath,
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: unknown;
  };
  const durationSeconds = Number(parsed.format?.duration);
  if (!Number.isFinite(durationSeconds) || durationSeconds < 0) {
    throw new Error('ffprobe did not return a duration');
  }
  return {
    durationSeconds,
    technicalMetadata: {
      format: parsed.format ?? null,
      streams: parsed.streams ?? [],
    },
  };
}

export async function extractThumbnail(
  inputPath: string,
  thumbPath: string,
): Promise<void> {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i',
    inputPath,
    '-frames:v',
    '1',
    thumbPath,
  ]);
}

export async function processVideo(
  manager: EntityManager,
  storage: VideoStorage,
  videoId: string,
): Promise<void> {
  const claim = await claimDraft(manager, videoId);
  if (!claim) {
    return;
  }

  const directory = await mkdtemp(join(tmpdir(), 'streamtube-'));
  try {
    const video = await manager.findOne(Video, { where: { id: videoId } });
    if (!video?.original_storage_key) {
      throw new Error('Original object is missing');
    }
    const inputPath = join(directory, 'original');
    const thumbPath = join(directory, 'thumb.jpg');
    await storage.downloadToFile(video.original_storage_key, inputPath);
    const probed = await probeMedia(inputPath);
    await extractThumbnail(inputPath, thumbPath);
    const thumbnailStorageKey = `thumbnails/${videoId}`;
    await storage.putFile(thumbnailStorageKey, thumbPath, 'image/jpeg');
    await markReady(manager, videoId, claim, {
      durationSeconds: probed.durationSeconds,
      technicalMetadata: probed.technicalMetadata,
      thumbnailStorageKey,
    });
  } catch {
    await markError(manager, videoId, claim);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
