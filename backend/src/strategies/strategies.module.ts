import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StrategiesController } from './strategies.controller';
import { StrategiesService } from './strategies.service';
import { Strategy } from './strategy.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Strategy])],
  controllers: [StrategiesController],
  providers: [StrategiesService],
  exports: [StrategiesService]
})
export class StrategiesModule {}
