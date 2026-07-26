import { BadGatewayException, ServiceUnavailableException } from '@nestjs/common';
import { WhisperTranscriptionService } from './whisper-transcription.service';

describe('WhisperTranscriptionService', () => {
  const originalEnvironment = {
    key: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_TRANSCRIPTION_MODEL,
    url: process.env.OPENAI_AUDIO_TRANSCRIPTION_URL,
    prompt: process.env.OPENAI_TRANSCRIPTION_PROMPT,
    provider: process.env.VOICE_TRANSCRIPTION_PROVIDER,
    localUrl: process.env.LOCAL_WHISPER_URL,
  };

  afterEach(() => {
    jest.restoreAllMocks();
    restore('OPENAI_API_KEY', originalEnvironment.key);
    restore('OPENAI_TRANSCRIPTION_MODEL', originalEnvironment.model);
    restore('OPENAI_AUDIO_TRANSCRIPTION_URL', originalEnvironment.url);
    restore('OPENAI_TRANSCRIPTION_PROMPT', originalEnvironment.prompt);
    restore('VOICE_TRANSCRIPTION_PROVIDER', originalEnvironment.provider);
    restore('LOCAL_WHISPER_URL', originalEnvironment.localUrl);
  });

  it('uploads browser audio to the Whisper transcription endpoint', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.VOICE_TRANSCRIPTION_PROVIDER = 'openai';
    process.env.OPENAI_TRANSCRIPTION_MODEL = 'whisper-1';
    process.env.OPENAI_AUDIO_TRANSCRIPTION_URL =
      'https://api.openai.test/v1/audio/transcriptions';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: '显示骨架' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const result = await new WhisperTranscriptionService().transcribe({
      buffer: Buffer.from('webm-audio'),
      mimetype: 'audio/webm',
      originalname: 'command.webm',
      size: 10,
    });

    expect(result).toEqual({ text: '显示骨架', model: 'whisper-1' });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.test/v1/audio/transcriptions',
      expect.objectContaining({
        method: 'POST',
        headers: { Authorization: 'Bearer test-openai-key' },
        body: expect.any(FormData),
      }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const form = request.body as FormData;
    expect(form.get('prompt')).toContain('显示骨架');
    expect(form.get('prompt')).toContain('关闭骨架');
  });

  it('allows a project vocabulary prompt to override the default terms', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.VOICE_TRANSCRIPTION_PROVIDER = 'openai';
    process.env.OPENAI_TRANSCRIPTION_PROMPT = 'Lumi，准备，第一拍，第二拍，收势。';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ text: '第一拍' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    await new WhisperTranscriptionService().transcribe({
      buffer: Buffer.from('webm-audio'),
      mimetype: 'audio/webm',
      originalname: 'command.webm',
      size: 10,
    });

    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect((request.body as FormData).get('prompt')).toBe(
      'Lumi，准备，第一拍，第二拍，收势。',
    );
  });

  it('fails clearly when the OpenAI API key is missing', async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.VOICE_TRANSCRIPTION_PROVIDER = 'openai';

    await expect(
      new WhisperTranscriptionService().transcribe({
        buffer: Buffer.from('audio'),
        mimetype: 'audio/webm',
        originalname: 'command.webm',
        size: 5,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('maps an upstream error to a stable backend error', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key';
    process.env.VOICE_TRANSCRIPTION_PROVIDER = 'openai';
    jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('unauthorized', { status: 401 }),
    );

    await expect(
      new WhisperTranscriptionService().transcribe({
        buffer: Buffer.from('audio'),
        mimetype: 'audio/webm',
        originalname: 'command.webm',
        size: 5,
      }),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });

  it('sends audio and preferred terms to the local Whisper worker', async () => {
    process.env.VOICE_TRANSCRIPTION_PROVIDER = 'local';
    process.env.LOCAL_WHISPER_URL = 'http://127.0.0.1:8765/transcribe';
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ text: '关闭骨架', model: 'local/small' }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      ),
    );

    const result = await new WhisperTranscriptionService().transcribe({
      buffer: Buffer.from('webm-audio'),
      mimetype: 'audio/webm',
      originalname: 'command.webm',
      size: 10,
    });

    expect(result).toEqual({ text: '关闭骨架', model: 'local/small' });
    const [url, request] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe('http://127.0.0.1:8765/transcribe');
    const form = request.body as FormData;
    expect(form.get('language')).toBe('zh');
    expect(form.get('initial_prompt')).toContain('显示骨架');
    expect(form.get('hotwords')).toBeNull();
  });
});

function restore(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}
