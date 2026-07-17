import { Module } from '@nestjs/common';
import { MediaAssetsService } from './media-assets.service';

@Module({
  providers: [MediaAssetsService],
  exports: [MediaAssetsService],
})
export class MediaAssetsModule {}
