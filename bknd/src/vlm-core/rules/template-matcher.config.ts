export const TEMPLATE_MATCHER_VERSION = 'template-matcher-v1.0.0';

export const TEMPLATE_MATCHER_CONFIG = {
  acceptThreshold: 0.78,
  acceptWithHintThreshold: 0.55,
  minimumCompletionProgress: 0.82,
  minimumObservationMs: 450,
  minimumFrameCount: 5,
  comparisonFrameCount: 16,
  minimumPoseVisibility: 0.55,
  minimumHandVisibility: 0.45,
  landmarkVisibilityThreshold: 0.35,
  poseDistanceScale: 0.55,
  handDistanceScale: 0.48,
  trajectoryDistanceScale: 0.8,
} as const;
