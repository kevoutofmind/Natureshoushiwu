import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { TeachingAgentService } from '../agent/teaching-agent.service';
import type {
  ReferenceDanceDataset,
  ReferenceDatasetRegistrationResult,
  ReferenceDatasetSummary,
} from '../contracts/reference-dataset.types';
import { VlmCoreService } from '../vlm-core.service';
import { ReferenceDatasetRepository } from './reference-dataset.repository';

@Injectable()
export class ReferenceDatasetService implements OnModuleInit {
  private readonly logger = new Logger(ReferenceDatasetService.name);
  private readonly datasets = new Map<string, ReferenceDanceDataset>();
  private readonly dataRoot = process.env.VLM_DATA_ROOT
    ? resolve(process.env.VLM_DATA_ROOT)
    : resolve(process.cwd(), '..', 'data', 'dances');

  constructor(
    private readonly vlmCore: VlmCoreService,
    private readonly teachingAgent: TeachingAgentService,
    private readonly repository: ReferenceDatasetRepository,
  ) {}

  async onModuleInit(): Promise<void> {
    const databaseDatasets = await this.loadDatabaseDatasets();
    if (databaseDatasets.length > 0) {
      for (const dataset of databaseDatasets) {
        await this.register(dataset, false);
        this.logger.log(
          `Loaded reference dataset ${dataset.danceId} from PostgreSQL`,
        );
      }
      return;
    }

    let danceDirectories: string[];
    try {
      danceDirectories = await readdir(this.dataRoot);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn(`Unable to scan reference datasets: ${String(error)}`);
      }
      return;
    }

