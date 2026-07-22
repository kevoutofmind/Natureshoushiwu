import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type {
  VlmComparisonContext,
  VlmComparisonInput,
  VlmCompletion,
  VlmCompletionStatus,
  VlmEvidenceWindow,
  VlmMeasurement,
  VlmMeasurementUnit,
  VlmReferenceEvidence,
  VlmVisionQuality,
} from '../contracts/vision.types';

const COMPLETION_STATUSES: VlmCompletionStatus[] = [
  'completed',
  'partial',
  'paused',
  'retried',
];

const MEASUREMENT_UNITS: VlmMeasurementUnit[] = [
  'degree',
  'normalized_distance',
  'millisecond',
  'score',
  'category',
];

export class EvidenceWindowDto implements VlmEvidenceWindow {
  @ApiProperty({ example: 'practice-video-001' })
  @IsString()
  videoId!: string;

  @ApiProperty({ example: 2100 })
  @IsInt()
  @Min(0)
  startMs!: number;

  @ApiProperty({ example: 2700 })
  @IsInt()
  @Min(0)
  peakMs!: number;

  @ApiProperty({ example: 3200 })
  @IsInt()
  @Min(0)
  endMs!: number;

  @ApiProperty({
    type: [String],
    example: [
      'https://example.com/practice-start.jpg',
      'https://example.com/practice-peak.jpg',
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  frameUrls!: string[];

  @ApiPropertyOptional({
    example: 'https://example.com/practice-window.mp4',
  })
  @IsOptional()
  @IsString()
  clipUrl?: string;
}

export class ReferenceEvidenceDto
  extends EvidenceWindowDto
  implements VlmReferenceEvidence
{
  @ApiProperty({ example: 'reference-take-02' })
  @IsString()
  referenceId!: string;
}

export class MeasurementDto implements VlmMeasurement {
  @ApiProperty({
    example: 'right_elbow_angle_deg',
    description:
      '支持 elbow_angle、wrist_height、torso_lean、timing_offset、hand_shape 等规范指标。',
  })
  @IsString()
  metric!: string;

  @ApiPropertyOptional({ example: 'right_elbow' })
  @IsOptional()
  @IsString()
  bodyPart?: string;

  @ApiProperty({ example: 82.4 })
  @IsNumber()
  referenceValue!: number;

  @ApiProperty({ example: 121.7 })
  @IsNumber()
  practiceValue!: number;

  @ApiProperty({
    example: 39.3,
    description: '必须等于 practiceValue - referenceValue。',
  })
  @IsNumber()
  delta!: number;

  @ApiPropertyOptional({ example: 15 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  tolerance?: number;

  @ApiProperty({ example: 0.96, minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  reliability!: number;

  @ApiPropertyOptional({ enum: MEASUREMENT_UNITS })
  @IsOptional()
  @IsIn(MEASUREMENT_UNITS)
  unit?: VlmMeasurementUnit;

  @ApiPropertyOptional({ example: 'reference-take-02' })
  @IsOptional()
  @IsString()
  referenceId?: string;

  @ApiPropertyOptional({ example: 'victory' })
  @IsOptional()
  @IsString()
  expectedLabel?: string;

  @ApiPropertyOptional({ example: 'open_palm' })
  @IsOptional()
  @IsString()
  observedLabel?: string;
}

export class VisionQualityDto implements VlmVisionQuality {
  @ApiProperty({ example: 0.93, minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  alignmentConfidence!: number;

  @ApiProperty({ example: 0.96, minimum: 0, maximum: 1 })
  @IsNumber()
  @Min(0)
  @Max(1)
  bodyVisibility!: number;

  @ApiPropertyOptional({ example: 0.91, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  leftHandVisibility?: number;

  @ApiPropertyOptional({ example: 0.88, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  rightHandVisibility?: number;

  @ApiProperty({
    type: [String],
    example: ['right_shoulder', 'right_elbow', 'right_wrist'],
  })
  @IsArray()
  @IsString({ each: true })
  visibleBodyParts!: string[];

  @ApiProperty({ type: [String], example: [] })
  @IsArray()
  @IsString({ each: true })
  occludedBodyParts!: string[];

  @ApiProperty({ example: false })
  @IsBoolean()
  mirrored!: boolean;
}

export class CompletionDto implements VlmCompletion {
  @ApiProperty({ enum: COMPLETION_STATUSES, example: 'completed' })
  @IsIn(COMPLETION_STATUSES)
  status!: VlmCompletionStatus;

  @ApiPropertyOptional({ example: 0.92, minimum: 0, maximum: 1 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  alignedReferenceCoverage?: number;

  @ApiPropertyOptional({ example: 3680 })
  @IsOptional()
  @IsInt()
  @Min(0)
  pauseStartMs?: number;
}

export class ComparisonContextDto implements VlmComparisonContext {
  @ApiPropertyOptional({ example: '双手交叉展开舞' })
  @IsOptional()
  @IsString()
  actionName?: string;

  @ApiPropertyOptional({ example: '双手放至肩膀' })
  @IsOptional()
  @IsString()
  motionName?: string;

  @ApiPropertyOptional({
    example: '把双手放到肩膀两侧，手肘自然向外。',
  })
  @IsOptional()
  @IsString()
  referenceInstruction?: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(1)
  attemptIndex?: number;

  @ApiPropertyOptional({ example: 'zh-CN' })
  @IsOptional()
  @IsString()
  locale?: string;
}

export class AnalyzeComparisonDto implements VlmComparisonInput {
  @ApiProperty({ example: 'vision-output-v0' })
  @IsIn(['vision-output-v0'])
  schemaVersion!: 'vision-output-v0';

  @ApiProperty({ example: 'session-001' })
  @IsString()
  sessionId!: string;

  @ApiProperty({ example: 'sample-001' })
  @IsString()
  sampleId!: string;

  @ApiProperty({ example: 'dance-001' })
  @IsString()
  actionId!: string;

  @ApiProperty({ example: 'motion-03' })
  @IsString()
  motionId!: string;

  @ApiProperty({ type: [ReferenceEvidenceDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReferenceEvidenceDto)
  references!: ReferenceEvidenceDto[];

  @ApiPropertyOptional({ example: 'reference-take-02' })
  @IsOptional()
  @IsString()
  selectedReferenceId?: string;

  @ApiProperty({ type: EvidenceWindowDto })
  @ValidateNested()
  @Type(() => EvidenceWindowDto)
  practice!: EvidenceWindowDto;

  @ApiProperty({ type: [MeasurementDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => MeasurementDto)
  measurements!: MeasurementDto[];

  @ApiProperty({ type: VisionQualityDto })
  @ValidateNested()
  @Type(() => VisionQualityDto)
  quality!: VisionQualityDto;

  @ApiProperty({ type: CompletionDto })
  @ValidateNested()
  @Type(() => CompletionDto)
  completion!: CompletionDto;

  @ApiPropertyOptional({ type: ComparisonContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ComparisonContextDto)
  context?: ComparisonContextDto;
}
