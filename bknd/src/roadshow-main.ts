import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { RoadshowModule } from './roadshow.module';

async function bootstrap() {
  const app = await NestFactory.create(RoadshowModule, { bodyParser: false });
  const frontendOrigin = process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000';
  const bodyLimit = process.env.REQUEST_BODY_LIMIT ?? '32mb';

  app.use(json({ limit: bodyLimit }));
  app.use(urlencoded({ extended: true, limit: bodyLimit }));
  app.enableCors({ origin: frontendOrigin });
  await app.listen(process.env.PORT ?? 3001);
}

void bootstrap();
