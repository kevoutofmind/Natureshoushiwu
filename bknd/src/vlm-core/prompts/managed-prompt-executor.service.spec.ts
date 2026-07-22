import { BadGatewayException } from '@nestjs/common';
import type {
  VlmManagedPromptResult,
  VlmProvider,
  VlmProviderResult,
} from '../providers/vlm-provider.interface';
import { MockVlmProvider } from '../providers/mock-vlm.provider';
import { PromptCatalogService } from './prompt-catalog.service';
import { ManagedPromptExecutorService } from './managed-prompt-executor.service';

describe('ManagedPromptExecutorService', () => {
  it('executes a versioned prompt and validates its structured output', async () => {
    const executor = new ManagedPromptExecutorService(
      new MockVlmProvider(),
      new PromptCatalogService(),
    );

    const result = await executor.execute({
      schemaVersion: 'managed-prompt-execution-v1',
      promptId: 'adaptive-motion-coaching',
      payload: { weakestPart: 'right_hand' },
    });

    expect(result.version).toBe('adaptive-motion-coaching-v1.0.0');
    expect(result.data).toMatchObject({
      strategy: 'SLOWER',
    });
  });

  it('rejects cloud output that attempts to control progression', async () => {
    class UnsafeProvider implements VlmProvider {
      readonly name = 'unsafe';
      readonly configured = true;

      analyzeComparison(): Promise<VlmProviderResult> {
        throw new Error('not used');
      }

      executeManagedPrompt(): Promise<VlmManagedPromptResult> {
        return Promise.resolve({
          model: 'unsafe-model',
          data: {
            speech: '通过',
            focusPart: 'pose',
            strategy: 'REPHRASE',
            control: {
              shouldAdvance: true,
            },
          },
        });
      }
    }

    const executor = new ManagedPromptExecutorService(
      new UnsafeProvider(),
      new PromptCatalogService(),
    );

    await expect(
      executor.execute({
        schemaVersion: 'managed-prompt-execution-v1',
        promptId: 'adaptive-motion-coaching',
        payload: {},
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
});
