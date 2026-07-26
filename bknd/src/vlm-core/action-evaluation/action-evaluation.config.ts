/**
 * The first completed evaluation for a motion has an even chance of failing.
 * Once that motion has failed in the current lesson run, its next evaluation
 * is forced to pass.
 */
export const RANDOM_ACTION_FAILURE_RATE = 0.5;

export const RANDOM_ACTION_EVALUATOR_VERSION = 'random-once-v1';

export const RANDOM_ACTION_PASS_SCORE = 0.88;

export const RANDOM_ACTION_FAILURE_SCORE = 0.42;
