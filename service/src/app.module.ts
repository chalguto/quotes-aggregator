import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { QuotesModule } from './quotes/quotes.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { EventsModule } from './events/events.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      ignoreEnvFile: false,
    }),
    EventsModule,
    MetricsModule,
    QuotesModule,
    HealthModule,
  ],
})
export class AppModule {}
