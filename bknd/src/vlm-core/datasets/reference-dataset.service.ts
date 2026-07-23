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
  ) {}

  async onModuleInit(): Promise<void> {
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
        this.logger.log(`Loaded reference dataset ${danceId}`);
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
