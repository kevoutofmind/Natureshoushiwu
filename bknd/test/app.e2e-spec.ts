import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/api/health (GET)', () => {
    return request(app.getHttpServer()).get('/api/health').expect(200).expect({
      status: 'ok',
      service: 'tiktok-ai-api',
    });
  });

  it('/api/voice/commands/interpret (POST)', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/voice/commands/interpret')
      .send({ transcript: '倒回五秒' })
      .expect(200);

    expect(response.body).toMatchObject({
      success: true,
      code: 'VOICE_COMMAND_RECOGNIZED',
      data: {
        accepted: true,
        command: {
          intent: 'REWIND',
          parameters: { seconds: 5 },
        },
      },
    });
  });

  it('/api/vlm-core/health (GET)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/vlm-core/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ready',
      realtimeMode: 'local-skeleton-template',
      cloudRequiredForRealtime: false,
      provider: 'mock',
    });
  });
});
