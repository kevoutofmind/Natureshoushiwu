export type VlmCompletionStatus =
  'completed' | 'partial' | 'paused' | 'retried';

export type VlmMeasurementUnit =
  'degree' | 'normalized_distance' | 'millisecond' | 'score' | 'category';

export interface VlmEvidenceWindow {
  videoId: string;
  startMs: number;
  peakMs: number;
  endMs: number;
  frameUrls: string[];
  clipUrl?: string;
}

export interface VlmReferenceEvidence extends VlmEvidenceWindow {
  referenceId: string;
}

/**
 * 视觉模块输出的可复核测量。
 *
 * 约定：
 * - delta = practiceValue - referenceValue。
 * - 肘角越大表示手臂越直。
 * - wrist_height_delta 的正值表示练习手腕高于参考，负值表示低于参考。
 * - torso_lean_deg 的正值表示向右倾，负值表示向左倾。
 * - timing_offset_ms 的正值表示练习晚于参考，负值表示早于参考。
 */
export interface VlmMeasurement {
  metric: string;
  bodyPart?: string;
  referenceValue: number;
  practiceValue: number;
  delta: number;
  tolerance?: number;
  reliability: number;
  unit?: VlmMeasurementUnit;
  referenceId?: string;
  expectedLabel?: string;
  observedLabel?: string;
}

export interface VlmVisionQuality {
  alignmentConfidence: number;
  bodyVisibility: number;
  leftHandVisibility?: number;
  rightHandVisibility?: number;
  visibleBodyParts: string[];
  occludedBodyParts: string[];
  mirrored: boolean;
}

export interface VlmCompletion {
  status: VlmCompletionStatus;
  alignedReferenceCoverage?: number;
  pauseStartMs?: number;
}

export interface VlmComparisonContext {
  actionName?: string;
  motionName?: string;
  referenceInstruction?: string;
  attemptIndex?: number;
  locale?: string;
}

/**
 * vision-output-v0 是视觉负责人和 VLM Core 之间的稳定交付协议。
 * 人工 Ground Truth 不允许出现在此输入中，避免答案泄漏。
 */
export interface VlmComparisonInput {
  schemaVersion: 'vision-output-v0';
  sessionId: string;
  sampleId: string;
  actionId: string;
  motionId: string;
  references: VlmReferenceEvidence[];
  selectedReferenceId?: string;
  practice: VlmEvidenceWindow;
  measurements: VlmMeasurement[];
  quality: VlmVisionQuality;
  completion: VlmCompletion;
  context?: VlmComparisonContext;
}
