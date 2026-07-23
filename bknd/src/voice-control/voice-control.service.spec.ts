import { VoiceControlService } from './voice-control.service';

describe('VoiceControlService', () => {
  const service = new VoiceControlService();

  it.each([
    ['暂停', 'PAUSE'],
    ['继续播放', 'RESUME'],
    ['我已经准备好了，直接开始练习吧', 'READY'],
    ['太快了，慢一点', 'SLOW_DOWN'],
    ['快一点', 'SPEED_UP'],
    ['重新播放', 'RESTART'],
    ['倒退到上个动作', 'PREVIOUS_ACTION'],
    ['这个动作重新做一遍', 'REPEAT_ACTION'],
    ['进入下一个动作', 'NEXT_ACTION'],
    ['从头开始教学', 'RESTART_LESSON'],
    ['开始录制', 'START_RECORDING'],
    ['停止录制', 'STOP_RECORDING'],
    ['刚才这个动作我没看清，能不能再教我一次', 'REPEAT_ACTION'],
    ['这个我已经会了，我们继续往下学吧', 'NEXT_ACTION'],
    ['我有点跟不上，先等我一下', 'PAUSE'],
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
    const result = service.interpret('今天天气怎么样');

    expect(result.data.accepted).toBe(false);
    expect(result.data.command.intent).toBeNull();
  });

  it('leaves an ambiguous multi-part request for the cloud semantic router', () => {
    const result = service.interpret(
      '老师我脑子有点乱，能不能把节奏放缓后回到前面的内容陪我重新梳理',
    );

    expect(result.data.accepted).toBe(false);
    expect(result.data.command.intent).toBeNull();
  });

  it('does not treat “重新梳理” as restarting playback', () => {
    const result = service.interpret('帮我重新梳理刚才的内容');

    expect(result.data.accepted).toBe(false);
    expect(result.data.command.intent).toBeNull();
  });
});
