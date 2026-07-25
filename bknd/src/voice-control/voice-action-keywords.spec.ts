import { VOICE_COMMAND_KEYWORDS } from './voice-command-keywords';
import { VoiceControlService } from './voice-control.service';

describe('action navigation keyword library', () => {
  const service = new VoiceControlService();
  const actionIntents = [
    'PREVIOUS_ACTION',
    'REPEAT_ACTION',
    'NEXT_ACTION',
    'RESTART_LESSON',
  ] as const;

  it.each(
    actionIntents.flatMap((intent) =>
      VOICE_COMMAND_KEYWORDS[intent].map((phrase) => [intent, phrase] as const),
    ),
  )('maps %s phrase: %s', (intent, phrase) => {
    const result = service.interpret(phrase);
    expect(result.data.accepted).toBe(true);
    expect(result.data.command.intent).toBe(intent);
  });
});
