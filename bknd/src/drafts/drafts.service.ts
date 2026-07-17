import { Injectable } from '@nestjs/common';

@Injectable()
export class DraftsService {
  list() {
    return {
      success: true,
      code: 'SERVER_DRAFTS_EMPTY',
      message: '当前版本的录制草稿保存在浏览器本地。',
      data: {
        items: [],
        storageMode: 'browser-indexeddb',
      },
    };
  }
}
