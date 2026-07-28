import { Injectable } from '@nestjs/common';
import type {
  SimpleVoiceCommandIntent,
  VoiceCommandParameters,
  VoiceCommandResponse,
} from './contracts/voice-command.types';
import {
  containsVoiceKeyword,
  isPlaybackRateStep,
} from './voice-command-keywords';

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
    .replace(/(\d)[,，](\d)/g, '$1.$2')
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
  if (match) return Number(match[1]);

  const spokenRates: Array<[RegExp, number]> = [
    [/(?:零|〇)点五倍|半倍|半速/, 0.5],
    [/(?:零|〇)点七五倍|四分之三倍/, 0.75],
    [/一点二五倍/, 1.25],
    [/一点五倍/, 1.5],
    [/(?:正常|标准|普通|原|一)倍?(?:速|速度)/, 1],
  ];
  return spokenRates.find(([pattern]) => pattern.test(text))?.[1] ?? null;
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
            '没关系，你正在一点点找到感觉，我会一直陪着你。想调整时可以说“慢一点”“再来一遍”或“继续”。',
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
    if (containsVoiceKeyword(text, 'STOP_RECORDING')) {
      return this.command('STOP_RECORDING', '停止录制', '已识别：停止录制。');
    }

    if (containsVoiceKeyword(text, 'START_RECORDING')) {
      return this.command('START_RECORDING', '开始录制', '已识别：开始录制。');
    }

    if (
      containsVoiceKeyword(text, 'READY') ||
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

    if (containsVoiceKeyword(text, 'PREVIOUS_ACTION')) {
      return this.command(
        'PREVIOUS_ACTION',
        '上一个动作',
        '已识别：返回上一个动作。',
      );
    }

    if (
      containsVoiceKeyword(text, 'REPEAT_ACTION') ||
      /(这个动作|当前动作).*(再来|重做|重新)/.test(text)
    ) {
      return this.command(
        'REPEAT_ACTION',
        '重做当前动作',
        '已识别：重新示范当前动作。',
      );
    }

    if (containsVoiceKeyword(text, 'NEXT_ACTION')) {
      return this.command(
        'NEXT_ACTION',
        '下一个动作',
        '已识别：进入下一个动作。',
      );
    }

    if (containsVoiceKeyword(text, 'RESTART_LESSON') || text.includes('从头开始')) {
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
      if (!isPlaybackRateStep(playbackRate)) return null;
      return this.command(
        'SET_PLAYBACK_RATE',
        '设置倍速',
        `已识别：设置为 ${playbackRate} 倍速。`,
        { playbackRate },
      );
    }

    if (containsVoiceKeyword(text, 'SLOW_DOWN')) {
      return this.command('SLOW_DOWN', '慢一点', '好的，我们降低一档，稳稳地跟上动作。');
    }

    if (containsVoiceKeyword(text, 'SPEED_UP')) {
      return this.command('SPEED_UP', '快一点', '好的，我们提高一档，继续保持这个状态。');
    }

    if (containsVoiceKeyword(text, 'PAUSE') || text === '停') {
      return this.command('PAUSE', '暂停', '已识别：暂停。');
    }

    if (containsVoiceKeyword(text, 'RESUME') || text === '播放') {
      return this.command('RESUME', '继续', '已识别：继续播放。');
    }

    return this.matchConversationalCommand(text);
  }

  private matchConversationalCommand(text: string): MatchedCommand | null {
    const hasAny = (...cues: string[]) =>
      cues.some((cue) => text.includes(cue));

    if (
      hasAny(
        '没看清',
        '没有看清',
        '没学会',
        '不太明白',
        '不会做',
        '帮我拆解',
      ) &&
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
