import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  configureApp(app);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Quotes Aggregator (NestJS) listening on port ${port}`);
}

bootstrap();
