import { BadRequestException, Injectable } from '@nestjs/common';
import type {
  VlmComparisonInput,
  VlmEvidenceWindow,
} from '../contracts/vision.types';

@Injectable()
export class ComparisonInputValidator {
  validate(input: VlmComparisonInput): void {
    if (input.schemaVersion !== 'vision-output-v0') {
      this.fail('schemaVersion', '必须为 vision-output-v0');
    }

    for (const field of [
      'sessionId',
      'sampleId',
      'actionId',
      'motionId',
    ] as const) {
      if (!input[field]?.trim()) {
        this.fail(field, '不能为空');
      }
    }

    if (!Array.isArray(input.references) || input.references.length === 0) {
      this.fail('references', '至少需要一个参考动作窗口');
    }

    for (const reference of input.references) {
      if (!reference.referenceId?.trim()) {
        this.fail('references.referenceId', '不能为空');
      }
      this.validateWindow(reference, `references.${reference.referenceId}`);
    }

    if (
      input.selectedReferenceId &&
      !input.references.some(
        (reference) => reference.referenceId === input.selectedReferenceId,
      )
    ) {
      this.fail(
        'selectedReferenceId',
        '必须对应 references 中存在的 referenceId',
      );
    }

    this.validateWindow(input.practice, 'practice');
    this.unitInterval(
      input.quality.alignmentConfidence,
      'quality.alignmentConfidence',
    );
    this.unitInterval(input.quality.bodyVisibility, 'quality.bodyVisibility');

    if (input.quality.leftHandVisibility !== undefined) {
      this.unitInterval(
        input.quality.leftHandVisibility,
        'quality.leftHandVisibility',
      );
    }
    if (input.quality.rightHandVisibility !== undefined) {
      this.unitInterval(
        input.quality.rightHandVisibility,
        'quality.rightHandVisibility',
      );
    }

    if (!Array.isArray(input.measurements)) {
      this.fail('measurements', '必须为数组');
    }

    input.measurements.forEach((measurement, index) => {
      if (!measurement.metric?.trim()) {
        this.fail(`measurements.${index}.metric`, '不能为空');
      }
      for (const [field, value] of [
        ['referenceValue', measurement.referenceValue],
        ['practiceValue', measurement.practiceValue],
        ['delta', measurement.delta],
      ] as const) {
        if (!Number.isFinite(value)) {
          this.fail(`measurements.${index}.${field}`, '必须为有限数值');
        }
      }
      this.unitInterval(
        measurement.reliability,
        `measurements.${index}.reliability`,
      );
      if (
        measurement.tolerance !== undefined &&
        (!Number.isFinite(measurement.tolerance) || measurement.tolerance < 0)
      ) {
        this.fail(`measurements.${index}.tolerance`, '必须为非负有限数值');
      }
    });
  }

  private validateWindow(window: VlmEvidenceWindow, field: string): void {
    if (!window.videoId?.trim()) {
      this.fail(`${field}.videoId`, '不能为空');
    }

    if (
      !Number.isFinite(window.startMs) ||
      !Number.isFinite(window.peakMs) ||
      !Number.isFinite(window.endMs) ||
      window.startMs < 0 ||
      window.startMs > window.peakMs ||
      window.peakMs > window.endMs
    ) {
      this.fail(field, '时间必须满足 0 <= startMs <= peakMs <= endMs');
    }

    if (
      !Array.isArray(window.frameUrls) ||
      window.frameUrls.length === 0 ||
      window.frameUrls.some((url) => !url?.trim())
    ) {
      this.fail(`${field}.frameUrls`, '至少需要一个有效图片地址');
    }
  }

  private unitInterval(value: number, field: string): void {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      this.fail(field, '必须在 0 到 1 之间');
    }
  }

  private fail(field: string, message: string): never {
    throw new BadRequestException({
      success: false,
      code: 'INVALID_VLM_INPUT',
      message: 'VLM 输入不合法。',
      fieldErrors: { [field]: message },
    });
  }
}
