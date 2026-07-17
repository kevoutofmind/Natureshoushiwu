import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PopularDancesService } from './popular-dances.service';

@ApiTags('热门手势舞')
@Controller('api/popular-dances')
export class PopularDancesController {
  constructor(private readonly popularDancesService: PopularDancesService) {}

  @ApiOperation({ summary: '获取热门手势舞列表' })
  @ApiOkResponse({
    description: '返回已经导入的热门手势舞；当前数据库为空。',
    schema: {
      example: {
        success: true,
        code: 'POPULAR_DANCES_EMPTY',
        message: '热门手势舞数据尚未上传。',
        data: {
          items: [],
          total: 0,
        },
      },
    },
  })
  @Get()
  list() {
    return this.popularDancesService.list();
  }
}
