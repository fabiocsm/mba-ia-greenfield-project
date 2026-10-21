import { ApiProperty } from '@nestjs/swagger';
import { VideoDraftResponseDto } from './video-draft-response.dto';

export class VideoFileResponseDto {
  @ApiProperty()
  associated: boolean;

  @ApiProperty({ nullable: true, type: Number })
  sizeBytes: number | null;

  @ApiProperty()
  uploadInProgress: boolean;
}

export class VideoDetailResponseDto extends VideoDraftResponseDto {
  @ApiProperty({ type: VideoFileResponseDto })
  file: VideoFileResponseDto;

  @ApiProperty({ nullable: true, type: Number })
  durationSeconds: number | null;

  @ApiProperty({ nullable: true, type: Object })
  technicalMetadata: Record<string, unknown> | null;

  @ApiProperty()
  thumbnailStored: boolean;
}
