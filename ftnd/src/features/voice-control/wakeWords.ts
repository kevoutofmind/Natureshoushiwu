export const VOICE_WAKE_WORDS = [
  "早上好",
  "早上号",
  "早上豪",
  "早上浩",
] as const;

const CHINESE_WAKE_PATTERN = /早上[好号豪浩]/;
const WAKE_SUFFIX_PATTERN = /^(?:\s*(?:ai|助手|小助手))?/i;

export interface VoiceWakeWordMatch {
  matched: boolean;
  payload: string;
}

export function extractVoiceWakeWordPayload(
  transcript: string,
): VoiceWakeWordMatch {
  const match = CHINESE_WAKE_PATTERN.exec(transcript);
  if (!match || match.index === undefined) {
    return { matched: false, payload: transcript.trim() };
  }

  const afterWakeWord = transcript.slice(match.index + match[0].length);
  const withoutAssistantSuffix = afterWakeWord.replace(WAKE_SUFFIX_PATTERN, "");
  return {
    matched: true,
    payload: withoutAssistantSuffix.replace(/^[\s,，。！!？?、:：]+/, "").trim(),
  };
}