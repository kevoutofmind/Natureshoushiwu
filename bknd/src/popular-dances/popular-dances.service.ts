import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';

export interface PopularDanceRow {
  id: string;
  title: string;
  creator: string;
  coverUrl: string;
  runtimeDanceId: string;
  durationSeconds: number | null;
  difficulty: string;
}

interface DanceCatalog {
  categories?: Array<{
    danceId: string;
    runtimeDanceId?: string;
    title: string;
    referenceVideoUrl: string;
    durationSeconds?: number;
    sortOrder?: number;
    analysisStatus?: string;
  }>;
}

@Injectable()
export class PopularDancesService {
  private readonly logger = new Logger(PopularDancesService.name);
  private readonly catalogFile = resolve(
    process.cwd(),
    '..',
    'data',
    'dances',
    'catalog.json',
  );

  constructor(
    @Optional()
    @Inject(DATABASE_POOL)
    private readonly database?: Pool,
  ) {}

  async list() {
    const databaseRows = await this.listFromDatabase();
    const items =
      databaseRows.length > 0 ? databaseRows : await this.listFromCatalog();

    return {
      success: true,
      code: items.length > 0 ? 'POPULAR_DANCES_READY' : 'POPULAR_DANCES_EMPTY',
      message:
        items.length > 0
          ? '热门手势舞数据已加载。'
          : '热门手势舞数据尚未上传。',
      data: {
        items,
        total: items.length,
      },
    };
  }

  private async listFromDatabase(): Promise<PopularDanceRow[]> {
    if (!this.database) return [];

    try {
      const result = await this.database.query<PopularDanceRow>(`
        SELECT
          dance_id AS id,
          title,
          '主示例视频' AS creator,
          reference_video_url AS "coverUrl",
          dance_id AS "runtimeDanceId",
          duration_seconds AS "durationSeconds",
          CASE analysis_status
            WHEN 'READY' THEN '可开始教学'
            ELSE '待动作解析'
          END AS difficulty
        FROM dance_categories
        ORDER BY sort_order ASC
      `);
      const runtimeIds = await this.loadRuntimeDanceIds();
      return result.rows.map((row) => ({
        ...row,
        runtimeDanceId: runtimeIds.get(row.id) ?? row.runtimeDanceId,
      }));
    } catch (error: unknown) {
      this.logger.warn(
        `Unable to load popular dances from PostgreSQL; falling back to local catalog: ${String(error)}`,
      );
      return [];
    }
  }

  private async listFromCatalog(): Promise<PopularDanceRow[]> {
    try {
      const catalog = JSON.parse(
        await readFile(this.catalogFile, 'utf8'),
      ) as DanceCatalog;
      return [...(catalog.categories ?? [])]
        .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0))
        .map((category) => ({
          id: category.danceId,
          title: category.title,
          creator: '主示例视频',
          coverUrl: category.referenceVideoUrl,
          runtimeDanceId: category.runtimeDanceId ?? category.danceId,
          durationSeconds: category.durationSeconds ?? null,
          difficulty:
            category.analysisStatus === 'READY' ? '可开始教学' : '待动作解析',
        }));
    } catch (error: unknown) {
      this.logger.warn(
        `Unable to load local dance catalog ${this.catalogFile}: ${String(error)}`,
      );
      return [];
    }
  }

  private async loadRuntimeDanceIds(): Promise<Map<string, string>> {
    try {
      const catalog = JSON.parse(
        await readFile(this.catalogFile, 'utf8'),
      ) as DanceCatalog;
      return new Map(
        (catalog.categories ?? []).map((category) => [
          category.danceId,
          category.runtimeDanceId ?? category.danceId,
        ]),
      );
    } catch {
      return new Map();
    }
  }
}
