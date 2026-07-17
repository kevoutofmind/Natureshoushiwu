import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DraftsService } from './drafts.service';

@ApiTags('草稿箱')
@Controller('api/drafts')
export class DraftsController {
  constructor(private readonly draftsService: DraftsService) {}

  @ApiOperation({ summary: '获取草稿存储状态' })
  @ApiOkResponse({
    description: '当前录制草稿存储在浏览器 IndexedDB。',
    schema: {
      example: {
        success: true,
        code: 'SERVER_DRAFTS_EMPTY',
        message: '当前版本的录制草稿保存在浏览器本地。',
        data: {
          items: [],
          storageMode: 'browser-indexeddb',
        },
      },
    },
  })
  @Get()
  list() {
    return this.draftsService.list();
  }
}
