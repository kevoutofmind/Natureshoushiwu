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
          responseText:
            '我没有完全听懂，但没关系。你可以直接告诉我“慢一点”“再教我一次”或者“我准备好了”。',
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

    if (
      /(我)?(已经)?准备好了/.test(text) ||
      /(直接|现在)(开始)?(练习|拆动作|教动作)/.test(text) ||
      /(不用|不想|可以不)(再)?看(完整|整段)?(示范|视频)/.test(text) ||
      /(跳过|略过)(完整)?(示范|预览)/.test(text)
    ) {
      return this.command(
        'READY',
        '按我的节奏开始',
        '好的，按你的节奏继续。',
        {},
        0.94,
      );
    }

    const conversationalCommand = this.matchConversationalCommand(text);
    if (conversationalCommand) return conversationalCommand;

    if (/(上个动作|上一个动作|前一个动作|倒退到上个|退回上个)/.test(text)) {
      return this.command(
        'PREVIOUS_ACTION',
        '上一个动作',
        '已识别：返回上一个动作。',
      );
    }

    if (
      /(这个动作|当前动作).*(再来|重做|重新)/.test(text) ||
      /(再做一遍|再来一遍|重新做一遍|重复这个动作)/.test(text)
    ) {
      return this.command(
        'REPEAT_ACTION',
        '重做当前动作',
        '已识别：重新示范当前动作。',
      );
    }

    if (/(下个动作|下一个动作|跳到下个|进入下个)/.test(text)) {
      return this.command(
        'NEXT_ACTION',
        '下一个动作',
        '已识别：进入下一个动作。',
      );
    }

    if (/(从头开始|整支重来|重新开始教学)/.test(text)) {
      return this.command(
        'RESTART_LESSON',
        '重新开始教学',
        '已识别：从头开始教学。',
      );
    }

    if (
      /^(重新播放|重新开始|重来|重来一遍|再从头播一遍)$/.test(text) ||
      /重新播放(当前|这个)?(视频|动作)/.test(text)
    ) {
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

    return this.matchConversationalCommand(text);
  }

  private matchConversationalCommand(text: string): MatchedCommand | null {
    const hasAny = (...cues: string[]) =>
      cues.some((cue) => text.includes(cue));

    if (
      hasAny('没看清', '没学会', '不太明白', '不会做', '帮我拆解') &&
      hasAny('动作', '刚才', '示范', '这个')
    ) {
      return this.command(
        'REPEAT_ACTION',
        '再讲一次当前动作',
        '当然可以，我们换一个更慢、更清楚的方式再看一次。',
        {},
        0.88,
      );
    }

    if (hasAny('这个会了', '往下学', '继续往下', '后面的动作', '不用练这个')) {
      return this.command(
        'NEXT_ACTION',
        '进入下一动作',
        '明白，我们继续往下学。',
        {},
        0.87,
      );
    }

    if (
      hasAny('刚才那个', '前面那个', '之前的动作') &&
      hasAny('再看', '回去', '复习', '重来')
    ) {
      return this.command(
        'PREVIOUS_ACTION',
        '回到上一动作',
        '好的，我们回到刚才的动作再巩固一下。',
        {},
        0.87,
      );
    }

    if (hasAny('等我一下', '让我缓缓', '我跟不上', '先别播', '先不要动')) {
      return this.command(
        'PAUSE',
        '暂停一下',
        '没问题，我们停一下，你准备好再继续。',
        {},
        0.9,
      );
    }

    return null;
  }

  private command(
    intent: SimpleVoiceCommandIntent,
    label: string,
    responseText: string,
    parameters: VoiceCommandParameters = {},
    confidence = 0.96,
  ): MatchedCommand {
    return {
      intent,
      label,
      responseText,
      parameters,
      confidence,
    };
  }
}
