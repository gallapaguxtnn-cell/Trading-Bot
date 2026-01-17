import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  
  app.setGlobalPrefix('api');
  
  // Enable CORS explicitly
  app.enableCors({
    origin: true, // Reflects the specific origin (allows frontend to connect)
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ transform: true }));

  const port = configService.get('PORT') || 3000;
  await app.listen(port, '0.0.0.0');
  
  logger.log(`Application is running on: ${await app.getUrl()}`);
  logger.log(`Listening on specific port: ${port}`);
}
bootstrap();
