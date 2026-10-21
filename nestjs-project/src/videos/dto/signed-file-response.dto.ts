import { ApiProperty } from '@nestjs/swagger';

export class SignedFileResponseDto {
  @ApiProperty()
  fileUrl: string;

  @ApiProperty({ example: 900 })
  expiresInSeconds: number;
}
