import { VoiceControlService } from './voice-control.service';

describe('VoiceControlService', () => {
  const service = new VoiceControlService();

  it.each([
    ['暂停', 'PAUSE'],
    ['继续播放', 'RESUME'],
    ['太快了，慢一点', 'SLOW_DOWN'],
    ['快一点', 'SPEED_UP'],
    ['重新播放', 'RESTART'],
    ['开始录制', 'START_RECORDING'],
    ['停止录制', 'STOP_RECORDING'],
  ])('recognizes "%s" as %s', (transcript, intent) => {
    const result = service.interpret(transcript);

    expect(result.data.accepted).toBe(true);
    expect(result.data.command.intent).toBe(intent);
  });

  it('extracts rewind seconds', () => {
    const result = service.interpret('倒回五秒');

    expect(result.data.command.intent).toBe('REWIND');
    expect(result.data.command.parameters.seconds).toBe(5);
  });

  it('extracts an explicit playback rate', () => {
    const result = service.interpret('调整到 0.5 倍');

    expect(result.data.command.intent).toBe('SET_PLAYBACK_RATE');
    expect(result.data.command.parameters.playbackRate).toBe(0.5);
  });

  it('returns a safe unknown result for unsupported instructions', () => {
    const result = service.interpret('帮我拆解这个动作');

    expect(result.data.accepted).toBe(false);
    expect(result.data.command.intent).toBeNull();
  });
});
