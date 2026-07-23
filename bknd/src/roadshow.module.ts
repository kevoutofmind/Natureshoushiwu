import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RouterModule } from '@nestjs/core';
import { AiTeachingModule } from './ai-teaching/ai-teaching.module';
import { VlmCoreModule } from './vlm-core';

/**
 * Database-free runtime used by the H5 teaching demo.
 *
 * The normal AppModule remains unchanged for the complete product. This module
 * deliberately contains only the teaching workspace, voice parser and VLM
 * pipeline so a roadshow computer can start the core experience without first
 * provisioning PostgreSQL.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AiTeachingModule,
    RouterModule.register([{ path: 'api', module: VlmCoreModule }]),
  ],
})
export class RoadshowModule {}
