export const RANDOM_ACTION_FAILURE_RATE = 0.5;

export function passesRandomOnceEvaluation(
  hasEvaluatedBefore: boolean,
  mustPassAfterFailure: boolean,
  randomValue = Math.random(),
): boolean {
  if (!hasEvaluatedBefore) return false;
  if (mustPassAfterFailure) return true;
  return randomValue >= RANDOM_ACTION_FAILURE_RATE;
}
