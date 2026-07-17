import { Module } from '@nestjs/common';
import { VlmCoreService } from './vlm-core.service';

@Module({
  providers: [VlmCoreService],
  exports: [VlmCoreService],
})
export class VlmCoreModule {}
