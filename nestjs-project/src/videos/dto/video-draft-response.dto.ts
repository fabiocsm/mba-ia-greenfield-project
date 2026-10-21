import { ApiProperty } from '@nestjs/swagger';
import type { VideoStatus } from '../entities/video.entity';

export class VideoDraftResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  channelId: string;

  @ApiProperty({ enum: ['draft', 'processing', 'ready', 'error'] })
  status: VideoStatus;

  @ApiProperty()
  url: string;

  @ApiProperty({ nullable: true, type: String })
  title: string | null;

  @ApiProperty({ nullable: true, type: String })
  description: string | null;
}
