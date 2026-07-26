export interface LumiWakeMatch {
  detected: boolean;
  commandText: string;
}

export type LumiWakeDecision =
  | { type: "standby" }
  | { type: "wake" }
  | { type: "command"; commandText: string };

const LUMI_WAKE_PATTERNS = [
  /\blumi\b/iu,
  /露米/u,
  /鲁米/u,
  /路米/u,
  /卢米/u,
];

export function extractLumiWakeCommand(transcript: string): LumiWakeMatch {
  for (const pattern of LUMI_WAKE_PATTERNS) {
    const match = pattern.exec(transcript);
    if (!match || match.index === undefined) continue;

    const commandText = cleanCommandText(
      `${transcript.slice(0, match.index)} ${transcript.slice(
        match.index + match[0].length,
      )}`,
    );
    return { detected: true, commandText };
  }

  return { detected: false, commandText: transcript.trim() };
}

export function resolveLumiWakeTurn(
  transcript: string,
  isAwake: boolean,
): LumiWakeDecision {
  const match = extractLumiWakeCommand(transcript);
  if (!isAwake && !match.detected) return { type: "standby" };

  const commandText = match.detected ? match.commandText : transcript.trim();
  if (!commandText) return { type: "wake" };
  return { type: "command", commandText };
}

function cleanCommandText(text: string): string {
  return text
    .replace(/^[\s，。！？、,.!?：:；;]+/u, "")
    .replace(/[\s，。！？、,.!?：:；;]+$/u, "")
    .trim();
}
