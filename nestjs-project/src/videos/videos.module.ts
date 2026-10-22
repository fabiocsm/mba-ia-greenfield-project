import { Module } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ChannelsModule } from '../channels/channels.module';
import storageConfig from '../config/storage.config';
import { Video } from './entities/video.entity';
import { PublicUrlAllocator } from './public-url.allocator';
import { S3VideoStorage } from './s3-video-storage';
import { VideoProcessingQueue } from './video-processing.queue';
import { VideoStorage } from './video-storage';
import { VideosController } from './videos.controller';
import { VideosService } from './videos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Video]), ChannelsModule],
  controllers: [VideosController],
  providers: [
    VideosService,
    PublicUrlAllocator,
    {
      provide: VideoStorage,
      useFactory: (config: ConfigType<typeof storageConfig>) =>
        new S3VideoStorage(config),
      inject: [storageConfig.KEY],
    },
    VideoProcessingQueue,
  ],
  exports: [TypeOrmModule],
})
export class VideosModule {}
