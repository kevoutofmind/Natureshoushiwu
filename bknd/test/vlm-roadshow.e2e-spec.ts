import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { App } from 'supertest/types';
import type { TeachingAgentTurnResult } from '../src/vlm-core/contracts/teaching-agent.types';
import { createLessonPlanFixture } from '../src/vlm-core/fixtures/teaching-agent.fixtures';
import {
  createRealtimeJudgeFixture,
  createTemplatePackFixture,
} from '../src/vlm-core/fixtures/realtime.fixtures';
import { RoadshowModule } from '../src/roadshow.module';

describe('VLM roadshow full chain (e2e)', () => {
  let app: INestApplication<App>;
  let dataRoot: string;
  let originalDataRoot: string | undefined;

  beforeAll(async () => {
    originalDataRoot = process.env.VLM_DATA_ROOT;
    dataRoot = await mkdtemp(join(tmpdir(), 'vlm-roadshow-'));
    process.env.VLM_DATA_ROOT = dataRoot;

    const moduleFixture = await Test.createTestingModule({
      imports: [RoadshowModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (originalDataRoot === undefined) delete process.env.VLM_DATA_ROOT;
    else process.env.VLM_DATA_ROOT = originalDataRoot;
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('registers a dataset, teaches one motion and accepts locally', async () => {
    const templatePack = createTemplatePackFixture();
    const dataset = {
      schemaVersion: 'reference-dance-dataset-v1',
      danceId: 'dance-001',
      title: 'Roadshow smoke dance',
      referenceVideoUrl: '/dances/dance-001/references/ref-01.mp4',
      generatedAt: new Date().toISOString(),
      sourceVideoCount: 2,
      lesson: createLessonPlanFixture(['motion-001']),
      templatePacks: [templatePack],
      extraction: {
        engine: 'mediapipe-holistic-landmarker',
        sampleFps: 6,
        detectedFrameCount: 20,
        motionCount: 1,
        handCoverage: 1,
      },
    };

    const registration = await request(app.getHttpServer())
      .post('/api/vlm-core/agent/datasets/register')
      .send(dataset)
      .expect(201);
    expect(registration.body).toMatchObject({
      danceId: 'dance-001',
      motionCount: 1,
      referenceCount: 2,
      persisted: true,
    });

    const persisted = JSON.parse(
      await readFile(
        join(dataRoot, 'dance-001', 'processed', 'dataset.json'),
        'utf8',
      ),
    ) as { schemaVersion: string };
    expect(persisted.schemaVersion).toBe('reference-dance-dataset-v1');

    const cachedDataset = await request(app.getHttpServer())
      .get('/api/vlm-core/agent/datasets/dance-001')
      .expect(200);
    expect(cachedDataset.body).toMatchObject({
      schemaVersion: 'reference-dance-dataset-v1',
      danceId: 'dance-001',
      sourceVideoCount: 2,
    });

    const started = await request(app.getHttpServer())
      .post('/api/vlm-core/agent/sessions/start')
      .send({
        schemaVersion: 'teaching-agent-start-v1',
        sessionId: 'roadshow-e2e-session',
        danceId: 'dance-001',
      })
      .expect(201);
    const startedBody = JSON.parse(started.text) as TeachingAgentTurnResult;
    expect(startedBody.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'PLAY_FULL_PREVIEW' }),
      ]),
    );

    await postEvent({
      eventId: 'preview-finished',
      type: 'PREVIEW_FINISHED',
      expectedVersion: 0,
    });
    const practice = await postEvent({
      eventId: 'demo-finished',
      type: 'MOTION_DEMO_FINISHED',
      expectedVersion: 1,
    });
    const practiceBody = JSON.parse(practice.text) as TeachingAgentTurnResult;
    expect(practiceBody.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'START_REALTIME_EVALUATION' }),
      ]),
    );

    const accepted = await postEvent({
      eventId: 'correct-observation',
      type: 'REALTIME_OBSERVATION',
      sampleId: 'correct-sample',
      observation: createRealtimeJudgeFixture('correct').observation,
      expectedVersion: 2,
    });
    const acceptedBody = JSON.parse(accepted.text) as TeachingAgentTurnResult;
    expect(acceptedBody.session.latestJudgeResult).toMatchObject({
      decision: 'ACCEPT',
      shouldAdvance: true,
    });
    expect(acceptedBody.commands).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: 'START_FULL_CHALLENGE' }),
      ]),
    );
  });

  it('maps the roadshow voice phrase to the previous action command', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/voice/commands/interpret')
      .send({ transcript: '倒退到上个动作' })
      .expect(200);

    const responseBody = JSON.parse(response.text) as {
      data: { command: { intent: string } };
    };
    expect(responseBody.data.command.intent).toBe('PREVIOUS_ACTION');
  });

  function postEvent(event: Record<string, unknown>) {
    return request(app.getHttpServer())
      .post('/api/vlm-core/agent/sessions/event')
      .send({
        schemaVersion: 'teaching-agent-event-v1',
        sessionId: 'roadshow-e2e-session',
        ...event,
      })
      .expect(201);
  }
});
