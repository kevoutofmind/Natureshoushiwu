import {
  BadRequestException,
  ValidationError,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
  const bodyLimit = process.env.REQUEST_BODY_LIMIT ?? '32mb';

  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  app.enableCors({ origin: frontendOrigin });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      stopAtFirstError: true,
      exceptionFactory: (errors: ValidationError[]) => {
        const fieldErrors = Object.fromEntries(
          errors.map((error) => [
            error.property,
            Object.values(error.constraints ?? {})[0] ?? '输入不合法。',
          ]),
        );

        return new BadRequestException({
          success: false,
          code: 'VALIDATION_ERROR',
          message: '请检查输入内容。',
          fieldErrors,
        });
      },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('MOVE / MATCH API')
    .setDescription(
      '抖音黑客松 AI 手势舞教学系统 REST API。所有新增接口必须同步维护 Swagger 装饰器和 DTO。',
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: '登录或注册接口返回的 accessToken',
      },
      'jwt',
    )
    .build();
  const swaggerDocument = () =>
    SwaggerModule.createDocument(app, swaggerConfig);

  SwaggerModule.setup('api/docs', app, swaggerDocument, {
    jsonDocumentUrl: '/api/openapi.json',
    customSiteTitle: 'MOVE / MATCH API Docs',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
    },
  });

  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
