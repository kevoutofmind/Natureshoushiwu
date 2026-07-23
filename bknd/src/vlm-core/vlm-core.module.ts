import { Module } from '@nestjs/common';
import { LessonPlanRegistry } from './agent/lesson-plan.registry';
import { TeachingAgentController } from './agent/teaching-agent.controller';
import { TeachingAgentService } from './agent/teaching-agent.service';
import { TeachingAgentSessionStore } from './agent/teaching-agent-session.store';
import { TeachingAgentTools } from './agent/teaching-agent.tools';
import { TeachingAgentValidator } from './agent/teaching-agent.validator';
import { PromptCatalogService } from './prompts/prompt-catalog.service';
import { ManagedPromptExecutorService } from './prompts/managed-prompt-executor.service';
import { createVlmProvider } from './providers/provider.factory';
import { VLM_PROVIDER } from './providers/vlm-provider.token';
import { GeometryRuleEngine } from './rules/geometry-rule.engine';
import { SkeletonTemplateMatcherEngine } from './rules/skeleton-template-matcher.engine';
import { MotionTemplateRegistry } from './templates/motion-template.registry';
import { ComparisonInputValidator } from './validation/comparison-input.validator';
import { RealtimeJudgeValidator } from './validation/realtime-judge.validator';
import { VlmCoreController } from './vlm-core.controller';
import { VlmCoreService } from './vlm-core.service';
import { ReferenceDatasetService } from './datasets/reference-dataset.service';

@Module({
  controllers: [VlmCoreController, TeachingAgentController],
  providers: [
    GeometryRuleEngine,
    SkeletonTemplateMatcherEngine,
    MotionTemplateRegistry,
    ComparisonInputValidator,
    RealtimeJudgeValidator,
    LessonPlanRegistry,
    TeachingAgentSessionStore,
    TeachingAgentTools,
    TeachingAgentValidator,
    PromptCatalogService,
    ManagedPromptExecutorService,
    {
      provide: VLM_PROVIDER,
      useFactory: createVlmProvider,
    },
    VlmCoreService,
    TeachingAgentService,
    ReferenceDatasetService,
  ],
  exports: [
    VlmCoreService,
    GeometryRuleEngine,
    SkeletonTemplateMatcherEngine,
    MotionTemplateRegistry,
    TeachingAgentService,
    LessonPlanRegistry,
    PromptCatalogService,
    ManagedPromptExecutorService,
    VLM_PROVIDER,
    ReferenceDatasetService,
  ],
})
export class VlmCoreModule {}
