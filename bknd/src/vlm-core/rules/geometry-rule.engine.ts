import { Injectable } from '@nestjs/common';
import type { VlmIssueCode } from '../contracts/issue-code.types';
import type {
  VlmComparisonInput,
  VlmMeasurement,
} from '../contracts/vision.types';
import { VLM_RULE_CONFIG } from './rule-config';
import type { VlmRuleCandidate, VlmRuleEvaluation } from './rule.types';

@Injectable()
export class GeometryRuleEngine {
  evaluate(input: VlmComparisonInput): VlmRuleEvaluation {
    if (
      input.quality.alignmentConfidence <
      VLM_RULE_CONFIG.minimumAlignmentConfidence
    ) {
      return {
        candidates: [],
        abstained: true,
        abstainReason: 'FRAME_ALIGNMENT_UNCERTAIN',
      };
    }

    if (input.quality.bodyVisibility < VLM_RULE_CONFIG.minimumBodyVisibility) {
      return {
        candidates: [],
        abstained: true,
        abstainReason: 'INSUFFICIENT_VISIBILITY',
      };
    }

    const candidates = input.measurements
      .filter(
        (measurement) =>
          measurement.reliability >=
          VLM_RULE_CONFIG.minimumMeasurementReliability,
      )
      .map((measurement) => this.toCandidate(measurement, input))
      .filter((candidate): candidate is VlmRuleCandidate => Boolean(candidate));

    return {
      candidates: this.deduplicateAndRank(candidates).slice(
        0,
        VLM_RULE_CONFIG.maximumCorrections,
      ),
      abstained: false,
    };
  }

  private toCandidate(
    measurement: VlmMeasurement,
    input: VlmComparisonInput,
  ): VlmRuleCandidate | undefined {
    const metric = measurement.metric.toLowerCase();

    if (metric.includes('hand_shape') || metric.includes('hand_gesture')) {
      return this.handShapeCandidate(measurement, input);
    }

    const tolerance = measurement.tolerance;
    if (
      tolerance === undefined ||
      tolerance <= 0 ||
      Math.abs(measurement.delta) <= tolerance
    ) {
      return undefined;
    }

    const bodyPart =
      measurement.bodyPart ?? this.inferBodyPart(measurement.metric);
    const ratio = Math.abs(measurement.delta) / tolerance;
    const severity = ratio >= 2.5 ? 'high' : ratio >= 1.5 ? 'medium' : 'low';
    const confidence = this.confidence(measurement.reliability, ratio);
    const autoPauseEligible =
      measurement.reliability >= VLM_RULE_CONFIG.autoPauseReliability &&
      input.quality.alignmentConfidence >=
        VLM_RULE_CONFIG.autoPauseAlignmentConfidence &&
      ratio >= VLM_RULE_CONFIG.autoPauseMarginRatio;

    let issueCode: VlmIssueCode | undefined;
    let instruction: string | undefined;

    if (metric.includes('elbow_angle')) {
      issueCode =
        measurement.delta > 0 ? 'ELBOW_TOO_STRAIGHT' : 'ELBOW_TOO_BENT';
      instruction =
        measurement.delta > 0
          ? `${this.displayBodyPart(bodyPart)}再弯曲一点，更接近示范姿势。`
          : `${this.displayBodyPart(bodyPart)}稍微伸展一些，不要弯曲过度。`;
    } else if (
      metric.includes('wrist_height') ||
      metric.includes('wrist_relative_y')
    ) {
      issueCode = measurement.delta < 0 ? 'WRIST_TOO_LOW' : 'WRIST_TOO_HIGH';
      instruction =
        measurement.delta < 0
          ? `${this.displayBodyPart(bodyPart)}再抬高一点，对齐参考位置。`
          : `${this.displayBodyPart(bodyPart)}稍微降低一点，对齐参考位置。`;
    } else if (metric.includes('torso_lean')) {
      issueCode = measurement.delta < 0 ? 'BODY_LEAN_LEFT' : 'BODY_LEAN_RIGHT';
      instruction =
        measurement.delta < 0
          ? '身体稍微回正，不要继续向左侧倾斜。'
          : '身体稍微回正，不要继续向右侧倾斜。';
    } else if (
      metric.includes('timing_offset') ||
      metric.includes('temporal_offset')
    ) {
      issueCode =
        measurement.delta < 0 ? 'TIMING_TOO_EARLY' : 'TIMING_TOO_LATE';
      instruction =
        measurement.delta < 0
          ? '这个动作稍微提前了，下一次跟随示范节奏。'
          : '这个动作稍微慢了，下一次跟随示范节奏。';
    } else if (
      metric.includes('left_right_asymmetry') ||
      metric.includes('bilateral_asymmetry')
    ) {
      issueCode = 'LEFT_RIGHT_ASYMMETRY';
      instruction = '调整左右手的位置，让两侧高度和展开幅度更接近示范。';
    } else if (metric.includes('direction_match')) {
      issueCode = 'WRONG_DIRECTION';
      instruction = '移动方向与示范相反，请确认镜像方向后再做一次。';
    }

    if (!issueCode || !instruction) {
      return undefined;
    }

    return {
      issueCode,
      bodyPart,
      severity,
      instruction,
      evidence: [this.toEvidence(measurement)],
      confidence,
      autoPauseEligible,
    };
  }

