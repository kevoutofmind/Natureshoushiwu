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
      parameters: { playbackRate: 0.5 },
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

  it('returns actionable coaching for a complex dance question', async () => {
    process.env.KIMI_API_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: 'COACH_QUESTION',
                  confidence: 0.93,
                  seconds: null,
                  playbackRate: null,
                  responseText:
                    '先固定肩膀，只练左右手的先后顺序；熟练后再配合节奏。',
                }),
              },
            },
          ],
        }),
    } as Response);

    const result = await new KimiVoiceCommandRouterService().interpret(
      '为什么我左右手总是配合不好',
      '为什么我左右手总是配合不好',
    );

    expect(result?.data).toMatchObject({
      accepted: true,
      label: 'AI 教练答疑',
      command: { intent: 'COACH_QUESTION' },
    });
  });

  it('keeps a safe companion response when no command intent is needed', async () => {
    process.env.KIMI_API_KEY = 'test-key';
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  intent: null,
                  confidence: 0.94,
                  seconds: null,
                  playbackRate: null,
                  responseText: '紧张很正常，先深呼吸一下，我们按你的节奏慢慢来。',
                }),
              },
            },
          ],
        }),
    } as Response);

    const result = await new KimiVoiceCommandRouterService().interpret(
      '我有点紧张，陪我聊两句',
      '我有点紧张陪我聊两句',
    );

    expect(result?.data).toMatchObject({
      accepted: false,
      label: 'Lumi 陪伴回应',
      responseText: '紧张很正常，先深呼吸一下，我们按你的节奏慢慢来。',
      command: { intent: null },
    });
  });
});
