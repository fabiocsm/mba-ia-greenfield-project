export const SIGNED_URL_TTL_SECONDS = 900;

export interface StoredPart {
  partNumber: number;
  size: number;
  eTag: string;
}

export abstract class VideoStorage {
  abstract createMultipart(key: string, contentType: string): Promise<string>;

  abstract listParts(key: string, uploadId: string): Promise<StoredPart[]>;

  abstract listUploadedPartNumbers(
    key: string,
    uploadId: string,
  ): Promise<number[]>;

  abstract signPart(
    key: string,
    uploadId: string,
    partNumber: number,
  ): Promise<string>;

  abstract signGet(key: string, attachment: boolean): Promise<string>;

  abstract completeMultipart(
    key: string,
    uploadId: string,
    parts: StoredPart[],
  ): Promise<void>;

  abstract abortMultipart(key: string, uploadId: string): Promise<void>;

  abstract downloadToFile(key: string, filePath: string): Promise<void>;

  abstract putFile(
    key: string,
    filePath: string,
    contentType: string,
  ): Promise<void>;
}
