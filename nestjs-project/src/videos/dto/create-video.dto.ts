import { IsOptional, IsString, IsUUID, ValidateIf } from 'class-validator';

export class CreateVideoDto {
  @IsOptional()
  @IsString()
  title?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsUUID()
  channelId?: string;
}
