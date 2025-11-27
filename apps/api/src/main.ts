import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const logger = new Logger(
    bootstrap.name.charAt(0).toUpperCase() + bootstrap.name.slice(1),
  );
  app.enableCors();

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(new ValidationPipe());

  const PORT = process.env.PORT || 3500;
  await app.listen(PORT, () => {
    logger.log(
      `Running API in MODE: ${process.env.NODE_ENV} on Port: [${PORT}]`,
    );
  });
}
bootstrap();
