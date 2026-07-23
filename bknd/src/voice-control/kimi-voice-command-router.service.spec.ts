import { KimiVoiceCommandRouterService } from './kimi-voice-command-router.service';

describe('KimiVoiceCommandRouterService', () => {
  const originalApiKey = process.env.KIMI_API_KEY;

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalApiKey === undefined) delete process.env.KIMI_API_KEY;
    else process.env.KIMI_API_KEY = originalApiKey;
  });

  it('converts an ambiguous multi-part request into a guarded command', async () => {
    process.env.KIMI_API_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: 'PREVIOUS_ACTION',
                  confidence: 0.91,
                  seconds: null,
                  playbackRate: 0.6,
                  responseText: '好，我们回到刚才的动作，放慢一点再学。',
                }),
              },
            },
          ],
        }),
    } as Response);

    const result = await new KimiVoiceCommandRouterService().interpret(
      '刚才那个动作我没学会，能回去慢一点再教我吗',
      '刚才那个动作我没学会能回去慢一点再教我吗',
    );

    expect(result?.data.command).toMatchObject({
      intent: 'PREVIOUS_ACTION',
      parameters: { playbackRate: 0.6 },
    });
  });

  it('rejects an intent outside the Agent allowlist', async () => {
    process.env.KIMI_API_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: 'DELETE_LESSON',
                  confidence: 0.99,
                  responseText: '删除课程',
                }),
              },
            },
          ],
        }),
    } as Response);

    const result = await new KimiVoiceCommandRouterService().interpret(
      '删除课程',
      '删除课程',
    );
    expect(result).toBeNull();
  });
});
