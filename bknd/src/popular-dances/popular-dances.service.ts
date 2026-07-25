import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';

@Injectable()
export class PopularDancesService {
  constructor(@Inject(DATABASE_POOL) private readonly database: Pool) {}

  async list() {
    const result = await this.database.query<{
      id: string;
      title: string;
      creator: string;
      coverUrl: string;
      runtimeDanceId: string;
      durationSeconds: number | null;
      difficulty: string;
    }>(`
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

    return {
      success: true,
      code: result.rows.length > 0 ? 'POPULAR_DANCES_READY' : 'POPULAR_DANCES_EMPTY',
      message:
        result.rows.length > 0
          ? '热门手势舞数据已加载。'
          : '热门手势舞数据尚未上传。',
      data: {
        items: result.rows,
        total: result.rows.length,
      },
    };
  }
}
