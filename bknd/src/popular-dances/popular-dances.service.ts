import { Injectable } from '@nestjs/common';

@Injectable()
export class PopularDancesService {
  list() {
    return {
      success: true,
      code: 'POPULAR_DANCES_EMPTY',
      message: '热门手势舞数据尚未上传。',
      data: {
        items: [],
        total: 0,
      },
    };
  }
}
