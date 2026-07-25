import { getDanceNeutralFeedbackVocabulary } from "./dance-neutral-feedback-vocabulary";

export type NeutralFeedbackCategory =
  | "framing"
  | "posture"
  | "balance"
  | "movement"
  | "hands";

export const NEUTRAL_FEEDBACK_VOCABULARY: Readonly<
  Record<NeutralFeedbackCategory, readonly string[]>
> = {
  framing: [
    "离镜头稍微远一点",
    "让身体完整地留在画面里",
    "站到画面中间一点",
  ],
  posture: [
    "肩膀放松一点",
    "胸口打开一点",
    "上半身再挺拔一点",
  ],
  balance: [
    "身体重心再稳一点",
    "双脚站得自然一点",
    "动作之间保持稳定一点",
  ],
  movement: [
    "动作节奏再均匀一点",
    "动作幅度放自然一点",
    "连接动作时再从容一点",
  ],
  hands: [
    "双手放松一点",
    "手臂线条再自然一点",
    "手部动作保持清楚一点",
  ],
};

const NEUTRAL_FEEDBACK_CATEGORIES = Object.keys(
  NEUTRAL_FEEDBACK_VOCABULARY,
) as NeutralFeedbackCategory[];

export interface NeutralFeedbackSelectionOptions {
  danceId?: string;
  actionIndex?: number;
  limit?: number;
  random?: () => number;
}

export function selectNeutralFeedbackCues({
  danceId,
  actionIndex,
  limit = danceId ? 3 : 2,
  random = Math.random,
}: NeutralFeedbackSelectionOptions = {}): string[] {
  const safeLimit = Math.max(1, Math.min(3, Math.floor(limit)));
  const genericCues = selectTwoDistinctGenericCues(random);
  const danceCue = selectDanceSpecificCue(danceId, actionIndex, random);
  const combined = danceCue ? [danceCue, ...genericCues] : genericCues;
  return shuffle(combined, random).slice(0, safeLimit);
}

export function buildNeutralFailurePrompt(
  options: NeutralFeedbackSelectionOptions = {},
): string {
  const cues = selectNeutralFeedbackCues(options);
  return `先别着急，可以试着${cues.join("，")}，再完整跟一遍。`;
}

function selectTwoDistinctGenericCues(random: () => number): string[] {
  const remainingCategories = [...NEUTRAL_FEEDBACK_CATEGORIES];
  const firstCategory = takeRandom(remainingCategories, random);
  const secondCategory = takeRandom(remainingCategories, random);
  return [
    takeRandom([...NEUTRAL_FEEDBACK_VOCABULARY[firstCategory]], random),
    takeRandom([...NEUTRAL_FEEDBACK_VOCABULARY[secondCategory]], random),
  ];
}

function selectDanceSpecificCue(
  danceId: string | undefined,
  actionIndex: number | undefined,
  random: () => number,
): string | null {
  const vocabulary = getDanceNeutralFeedbackVocabulary(danceId);
  if (!vocabulary) return null;
  const actionCues =
    actionIndex !== undefined && Number.isInteger(actionIndex)
      ? vocabulary.actions[actionIndex]
      : undefined;
  const candidates = actionCues?.length ? actionCues : vocabulary.overall;
  return candidates.length > 0 ? takeRandom([...candidates], random) : null;
}

function takeRandom<T>(values: T[], random: () => number): T {
  const index = randomIndex(values.length, random);
  const [selected] = values.splice(index, 1);
  return selected;
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(index + 1, random);
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }
  return shuffled;
}

function randomIndex(length: number, random: () => number): number {
  const value = random();
  const normalized = Number.isFinite(value)
    ? Math.min(0.999999999, Math.max(0, value))
    : 0;
  return Math.floor(normalized * length);
}