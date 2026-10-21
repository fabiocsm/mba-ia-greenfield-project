import { IsOptional, IsString, IsUUID } from 'class-validator';

export class CreateVideoDto {
  @IsOptional()
  @IsString()
  title?: string | null;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsUUID()
  channelId?: string;
}
