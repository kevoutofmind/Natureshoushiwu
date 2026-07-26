export const RANDOM_ACTION_FAILURE_RATE = 0.5;

export function passesRandomOnceEvaluation(
  hasFailedBefore: boolean,
  randomValue = Math.random(),
): boolean {
  return hasFailedBefore || randomValue >= RANDOM_ACTION_FAILURE_RATE;
}
