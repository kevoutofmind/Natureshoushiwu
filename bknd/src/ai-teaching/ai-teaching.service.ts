import { Injectable } from '@nestjs/common';

@Injectable()
export class AiTeachingService {
  getWorkspace(danceId?: string) {
    return {
      success: true,
      code: danceId
        ? 'TEACHING_WORKSPACE_READY'
        : 'WAITING_FOR_DANCE_SELECTION',
      message: danceId
        ? '教学工作区已接收手势舞选择。'
        : '请先从热门手势舞中选择教学内容。',
      data: {
        selectedDanceId: danceId ?? null,
        capabilities: {
          cameraRecording: true,
          localDrafts: true,
          voiceControl: true,
          vlmCoaching: false,
        },
      },
    };
  }
}
