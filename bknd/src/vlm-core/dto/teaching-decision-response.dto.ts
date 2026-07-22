import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  TeachingDecision,
  TeachingDecisionCode,
} from '../contracts/teaching.types';
import type { VlmAnalysisResult, VlmCorrection } from '../contracts/vlm.types';

export class TeachingDecisionResponseDto implements TeachingDecision {
  @ApiProperty({ example: 'teaching-decision-v0' })
  schemaVersion!: 'teaching-decision-v0';

  @ApiProperty({ example: 'session-001' })
  sessionId!: string;

  @ApiProperty({ example: 'sample-001' })
  sampleId!: string;

  @ApiProperty({ example: 'dance-001' })
  actionId!: string;

  @ApiProperty({ example: 'motion-03' })
  motionId!: string;

  @ApiProperty({
    enum: [
      'ACCEPT',
      'ACCEPT_HINT',
      'KEEP_WATCHING',
      'NOT_VISIBLE',
      'RETRY_CURRENT',
      'PROCEED_NEXT',
      'ADJUST_CAMERA',
      'SHOW_SLOW_DEMO',
      'START_FULL_CHALLENGE',
    ],
  })
  decision!: TeachingDecisionCode;

  @ApiProperty({ example: '右手再抬高一点，对齐参考位置。' })
  speech!: string;

  @ApiPropertyOptional({ type: Object })
  focusCorrection?: VlmCorrection;

  @ApiPropertyOptional({
    example: {
      pause: true,
      seekToMotionId: 'motion-03',
      playbackRate: 0.6,
    },
  })
  controlSuggestion?: TeachingDecision['controlSuggestion'];

  @ApiProperty({ example: 0.93 })
  confidence!: number;

  @ApiProperty({ type: Object })
  analysis!: VlmAnalysisResult;
}
