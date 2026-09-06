import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { PortfoliosService } from './portfolios.service';
import { Portfolio } from './portfolio.entity';

@Controller('portfolios')
export class PortfoliosController {
  constructor(private readonly portfoliosService: PortfoliosService) {}

  @Get()
  findAll() {
    return this.portfoliosService.findAllPublic();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.portfoliosService.findOnePublic(id);
  }

  @Post()
  create(@Body() body: Partial<Portfolio>) {
    return this.portfoliosService.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Partial<Portfolio>) {
    return this.portfoliosService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.portfoliosService.remove(id);
  }

  @Post(':id/test-connection')
  testConnection(@Param('id') id: string) {
    return this.portfoliosService.testConnection(id);
  }
}
