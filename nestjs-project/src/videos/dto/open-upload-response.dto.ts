import { ApiProperty } from '@nestjs/swagger';

export class UploadPartResponseDto {
  @ApiProperty()
  partNumber: number;

  @ApiProperty()
  url: string;
}

export class OpenUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  videoId: string;

  @ApiProperty()
  partSizeBytes: number;

  @ApiProperty()
  sizeBytes: number;

  @ApiProperty({ type: [UploadPartResponseDto] })
  parts: UploadPartResponseDto[];
}
