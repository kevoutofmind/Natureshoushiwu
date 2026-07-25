export const IMMEDIATE_COMMAND_RESET_DELAY_MS = 1000;

export const ACTION_NAVIGATION_VOICE_COMMANDS = {
  PREVIOUS_ACTION: ['上个动作', '上一个动作', '前一个动作', '回到上个动作', '返回上个动作', '倒退到上个', '退回上个'],
  REPEAT_ACTION: ['这个动作再来一遍', '当前动作再来一遍', '再做一遍', '再来一遍', '重新做一遍', '重复这个动作', '再教我一次', '再示范一次', '没看清', '没学会', '我不会', '我还不会', '还是不会', '不会做', '我不会做', '教教我', '怎么做'],
  NEXT_ACTION: ['下个动作', '下一个动作', '跳到下个', '进入下个', '继续往下学', '这个会了', '这个学会了', '不用练这个'],
  RESTART_LESSON: ['从头开始教学', '重新开始教学', '整支重来', '从第一个动作开始'],
} as const;

const actionNavigationCommandValues = Object.values(
  ACTION_NAVIGATION_VOICE_COMMANDS,
).flat();

export type ActionNavigationVoiceIntent =
  keyof typeof ACTION_NAVIGATION_VOICE_COMMANDS;

export function matchActionNavigationVoiceIntent(
  transcript: string,
): ActionNavigationVoiceIntent | null {
  const normalized = normalizeVoiceTranscript(transcript);
  for (const [intent, phrases] of Object.entries(
    ACTION_NAVIGATION_VOICE_COMMANDS,
  ) as Array<
    [ActionNavigationVoiceIntent, readonly string[]]
  >) {
    if (phrases.some((phrase) => normalized.includes(phrase))) return intent;
  }
  return null;
}

export function canDispatchAfterCooldown(
  now: number,
  blockedUntil: number,
): boolean {
  return now >= blockedUntil;
}

export function normalizeVoiceTranscript(transcript: string): string {
  return transcript
    .trim()
    .toLowerCase()
    .replace(/(\d)[,，](\d)/g, '$1.$2')
    .replace(/[，。！？、,!?]/g, "")
    .replace(/\s+/g, "");
}

const fixedCommandValues = [
  "这个动作重新做一遍", "重新开始教学", "从头开始教学", "直接开始练习",
  "重复这个动作", "重新做一遍", "再从头播一遍", "已经准备好了",
  "我准备好了", "恢复播放", "继续播放", "倒退到上个", "退回上个",
  "上一个动作", "前一个动作", "再做一遍", "再来一遍", "下一个动作",
  "跳到下个", "进入下个", "整支重来", "重新播放", "重新开始",
  "重来一遍", "开始录制", "启动录制", "开始录像", "启动录像",
  "停止录制", "结束录制", "完成录制", "停止录像", "结束录像",
  "完成录像", "先停一下", "停一下", "继续", "接着来", "接着", "播放",
  "快一点", "快点", "加速", "别太慢", "慢一点", "慢点", "慢放", "减速",
  "别太快", "上个动作", "下个动作", "从头开始", "重来", "暂停", "先停", "停",
] as const;

const additionalImmediateCommandValues = [
  '再快一点', '加快一点', '加快速度', '提高速度', '提速', '太慢了', '有点慢',
  '再慢一点', '放慢一点', '放慢速度', '减慢速度', '降低速度', '降速',
  '太快了', '有点快', '正常速度', '标准速度', '普通速度', '原速',
  '一倍速', '半速',
] as const;

const secondsCommandPattern =
  "(倒回|回退|退回|往回|后退|快进|往后跳|向后跳)(\\d+(?:\\.\\d+)?|[一二两三四五六七八九十])秒";
const playbackRateCommandPattern = "(调到|设置为?|改成)?\\d+(?:\\.\\d+)?倍(速)?";

const spokenPlaybackRateCommandPattern =
  '(调到|设置为?|改成)?([零〇一]点(?:五|七五|二五)|四分之三|半)倍(速)?';

interface CommandCandidate {
  command: string;
  index: number;
}

function laterCommand(
  current: CommandCandidate | null,
  candidate: CommandCandidate,
): CommandCandidate {
  if (!current) return candidate;
  const currentEnd = current.index + current.command.length;
  const candidateEnd = candidate.index + candidate.command.length;
  if (candidateEnd > currentEnd) return candidate;
  if (
    candidateEnd === currentEnd &&
    candidate.command.length > current.command.length
  ) {
    return candidate;
  }
  return current;
}

export function extractImmediateVoiceCommand(
  transcript: string,
): string | null {
  const normalized = normalizeVoiceTranscript(transcript);
  let latest: CommandCandidate | null = null;

  for (const command of [
    ...fixedCommandValues,
    ...additionalImmediateCommandValues,
    ...actionNavigationCommandValues,
  ]) {
    const index = normalized.lastIndexOf(command);
    if (index >= 0) latest = laterCommand(latest, { command, index });
  }

  for (const pattern of [secondsCommandPattern, playbackRateCommandPattern, spokenPlaybackRateCommandPattern]) {
    for (const match of normalized.matchAll(new RegExp(pattern, "g"))) {
      latest = laterCommand(latest, { command: match[0], index: match.index });
    }
  }

  return latest?.command ?? null;
}
