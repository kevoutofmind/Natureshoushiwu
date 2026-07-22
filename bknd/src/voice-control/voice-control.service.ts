import { Injectable } from '@nestjs/common';
import type {
  SimpleVoiceCommandIntent,
  VoiceCommandParameters,
  VoiceCommandResponse,
} from './contracts/voice-command.types';

interface MatchedCommand {
  intent: SimpleVoiceCommandIntent;
  label: string;
  confidence: number;
  parameters: VoiceCommandParameters;
  responseText: string;
}

const CHINESE_NUMBERS: Record<string, number> = {
  一: 1,
  二: 2,
  两: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
  十: 10,
};

function normalizeTranscript(transcript: string) {
  return transcript
    .trim()
    .toLowerCase()
    .replace(/[，。！？、,!?]/g, '')
    .replace(/\s+/g, '');
}

function extractSeconds(text: string, fallback: number) {
  const arabicMatch = text.match(/(\d+(?:\.\d+)?)秒/);
  if (arabicMatch) return Number(arabicMatch[1]);

  const chineseMatch = text.match(/([一二两三四五六七八九十])秒/);
  if (chineseMatch) return CHINESE_NUMBERS[chineseMatch[1]] ?? fallback;

  return fallback;
}

function extractPlaybackRate(text: string) {
  const match = text.match(/(\d+(?:\.\d+)?)倍/);
  return match ? Number(match[1]) : null;
}

@Injectable()
export class VoiceControlService {
  interpret(transcript: string): VoiceCommandResponse {
    const normalizedTranscript = normalizeTranscript(transcript);
    const matched = this.matchSimpleCommand(normalizedTranscript);

    if (!matched) {
      return {
        success: true,
        code: 'VOICE_COMMAND_NOT_RECOGNIZED',
        message: '暂时无法识别这条语音指令。',
        data: {
          accepted: false,
          command: {
            transcript,
            normalizedTranscript,
            intent: null,
            confidence: 0,
            parameters: {},
          },
          label: null,
          responseText: '暂时无法识别这条指令，请换一种说法。',
          executionStatus: 'not-dispatched',
        },
      };
    }

    return {
      success: true,
      code: 'VOICE_COMMAND_RECOGNIZED',
      message: '已识别语音指令。',
      data: {
        accepted: true,
        command: {
          transcript,
          normalizedTranscript,
          intent: matched.intent,
          confidence: matched.confidence,
          parameters: matched.parameters,
        },
        label: matched.label,
        responseText: matched.responseText,
        executionStatus: 'not-dispatched',
      },
    };
  }

  private matchSimpleCommand(text: string): MatchedCommand | null {
    if (/(停止|结束|完成)(录制|录像)/.test(text)) {
      return this.command('STOP_RECORDING', '停止录制', '已识别：停止录制。');
    }

    if (/(开始|启动|现在开始)(录制|录像)/.test(text)) {
      return this.command('START_RECORDING', '开始录制', '已识别：开始录制。');
    }

    if (/(从头|重新|重来)/.test(text)) {
      return this.command('RESTART', '重新开始', '已识别：重新开始。');
    }

    if (/(倒回|回退|退回|往回|后退)/.test(text)) {
      const seconds = extractSeconds(text, 3);
      return this.command('REWIND', '倒回', `已识别：倒回 ${seconds} 秒。`, {
        seconds,
      });
    }

    if (/(快进|往后跳|向后跳)/.test(text)) {
      const seconds = extractSeconds(text, 3);
      return this.command(
        'FAST_FORWARD',
        '快进',
        `已识别：快进 ${seconds} 秒。`,
        { seconds },
      );
    }

    const playbackRate = extractPlaybackRate(text);
    if (playbackRate !== null) {
      if (playbackRate < 0.25 || playbackRate > 2) return null;
      return this.command(
        'SET_PLAYBACK_RATE',
        '设置倍速',
        `已识别：设置为 ${playbackRate} 倍速。`,
        { playbackRate },
      );
    }

    if (/(慢一点|慢点|慢放|减速|太快)/.test(text)) {
      return this.command('SLOW_DOWN', '慢一点', '已识别：降低播放速度。');
    }

    if (/(快一点|快点|加速|太慢)/.test(text)) {
      return this.command('SPEED_UP', '快一点', '已识别：提高播放速度。');
    }

    if (/(暂停|停一下|先停|等一下|别动)/.test(text) || text === '停') {
      return this.command('PAUSE', '暂停', '已识别：暂停。');
    }

    if (/(继续|接着|恢复播放|继续播放)/.test(text) || text === '播放') {
      return this.command('RESUME', '继续', '已识别：继续播放。');
    }

    return null;
  }

  private command(
    intent: SimpleVoiceCommandIntent,
    label: string,
    responseText: string,
    parameters: VoiceCommandParameters = {},
  ): MatchedCommand {
    return {
      intent,
      label,
      responseText,
      parameters,
      confidence: 0.96,
    };
  }
}
