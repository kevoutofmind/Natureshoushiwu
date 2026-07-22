import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RouterModule } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiTeachingModule } from './ai-teaching/ai-teaching.module';
import { DataPipelineModule } from './data-pipeline';
import { DatabaseModule } from './database/database.module';
import { DraftsModule } from './drafts/drafts.module';
import { MediaAssetsModule } from './media-assets';
import { PopularDancesModule } from './popular-dances/popular-dances.module';
import { UsersModule } from './users/users.module';
import { VlmCoreModule } from './vlm-core';
import { VoiceControlModule } from './voice-control';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    DatabaseModule,
    MediaAssetsModule,
    DataPipelineModule,
    UsersModule,
    PopularDancesModule,
    AiTeachingModule,
    DraftsModule,
    VoiceControlModule,
    VlmCoreModule,
    RouterModule.register([{ path: 'api', module: VlmCoreModule }]),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
