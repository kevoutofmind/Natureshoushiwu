import { Module } from '@nestjs/common';
import { PopularDancesController } from './popular-dances.controller';
import { PopularDancesService } from './popular-dances.service';

@Module({
  controllers: [PopularDancesController],
  providers: [PopularDancesService],
})
export class PopularDancesModule {}
