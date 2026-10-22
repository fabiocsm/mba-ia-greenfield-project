import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  endpoint: process.env.STORAGE_ENDPOINT!,
  port: parseInt(process.env.STORAGE_PORT || '9000', 10),
  publicEndpoint: process.env.STORAGE_PUBLIC_ENDPOINT,
  region: process.env.STORAGE_REGION || 'us-east-1',
  bucket: process.env.STORAGE_BUCKET!,
  accessKey: process.env.STORAGE_ACCESS_KEY!,
  secretKey: process.env.STORAGE_SECRET_KEY!,
}));
