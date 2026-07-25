import type { SimpleVoiceCommandIntent } from './contracts/voice-command.types';

export const PLAYBACK_RATE_STEPS = [0.5, 0.75, 1, 1.25, 1.5] as const;

export const VOICE_COMMAND_KEYWORDS = {
  PAUSE: ['暂停', '停一下', '先停', '等等', '等一下', '等我一下', '别播了', '先别播', '先不要动', '让我缓缓', '我跟不上'],
  RESUME: ['继续', '接着', '接着来', '继续播放', '恢复播放', '开始播放', '可以继续了', '我准备好了继续'],
  SLOW_DOWN: ['慢一点', '慢点', '再慢一点', '放慢一点', '放慢速度', '减慢速度', '降低速度', '降速', '减速', '慢放', '太快了', '有点快', '跟不上'],
  SPEED_UP: ['快一点', '快点', '再快一点', '加快一点', '加快速度', '提高速度', '提速', '加速', '太慢了', '有点慢'],
  PREVIOUS_ACTION: ['上个动作', '上一个动作', '前一个动作', '回到上个动作', '返回上个动作', '倒退到上个', '退回上个'],
  REPEAT_ACTION: ['这个动作再来一遍', '当前动作再来一遍', '再做一遍', '再来一遍', '重新做一遍', '重复这个动作', '再教我一次', '再示范一次', '没看清', '没学会', '我不会', '我还不会', '还是不会', '不会做', '我不会做', '教教我', '怎么做'],
  NEXT_ACTION: ['下个动作', '下一个动作', '跳到下个', '进入下个', '继续往下学', '这个会了', '这个学会了', '不用练这个'],
  RESTART_LESSON: ['从头开始教学', '重新开始教学', '整支重来', '从第一个动作开始'],
  READY: ['我准备好了', '已经准备好了', '直接开始练习', '现在开始练习', '开始拆动作', '跳过示范', '不用看完整示范'],
  START_RECORDING: ['开始录制', '启动录制', '开始录像', '启动录像'],
  STOP_RECORDING: ['停止录制', '结束录制', '完成录制', '停止录像', '结束录像', '完成录像'],
} as const satisfies Partial<Record<SimpleVoiceCommandIntent, readonly string[]>>;

export function containsVoiceKeyword(text: string, intent: keyof typeof VOICE_COMMAND_KEYWORDS): boolean {
  return VOICE_COMMAND_KEYWORDS[intent].some((keyword) => text.includes(keyword));
}

export function isPlaybackRateStep(value: number): boolean {
  return PLAYBACK_RATE_STEPS.some((step) => step === value);
}

export function nearestPlaybackRateStep(value: number): number {
  return PLAYBACK_RATE_STEPS.reduce((nearest, step) =>
    Math.abs(step - value) < Math.abs(nearest - value) ? step : nearest,
  );
}
