import { Module } from '@nestjs/common';
import { DataPipelineService } from './data-pipeline.service';

@Module({
  providers: [DataPipelineService],
  exports: [DataPipelineService],
})
export class DataPipelineModule {}