  private handShapeCandidate(
    measurement: VlmMeasurement,
    input: VlmComparisonInput,
  ): VlmRuleCandidate | undefined {
    if (
      !measurement.expectedLabel ||
      !measurement.observedLabel ||
      measurement.expectedLabel === measurement.observedLabel
    ) {
      return undefined;
    }

    const bodyPart =
      measurement.bodyPart ?? this.inferBodyPart(measurement.metric);
    const handVisibility = bodyPart?.startsWith('left')
      ? input.quality.leftHandVisibility
      : bodyPart?.startsWith('right')
        ? input.quality.rightHandVisibility
        : Math.min(
            input.quality.leftHandVisibility ?? 0,
            input.quality.rightHandVisibility ?? 0,
          );

    if (
      handVisibility === undefined ||
      handVisibility < VLM_RULE_CONFIG.minimumHandVisibility
    ) {
      return undefined;
    }

    const confidence = Math.min(
      measurement.reliability,
      handVisibility,
      input.quality.alignmentConfidence,
    );

    return {
      issueCode: 'WRONG_HAND_SHAPE',
      bodyPart,
      severity: 'medium',
      instruction: `${this.displayBodyPart(bodyPart)}应做成“${measurement.expectedLabel}”，请调整手指后再试一次。`,
      evidence: [this.toEvidence(measurement)],
      confidence,
      autoPauseEligible:
        confidence >= VLM_RULE_CONFIG.autoPauseReliability &&
        input.quality.alignmentConfidence >=
          VLM_RULE_CONFIG.autoPauseAlignmentConfidence,
    };
  }

  private toEvidence(measurement: VlmMeasurement) {
    return {
      metric: measurement.metric,
      referenceValue: measurement.referenceValue,
      practiceValue: measurement.practiceValue,
      delta: measurement.delta,
      reliability: measurement.reliability,
    };
  }

  private confidence(reliability: number, ratio: number): number {
    const marginConfidence = Math.min(1, 0.62 + ratio * 0.14);
    return Number(Math.min(reliability, marginConfidence).toFixed(3));
  }

  private inferBodyPart(metric: string): string | undefined {
    const normalized = metric.toLowerCase();
    const side = normalized.includes('left')
      ? 'left'
      : normalized.includes('right')
        ? 'right'
        : undefined;
    const part = normalized.includes('elbow')
      ? 'elbow'
      : normalized.includes('wrist')
        ? 'wrist'
        : normalized.includes('hand')
          ? 'hand'
          : normalized.includes('torso')
            ? 'torso'
            : undefined;

    return side && part ? `${side}_${part}` : part;
  }

  private displayBodyPart(bodyPart?: string): string {
    const labels: Record<string, string> = {
      left_elbow: '左肘',
      right_elbow: '右肘',
      left_wrist: '左手腕',
      right_wrist: '右手腕',
      left_hand: '左手',
      right_hand: '右手',
      torso: '身体',
    };
    return bodyPart ? (labels[bodyPart] ?? bodyPart) : '对应部位';
  }

  private deduplicateAndRank(
    candidates: VlmRuleCandidate[],
  ): VlmRuleCandidate[] {
    const byIssue = new Map<string, VlmRuleCandidate>();

    for (const candidate of candidates) {
      const key = `${candidate.issueCode}:${candidate.bodyPart ?? ''}`;
      const existing = byIssue.get(key);
      if (!existing || candidate.confidence > existing.confidence) {
        byIssue.set(key, candidate);
      }
    }

    return [...byIssue.values()].sort((left, right) => {
      if (left.autoPauseEligible !== right.autoPauseEligible) {
        return left.autoPauseEligible ? -1 : 1;
      }
      return right.confidence - left.confidence;
    });
  }
}
