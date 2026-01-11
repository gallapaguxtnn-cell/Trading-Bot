import { Controller, Get, Post, Body, Put, Param, Delete } from '@nestjs/common';
import { StrategiesService } from './strategies.service';
import { Strategy } from './strategy.entity';

@Controller('strategies')
export class StrategiesController {
  constructor(private readonly strategiesService: StrategiesService) {}

  @Get()
  findAll() {
    return this.strategiesService.findAll();
  }

  @Post()
  create(@Body() strategy: Partial<Strategy>) {
    return this.strategiesService.create(strategy);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() strategy: Partial<Strategy>) {
    return this.strategiesService.update(id, strategy);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.strategiesService.remove(id);
  }
}
