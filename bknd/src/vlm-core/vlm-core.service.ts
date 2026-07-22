import { Inject, Injectable } from '@nestjs/common';
import type { VlmAbstainReason } from './contracts/issue-code.types';
import type {
  MotionTemplatePack,
  RealtimeJudgeInput,
  RealtimeJudgeResult,
  TemplateRegistrationResult,
} from './contracts/realtime-judge.types';
import type {
  TeachingDecision,
  TeachingDecisionCode,
  VlmHealthStatus,
} from './contracts/teaching.types';
import type {
  VlmComparisonInput,
  VlmReferenceEvidence,
} from './contracts/vision.types';
import type {
  VlmAnalysisResult,
  VlmCorrection,
  VlmFrameInput,
} from './contracts/vlm.types';
import { VLM_PROVIDER } from './providers/vlm-provider.token';
import type { VlmProvider } from './providers/vlm-provider.interface';
import { VLM_PROMPT_VERSION } from './prompts/system.prompt';
import { GeometryRuleEngine } from './rules/geometry-rule.engine';
import { VLM_RULE_CONFIG, VLM_RULE_VERSION } from './rules/rule-config';
import { SkeletonTemplateMatcherEngine } from './rules/skeleton-template-matcher.engine';
import { TEMPLATE_MATCHER_VERSION } from './rules/template-matcher.config';
import type { VlmRuleCandidate } from './rules/rule.types';
import { MotionTemplateRegistry } from './templates/motion-template.registry';
import { ComparisonInputValidator } from './validation/comparison-input.validator';
import { RealtimeJudgeValidator } from './validation/realtime-judge.validator';

@Injectable()
export class VlmCoreService {
  constructor(
    @Inject(VLM_PROVIDER) private readonly provider: VlmProvider,
    private readonly ruleEngine: GeometryRuleEngine,
    private readonly inputValidator: ComparisonInputValidator,
    private readonly templateMatcher: SkeletonTemplateMatcherEngine,
    private readonly templateRegistry: MotionTemplateRegistry,
    private readonly realtimeValidator: RealtimeJudgeValidator,
  ) {}

  getHealth(): VlmHealthStatus {
    return {
      status: 'ready',
      realtimeMode: 'local-skeleton-template',
      cloudRequiredForRealtime: false,
      registeredMotionPacks: this.templateRegistry.count(),
      provider: this.provider.name,
      cloudEnhancementConfigured:
        this.provider.name !== 'mock' && this.provider.configured,
      schemaVersion: 'vision-output-v0',
      realtimeSchemaVersion: 'realtime-judge-v1',
      promptVersion: VLM_PROMPT_VERSION,
      ruleVersion: VLM_RULE_VERSION,
      templateMatcherVersion: TEMPLATE_MATCHER_VERSION,
    };
  }

  registerMotionTemplate(pack: MotionTemplatePack): TemplateRegistrationResult {
    this.realtimeValidator.validateTemplatePack(pack);
    return this.templateRegistry.register(pack);
  }

  judgeRealtime(input: RealtimeJudgeInput): RealtimeJudgeResult {
    this.realtimeValidator.validateJudgeInput(input);
    const pack = this.templateRegistry.get(input.danceId, input.motionId);
    return this.templateMatcher.evaluate(pack, input);
  }

  /**
   * Backward-compatible measurement route. It is now fully local and never
   * calls the cloud provider. New integrations should use judgeRealtime.
   */
  analyzeComparison(input: VlmComparisonInput): TeachingDecision {
    this.inputValidator.validate(input);
    const startedAt = Date.now();

    if (
      input.completion.status === 'partial' ||
      input.completion.status === 'paused'
    ) {
      return this.partialAttemptDecision(input, startedAt);
    }

    const ruleEvaluation = this.ruleEngine.evaluate(input);
    if (ruleEvaluation.abstained && ruleEvaluation.abstainReason) {
      return this.abstainDecision(
        input,
        ruleEvaluation.abstainReason,
        startedAt,
      );
    }

    if (ruleEvaluation.candidates.length === 0) {
      const analysis = this.baseAnalysis(
        input.sampleId,
        '动作与参考示范基本一致，可以继续下一个动作。',
        [],
        false,
        startedAt,
      );
      return this.makeDecision(
        input,
        'ACCEPT',
        '很好，这个动作已经完成，我们进入下一个动作。',
        analysis,
        0.95,
        undefined,
        { pause: false },
      );
    }

    const corrections = this.ruleCorrections(ruleEvaluation.candidates);
    const focusCorrection = corrections[0];
    const focusCandidate = focusCorrection
      ? ruleEvaluation.candidates.find(
          (candidate) =>
            candidate.issueCode === focusCorrection.issueCode &&
            candidate.bodyPart === focusCorrection.bodyPart,
        )
      : undefined;
    const analysis = this.baseAnalysis(
      input.sampleId,
      '已根据本地姿态、手势和时序规则完成实时判别；本次没有调用云端。',
      corrections,
      false,
      startedAt,
    );

    if (
      focusCorrection &&
      focusCandidate?.autoPauseEligible &&
      focusCorrection.confidence >= 0.9
    ) {
      return this.makeDecision(
        input,
        'RETRY_CURRENT',
        focusCorrection.instruction,
        analysis,
        focusCorrection.confidence,
        focusCorrection,
        {
          pause: true,
          seekToMotionId: input.motionId,
          playbackRate: 0.7,
        },
      );
    }

    return this.makeDecision(
      input,
      'ACCEPT_HINT',
      focusCorrection
        ? `${focusCorrection.instruction} 这次先继续，下一个动作注意调整。`
        : '动作基本完成，我们继续。',
      analysis,
      focusCorrection?.confidence ?? 0.65,
      focusCorrection,
      { pause: false },
    );
  }

