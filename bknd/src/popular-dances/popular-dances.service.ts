import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { DATABASE_POOL } from '../database/database.constants';

const DANCE_CARD_METADATA: Record<
  string,
  { displayTitle: string; creator: string }
> = {
  'dance-001': {
    displayTitle: '喵喵᳐の⩊の ᳐੭ﾞ #阿米嘎蒂朵喵喵手势舞 #montagemmiau',
    creator: '@张诗尧',
  },
  'dance-002': {
    displayTitle: '拨开天空的乌云☁️～ #转场',
    creator: '@张诗尧',
  },
  'dance-003': {
    displayTitle: '小心震荡！！！ #卷毛小狗 #迷核手势舞 #无畏契约',
    creator: '@小Pooo',
  },
  'dance-004': {
    displayTitle: '打败敌人后要说对不起ʕ·ᴥ·ʔ #手势舞 #喵',
    creator: '@My111',
  },
  'dance-005': {
    displayTitle:
      '咳咳咳... #obhcombisachet手势舞 #印尼止咳药手势舞 #手势舞 #手势舞天赋型选手',
    creator: '@菜佳佳',
  },
  'dance-006': {
    displayTitle: '我说了no就是no🙅‍♀️ #我说了no手势舞',
    creator: '@蓝羊羊不懒',
  },
};

@Injectable()
export class PopularDancesService {
  constructor(@Inject(DATABASE_POOL) private readonly database: Pool) {}

  async list() {
    const result = await this.database.query<{
      id: string;
      title: string;
      coverUrl: string;
      runtimeDanceId: string;
      durationSeconds: number | null;
      difficulty: string;
    }>(`
      SELECT
        dance_id AS id,
        title,
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
        items: result.rows.map((dance) => ({
          ...dance,
          displayTitle: DANCE_CARD_METADATA[dance.id]?.displayTitle ?? dance.title,
          creator: DANCE_CARD_METADATA[dance.id]?.creator ?? '主示例视频',
        })),
        total: result.rows.length,
      },
    };
  }
}
