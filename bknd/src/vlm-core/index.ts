export { VlmCoreModule } from './vlm-core.module';
export { VlmCoreService } from './vlm-core.service';
export { ReferenceDatasetService } from './datasets/reference-dataset.service';
export type {
  ReferenceDanceDataset,
  ReferenceDatasetRegistrationResult,
  ReferenceDatasetSummary,
} from './contracts/reference-dataset.types';
export { TeachingAgentService } from './agent/teaching-agent.service';
export { LessonPlanRegistry } from './agent/lesson-plan.registry';
export { PromptCatalogService } from './prompts/prompt-catalog.service';
export { ManagedPromptExecutorService } from './prompts/managed-prompt-executor.service';
export { GeometryRuleEngine } from './rules/geometry-rule.engine';
export { SkeletonTemplateMatcherEngine } from './rules/skeleton-template-matcher.engine';
export { MotionTemplateRegistry } from './templates/motion-template.registry';
export { VLM_PROVIDER } from './providers/vlm-provider.token';
export { createVlmProvider } from './providers/provider.factory';
export {
  VLM_ABSTAIN_REASONS,
  VLM_ISSUE_CODES,
} from './contracts/issue-code.types';
export { VLM_PROMPT_VERSION, VLM_SYSTEM_PROMPT } from './prompts/system.prompt';
export { VLM_RULE_CONFIG, VLM_RULE_VERSION } from './rules/rule-config';
export {
  TEMPLATE_MATCHER_CONFIG,
  TEMPLATE_MATCHER_VERSION,
} from './rules/template-matcher.config';

export type {
  VlmAbstainReason,
  VlmIssueCode,
  VlmSeverity,
} from './contracts/issue-code.types';
export type {
  ManagedPromptDefinition,
  ManagedPromptExecutionInput,
  ManagedPromptExecutionResult,
  PromptCatalogItem,
  PromptModelPolicy,
  PromptReference,
  RenderedManagedPrompt,
  TeachingPromptId,
} from './contracts/prompt-management.types';
export type {
  TeachingAgentCommand,
  TeachingAgentEvent,
  TeachingAgentPhase,
  TeachingAgentSession,
  TeachingAgentStartInput,
  TeachingAgentToolName,
  TeachingAgentTrace,
  TeachingAgentTurnResult,
  TeachingLessonPlan,
  TeachingLessonPolicy,
  TeachingLessonRegistrationResult,
  TeachingMotionPlan,
  TeachingMotionProgress,
  TeachingVoiceCommand,
} from './contracts/teaching-agent.types';
export type {
  MotionReferenceTemplate,
  MotionTemplatePack,
  PracticeSkeletonObservation,
  RealtimeDecisionCode,
  RealtimeDecisionReason,
  RealtimeEvaluationPolicy,
  RealtimeJudgeInput,
  RealtimeJudgeResult,
  RealtimeScoreBreakdown,
  RequiredSkeletonPart,
  SkeletonFrame,
  SkeletonLandmark,
  TemplateRegistrationResult,
} from './contracts/realtime-judge.types';
export type {
  TeachingControlSuggestion,
  TeachingDecision,
  TeachingDecisionCode,
  VlmHealthStatus,
} from './contracts/teaching.types';
export type {
  VlmComparisonContext,
  VlmComparisonInput,
  VlmCompletion,
  VlmCompletionStatus,
  VlmEvidenceWindow,
  VlmMeasurement,
  VlmMeasurementUnit,
  VlmReferenceEvidence,
  VlmVisionQuality,
} from './contracts/vision.types';
export type {
  VlmAnalysisMetadata,
  VlmAnalysisResult,
  VlmCorrection,
  VlmCorrectionEvidence,
  VlmFrameInput,
} from './contracts/vlm.types';
export type {
  VlmManagedPromptResult,
  VlmProvider,
  VlmProviderCorrection,
  VlmProviderResult,
} from './providers/vlm-provider.interface';
export type { VlmRuleCandidate, VlmRuleEvaluation } from './rules/rule.types';