  analyzeFrame(input: VlmFrameInput): VlmAnalysisResult {
    const reference: VlmReferenceEvidence = {
      referenceId: 'legacy-reference',
      videoId: 'legacy-reference',
      startMs: input.timestampMs ?? 0,
      peakMs: input.timestampMs ?? 0,
      endMs: input.timestampMs ?? 0,
      frameUrls: input.referenceFrameUrl
        ? [input.referenceFrameUrl]
        : [input.practiceFrameUrl],
    };

    const decision = this.analyzeComparison({
      schemaVersion: 'vision-output-v0',
      sessionId: 'legacy-session',
      sampleId: `legacy-${Date.now()}`,
      actionId: 'legacy-action',
      motionId: 'legacy-motion',
      references: [reference],
      selectedReferenceId: reference.referenceId,
      practice: {
        videoId: 'legacy-practice',
        startMs: input.timestampMs ?? 0,
        peakMs: input.timestampMs ?? 0,
        endMs: input.timestampMs ?? 0,
        frameUrls: [input.practiceFrameUrl],
      },
      measurements: [],
      quality: {
        alignmentConfidence: 1,
        bodyVisibility: 1,
        visibleBodyParts: [],
        occludedBodyParts: [],
        mirrored: false,
      },
      completion: { status: 'completed' },
      context: { actionName: input.actionLabel },
    });

    return decision.analysis;
  }

  private partialAttemptDecision(
    input: VlmComparisonInput,
    startedAt: number,
  ): TeachingDecision {
    const correction: VlmCorrection = {
      issueCode: 'PARTIAL_ATTEMPT',
      severity: 'low',
      instruction: '刚才的动作没有完整完成，我们从当前动作开始再试一次。',
      evidence: [],
      confidence: 1,
      source: 'geometry',
    };
    const analysis = this.baseAnalysis(
      input.sampleId,
      '本次动作中途暂停，只评价已经观察到的部分。',
      [correction],
      false,
      startedAt,
    );

    return this.makeDecision(
      input,
      'RETRY_CURRENT',
      correction.instruction,
      analysis,
      1,
      correction,
      {
        pause: true,
        seekToMotionId: input.motionId,
        playbackRate: 0.7,
      },
    );
  }

  private abstainDecision(
    input: VlmComparisonInput,
    reason: VlmAbstainReason,
    startedAt: number,
  ): TeachingDecision {
    const speech =
      reason === 'FRAME_ALIGNMENT_UNCERTAIN'
        ? '还不能可靠对齐这个动作，请回到准备姿势再做一次。'
        : '目前看不清关键动作，请调整距离，确保上半身和双手完整出现在画面中。';
    const analysis = this.baseAnalysis(
      input.sampleId,
      speech,
      [],
      true,
      startedAt,
      reason,
    );

    return this.makeDecision(
      input,
      'NOT_VISIBLE',
      speech,
      analysis,
      1,
      undefined,
      { pause: false },
    );
  }

  private ruleCorrections(candidates: VlmRuleCandidate[]): VlmCorrection[] {
    return candidates
      .slice(0, VLM_RULE_CONFIG.maximumCorrections)
      .map((candidate) => ({
        issueCode: candidate.issueCode,
        bodyPart: candidate.bodyPart,
        severity: candidate.severity,
        instruction: candidate.instruction,
        evidence: candidate.evidence,
        confidence: candidate.confidence,
        source: 'geometry',
      }));
  }

  private baseAnalysis(
    sampleId: string,
    summary: string,
    corrections: VlmCorrection[],
    abstained: boolean,
    startedAt: number,
    abstainReason?: VlmAbstainReason,
  ): VlmAnalysisResult {
    return {
      schemaVersion: 'vlm-output-v0',
      sampleId,
      summary,
      corrections,
      abstained,
      abstainReason,
      metadata: {
        provider: 'local',
        model: 'geometry-rules',
        promptVersion: 'not-called',
        ruleVersion: VLM_RULE_VERSION,
        latencyMs: Date.now() - startedAt,
        degraded: false,
      },
    };
  }

  private makeDecision(
    input: VlmComparisonInput,
    decision: TeachingDecisionCode,
    speech: string,
    analysis: VlmAnalysisResult,
    confidence: number,
    focusCorrection?: VlmCorrection,
    controlSuggestion?: TeachingDecision['controlSuggestion'],
  ): TeachingDecision {
    return {
      schemaVersion: 'teaching-decision-v0',
      sessionId: input.sessionId,
      sampleId: input.sampleId,
      actionId: input.actionId,
      motionId: input.motionId,
      decision,
      speech,
      focusCorrection,
      controlSuggestion,
      confidence: Math.min(1, Math.max(0, confidence)),
      analysis,
    };
  }
}
