import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { MetricsService } from './metrics.service';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async metrics(@Res() res: Response): Promise<void> {
    const body = await this.metricsService.getMetrics();
    res
      .status(200)
      .setHeader('Content-Type', this.metricsService.contentType)
      .send(body);
  }
}