    for (const danceId of danceDirectories) {
      const datasetFile = this.datasetFile(danceId);
      try {
        const parsed = JSON.parse(
          await readFile(datasetFile, 'utf8'),
        ) as ReferenceDanceDataset;
        await this.register(parsed, false);
        this.logger.log(`Loaded reference dataset ${danceId} from local JSON`);
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          this.logger.warn(
            `Skipped invalid reference dataset ${datasetFile}: ${String(error)}`,
          );
        }
      }
    }
  }

  async register(
    dataset: ReferenceDanceDataset,
    persist = true,
  ): Promise<ReferenceDatasetRegistrationResult> {
    dataset = this.expandFourStageLesson(dataset);
    this.validate(dataset);

    for (const pack of dataset.templatePacks) {
      this.vlmCore.registerMotionTemplate(pack);
    }
    this.teachingAgent.registerLesson(dataset.lesson);
    this.datasets.set(dataset.danceId, structuredClone(dataset));

    if (persist) {
      const outputFile = this.datasetFile(dataset.danceId);
      await mkdir(dirname(outputFile), { recursive: true });
      await writeFile(
        outputFile,
        `${JSON.stringify(dataset, null, 2)}\n`,
        'utf8',
      );
      await this.repository.upsert(dataset);
    }

    return {
      schemaVersion: 'reference-dance-dataset-registration-v1',
      danceId: dataset.danceId,
      motionCount: dataset.templatePacks.length,
      referenceCount: dataset.sourceVideoCount,
      persisted: persist,
    };
  }

  list(): ReferenceDatasetSummary[] {
    return [...this.datasets.values()].map((dataset) => ({
      danceId: dataset.danceId,
      title: dataset.title,
      motionCount: dataset.templatePacks.length,
      sourceVideoCount: dataset.sourceVideoCount,
      generatedAt: dataset.generatedAt,
    }));
  }

  get(danceId: string): ReferenceDanceDataset | undefined {
    const dataset = this.datasets.get(danceId);
    return dataset ? structuredClone(dataset) : undefined;
  }

  private datasetFile(danceId: string): string {
    return join(this.dataRoot, danceId, 'processed', 'dataset.json');
  }

  private expandFourStageLesson(
    source: ReferenceDanceDataset,
  ): ReferenceDanceDataset {
    if (
      source.danceId !== 'cat' ||
      source.templatePacks.length !== 1 ||
      source.lesson.motions.length !== 1
    ) {
      return source;
    }
    const originalPack = source.templatePacks[0];
    const sortedKeyframes = [...(originalPack.keyframes ?? [])].sort(
      (left, right) => left.progress - right.progress,
    );
    if (sortedKeyframes.length < 4) return source;

    const stageCount = 4;
    const boundaries = [0];
    for (let stage = 1; stage < stageCount; stage += 1) {
      const splitIndex = Math.floor(
        (stage * sortedKeyframes.length) / stageCount,
      );
      const left = sortedKeyframes[Math.max(0, splitIndex - 1)].progress;
      const right =
        sortedKeyframes[Math.min(sortedKeyframes.length - 1, splitIndex)]
          .progress;
      boundaries.push((left + right) / 2);
    }
    boundaries.push(1);

    const originalMotion = source.lesson.motions[0];
    const demoDurationMs =
      originalMotion.demoEndMs - originalMotion.demoStartMs;
    const templatePacks = Array.from({ length: stageCount }, (_, stage) => {
      const start = boundaries[stage];
      const end = boundaries[stage + 1];
      const motionId = `${originalPack.motionId}-stage-${String(
        stage + 1,
      ).padStart(2, '0')}`;
      const templateIds = new Map(
        originalPack.templates.map((template) => [
          template.templateId,
          `${template.templateId}-stage-${stage + 1}`,
        ]),
      );
      const templates = originalPack.templates.map((template) => {
        const lastIndex = template.frames.length - 1;
        const startIndex = Math.max(0, Math.floor(start * lastIndex));
        const endIndex = Math.min(
          lastIndex,
          Math.max(startIndex + 1, Math.ceil(end * lastIndex)),
        );
        const frames = template.frames.slice(startIndex, endIndex + 1);
        const firstTimestamp = frames[0]?.timestampMs ?? 0;
        return {
          ...template,
          templateId: templateIds.get(template.templateId)!,
          frames: frames.map((frame) => ({
            ...frame,
            timestampMs: Math.max(0, frame.timestampMs - firstTimestamp),
          })),
        };
      });
      const keyframes = sortedKeyframes
        .filter(
          (keyframe) =>
            keyframe.progress >= start &&
            (stage === stageCount - 1
              ? keyframe.progress <= end
              : keyframe.progress < end),
        )
        .map((keyframe) => ({
          ...keyframe,
          progress: this.localProgress(keyframe.progress, start, end),
          templateProgress: Object.fromEntries(
            originalPack.templates.map((template) => {
              const originalProgress =
                keyframe.templateProgress?.[template.templateId] ??
                keyframe.progress;
              return [
                templateIds.get(template.templateId)!,
                this.localProgress(originalProgress, start, end),
              ];
            }),
          ),
        }));

      return {
        ...originalPack,
        motionId,
        motionName: `${originalPack.motionName ?? 'cat 动作'} · 第 ${
          stage + 1
        } 段`,
        instruction: `完整做出第 ${stage + 1} 个关键动作。`,
        expectedDurationMs: Math.max(
          1200,
          Math.round(originalPack.expectedDurationMs * (end - start)),
        ),
        keyframes,
        templates,
      };
    });

    return {
      ...source,
      lesson: {
        ...source.lesson,
        policy: {
          ...source.lesson.policy,
          confirmationRetryEnabled: true,
        },
        motions: templatePacks.map((pack, stage) => ({
          motionId: pack.motionId,
          instruction: pack.instruction,
          demoStartMs: Math.round(
            originalMotion.demoStartMs + boundaries[stage] * demoDurationMs,
          ),
          demoEndMs: Math.round(
            originalMotion.demoStartMs + boundaries[stage + 1] * demoDurationMs,
          ),
          demoPlaybackRate: originalMotion.demoPlaybackRate,
        })),
      },
      templatePacks,
      extraction: {
        ...source.extraction,
        motionCount: templatePacks.length,
      },
    };
  }

  private localProgress(progress: number, start: number, end: number): number {
    if (end <= start) return 0.5;
    return Math.max(0, Math.min(1, (progress - start) / (end - start)));
  }

  private async loadDatabaseDatasets(): Promise<ReferenceDanceDataset[]> {
    if (!this.repository.configured) return [];
    try {
      return await this.repository.list();
    } catch (error: unknown) {
      this.logger.warn(
        `Unable to load reference datasets from PostgreSQL; falling back to local JSON: ${String(error)}`,
      );
      return [];
    }
  }

  private validate(dataset: ReferenceDanceDataset): void {
    if (dataset?.schemaVersion !== 'reference-dance-dataset-v1') {
      this.fail('schemaVersion', 'must be reference-dance-dataset-v1');
    }
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(dataset.danceId)) {
      this.fail('danceId', 'contains unsupported characters');
    }
    if (!dataset.title?.trim() || !dataset.referenceVideoUrl?.trim()) {
      this.fail('title', 'title and referenceVideoUrl are required');
    }
    if (
      !Array.isArray(dataset.templatePacks) ||
      dataset.templatePacks.length === 0
    ) {
      this.fail(
        'templatePacks',
        'at least one motion template pack is required',
      );
    }
    if (dataset.lesson?.danceId !== dataset.danceId) {
      this.fail('lesson.danceId', 'must match dataset.danceId');
    }

    const lessonMotionIds = new Set(
      dataset.lesson.motions.map((motion) => motion.motionId),
    );
    for (const pack of dataset.templatePacks) {
      if (pack.danceId !== dataset.danceId) {
        this.fail('templatePacks.danceId', 'must match dataset.danceId');
      }
      if (!lessonMotionIds.has(pack.motionId)) {
        this.fail(
          'templatePacks.motionId',
          `motion ${pack.motionId} is missing from the lesson plan`,
        );
      }
    }
  }

  private fail(field: string, message: string): never {
    throw new BadRequestException({
      success: false,
      code: 'INVALID_REFERENCE_DATASET',
      message: 'Reference dance dataset is invalid.',
      fieldErrors: { [field]: message },
    });
  }
}
