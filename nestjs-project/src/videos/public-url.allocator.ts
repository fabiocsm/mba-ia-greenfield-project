import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';

@Injectable()
export class PublicUrlAllocator {
  allocate(): string {
    return randomBytes(9).toString('base64url');
  }
}
