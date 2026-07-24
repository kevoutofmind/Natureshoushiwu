import { Inject, Injectable, Optional } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../../database/database.constants';
import type { ReferenceDanceDataset } from '../contracts/reference-dataset.types';

interface ReferenceDatasetRow {
  dataset: ReferenceDanceDataset;
}

@Injectable()
export class ReferenceDatasetRepository {
  private schemaReady?: Promise<void>;

  constructor(
    @Optional()
    @Inject(DATABASE_POOL)
    private readonly pool?: Pool,
  ) {}

  get configured(): boolean {
    return Boolean(this.pool);
  }

  async list(): Promise<ReferenceDanceDataset[]> {
    if (!this.pool) return [];
    await this.ensureSchema();
    const result = await this.pool.query<ReferenceDatasetRow>(
      `SELECT dataset
       FROM reference_datasets
       ORDER BY dance_id`,
    );
    return result.rows.map((row) => structuredClone(row.dataset));
  }

  async upsert(dataset: ReferenceDanceDataset): Promise<boolean> {
    if (!this.pool) return false;
    await this.ensureSchema();
    await this.pool.query(
      `INSERT INTO reference_datasets (
         dance_id,
         schema_version,
         title,
         source_video_count,
         motion_count,
         generated_at,
         dataset
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
       ON CONFLICT (dance_id) DO UPDATE SET
         schema_version = EXCLUDED.schema_version,
         title = EXCLUDED.title,
         source_video_count = EXCLUDED.source_video_count,
         motion_count = EXCLUDED.motion_count,
         generated_at = EXCLUDED.generated_at,
         dataset = EXCLUDED.dataset,
         updated_at = NOW()`,
      [
        dataset.danceId,
        dataset.schemaVersion,
        dataset.title,
        dataset.sourceVideoCount,
        dataset.templatePacks.length,
        dataset.generatedAt || null,
        JSON.stringify(dataset),
      ],
    );
    return true;
  }

  private ensureSchema(): Promise<void> {
    if (!this.pool) return Promise.resolve();
    this.schemaReady ??= this.pool
      .query(
        `
        CREATE TABLE IF NOT EXISTS reference_datasets (
          dance_id VARCHAR(64) PRIMARY KEY,
          schema_version VARCHAR(64) NOT NULL,
          title VARCHAR(255) NOT NULL,
          source_video_count INTEGER NOT NULL CHECK (source_video_count > 0),
          motion_count INTEGER NOT NULL CHECK (motion_count > 0),
          generated_at TIMESTAMPTZ,
          dataset JSONB NOT NULL,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE INDEX IF NOT EXISTS reference_datasets_dataset_gin
          ON reference_datasets USING GIN (dataset);
      `,
      )
      .then(() => undefined);
    return this.schemaReady;
  }
}
