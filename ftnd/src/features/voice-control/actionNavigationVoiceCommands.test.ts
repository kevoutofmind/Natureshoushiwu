import { describe, expect, it } from 'vitest';
import {
  ACTION_NAVIGATION_VOICE_COMMANDS,
  extractImmediateVoiceCommand,
} from './immediateVoiceCommands';

describe('action navigation voice commands', () => {
  it.each(
    Object.entries(ACTION_NAVIGATION_VOICE_COMMANDS).flatMap(
      ([intent, phrases]) => phrases.map((phrase) => [intent, phrase] as const),
    ),
  )('extracts every %s phrase: %s', (_intent, phrase) => {
    expect(extractImmediateVoiceCommand(`Lumi，${phrase}吧`)).toBe(phrase);
  });
});
