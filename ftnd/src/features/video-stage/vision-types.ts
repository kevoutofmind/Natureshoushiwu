export interface VisionLandmark {
  x: number;
  y: number;
  z: number;
  visibility?: number;
  presence?: number;
}

export interface SkeletonSnapshot {
  timestampMs: number;
  pose: VisionLandmark[];
  leftHand: VisionLandmark[];
  rightHand: VisionLandmark[];
}

export interface GeometryMeasurement {
  name: string;
  unit: 'degree' | 'shoulder_width' | 'score';
  referenceValue: number;
  practiceValue: number;
  delta: number;
  reliability: number;
}

export interface VisionComparisonPayload {
  schemaVersion: 'vision-output-v0';
  sessionId: string;
  sampleId: string;
  actionId: string;
  motionId: string;
  status: 'COMPLETED' | 'PAUSED' | 'RETRY';
  selectedReferenceId: string;
  referenceFrame: { timestampMs: number; imageDataUrl: string };
  practiceFrame: { timestampMs: number; imageDataUrl: string };
  landmarks: { reference: SkeletonSnapshot; practice: SkeletonSnapshot };
  measurements: GeometryMeasurement[];
  quality: { bodyVisibility: number; leftHandVisibility: number; rightHandVisibility: number; alignmentConfidence: number; mirrored: boolean };
  metadata: { model: 'mediapipe-holistic-landmarker'; normalizationVersion: 'skeleton-normalization-v1'; alignmentVersion: 'single-keyframe-v1' };
}