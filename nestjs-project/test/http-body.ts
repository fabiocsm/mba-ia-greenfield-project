export interface HttpJson {
  id: string;
  email: string;
  sub: string;
  error: string;
  access_token: string;
  refresh_token: string;
  channelId: string;
  status: string;
  url: string;
  title: string | null;
  description: string | null;
  videoId: string;
  partSizeBytes: number;
  sizeBytes: number;
  parts: { partNumber: number; url: string }[];
  file: {
    associated: boolean;
    sizeBytes: number | null;
    uploadInProgress: boolean;
  };
  durationSeconds: number | null;
  technicalMetadata: object | null;
  thumbnailStored: boolean;
  expiresInSeconds: number;
  fileUrl: string;
}

export function httpBody<T = HttpJson>(res: object): T {
  return (res as unknown as { body: T }).body;
}

export function confirmationMailer(service: object): {
  sendConfirmationEmail: (
    email: string,
    name: string,
    token: string,
  ) => Promise<void>;
  sendPasswordResetEmail: (
    email: string,
    name: string,
    token: string,
  ) => Promise<void>;
} {
  return (
    service as unknown as {
      mailService: {
        sendConfirmationEmail: (
          email: string,
          name: string,
          token: string,
        ) => Promise<void>;
        sendPasswordResetEmail: (
          email: string,
          name: string,
          token: string,
        ) => Promise<void>;
      };
    }
  ).mailService;
}
