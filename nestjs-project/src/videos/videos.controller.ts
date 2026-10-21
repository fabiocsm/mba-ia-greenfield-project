import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { OpenUploadDto } from './dto/open-upload.dto';
import { OpenUploadResponseDto } from './dto/open-upload-response.dto';
import { SignedFileResponseDto } from './dto/signed-file-response.dto';
import { VideoDetailResponseDto } from './dto/video-detail-response.dto';
import { VideoDraftResponseDto } from './dto/video-draft-response.dto';
import { VideosService } from './videos.service';

@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @ApiOperation({
    summary: 'Register a video draft',
    description:
      'Creates one draft for the authenticated owner channel before any file is stored.',
  })
  @ApiResponse({ status: 201, type: VideoDraftResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 403,
    description: 'Channel belongs to another user',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Authenticated user has no channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<VideoDraftResponseDto> {
    return this.videosService.create(user.sub, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Read the owner video',
    description:
      'Returns the draft or later state of a video owned by the authenticated channel.',
  })
  @ApiResponse({ status: 200, type: VideoDetailResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video does not exist or belongs to another channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoDetailResponseDto> {
    return this.videosService.findOwn(user.sub, id);
  }

  @Post(':id/upload')
  @ApiOperation({
    summary: 'Open or resume a direct upload',
    description:
      'Returns presigned part URLs for the bytes that are not stored yet. The file does not pass through the API.',
  })
  @ApiResponse({ status: 201, type: OpenUploadResponseDto })
  @ApiResponse({ status: 200, type: OpenUploadResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validation failed',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video does not exist or belongs to another channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video file is already stored',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 422,
    description: 'Empty file, file over 10GB, or content type is not video',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  async openUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: OpenUploadDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<OpenUploadResponseDto> {
    const opened = await this.videosService.openUpload(user.sub, id, dto);
    res.status(opened.statusCode);
    return opened.body;
  }

  @Post(':id/upload/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Finish the upload and schedule processing',
    description:
      'Completes the multipart upload, stores originals/{id}, and publishes one processing job. The response stays draft until the worker finishes.',
  })
  @ApiResponse({ status: 200, type: VideoDetailResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video does not exist or belongs to another channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Upload has not started or parts are still missing',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 422,
    description: 'Uploaded parts exceed 10GB',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 503,
    description: 'The file was stored but the processing job was refused',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  complete(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoDetailResponseDto> {
    return this.videosService.completeUpload(user.sub, id);
  }

  @Get(':id/playback')
  @ApiOperation({
    summary: 'Sign playback of a ready video',
    description:
      'Returns a presigned GET for the original object. The API does not read the file. Range is sent to storage, not signed here.',
  })
  @ApiResponse({ status: 200, type: SignedFileResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video does not exist or belongs to another channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready or the file is not stored',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  playback(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SignedFileResponseDto> {
    return this.videosService.playback(user.sub, id);
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Sign download of a ready video',
    description:
      'Returns a presigned GET of the same original object with response-content-disposition=attachment.',
  })
  @ApiResponse({ status: 200, type: SignedFileResponseDto })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 404,
    description: 'Video does not exist or belongs to another channel',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  @ApiResponse({
    status: 409,
    description: 'Video is not ready or the file is not stored',
    schema: { $ref: getSchemaPath(ApiErrorEnvelope) },
  })
  download(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SignedFileResponseDto> {
    return this.videosService.download(user.sub, id);
  }
}
