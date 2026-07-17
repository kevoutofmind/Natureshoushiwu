import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppService } from './app.service';

@ApiTags('系统')
@Controller('api')
export class AppController {
  constructor(private readonly appService: AppService) {}

  @ApiOperation({ summary: '检查后端服务健康状态' })
  @ApiOkResponse({
    description: '服务运行正常。',
    schema: {
      example: {
        status: 'ok',
        service: 'tiktok-ai-api',
      },
    },
  })
  @Get('health')
  getHealth() {
    return this.appService.getHealth();
  }
}
