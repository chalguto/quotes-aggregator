import { Module } from '@nestjs/common';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { AuthGuard } from '../common/guards/auth.guard';
import { IdempotencyService } from '../common/services/idempotency.service';
import { IdempotencyInterceptor } from '../common/interceptors/idempotency.interceptor';
import { MetricsModule } from '../metrics/metrics.module';
import { EventsModule } from '../events/events.module';

@Module({
  imports: [MetricsModule, EventsModule],
  providers: [
    QuotesService,
    AuthGuard,
    IdempotencyService,
    IdempotencyInterceptor,
  ],
  controllers: [QuotesController],
})
export class QuotesModule {}
