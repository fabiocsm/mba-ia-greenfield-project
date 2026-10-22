import { Type } from 'class-transformer';
import { IsInt, IsString, Min } from 'class-validator';

export class OpenUploadDto {
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sizeBytes: number;

  @IsString()
  contentType: string;
}
