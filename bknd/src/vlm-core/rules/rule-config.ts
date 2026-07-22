export const VLM_RULE_VERSION = 'rule-v1.0.0-local-realtime';

export const VLM_RULE_CONFIG = {
  minimumAlignmentConfidence: 0.68,
  minimumBodyVisibility: 0.62,
  minimumHandVisibility: 0.58,
  minimumMeasurementReliability: 0.65,
  autoPauseReliability: 0.92,
  autoPauseAlignmentConfidence: 0.9,
  autoPauseMarginRatio: 1.8,
  maximumCorrections: 3,
} as const;
