# Voice Control Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show recognized speech text in the voice control panel and emit correlated browser-console diagnostics for recognition, command matching, and video/runtime execution.

**Architecture:** A small voice diagnostics module owns correlation IDs, structured console output, and direct video-speed execution. `VoiceControlPanel` creates one ID per final transcript and passes an envelope containing the ID and interpreted result to `useTeachingRuntime`, which logs either the direct video result or the asynchronous teaching-runtime result.

**Tech Stack:** Next.js 16, React 19, TypeScript, Material UI 6, Vitest

## Global Constraints

- Only recognized text is visible in the teaching interface.
- Keyword matching and execution diagnostics are written to the browser developer console.
- Console labels use the `[Voice]` prefix.
- The backend voice response contract is unchanged.
- Existing uncommitted inline voice-control work is preserved.

---

### Task 1: Structured Voice Diagnostics

**Files:**
- Create: `ftnd/src/features/voice-control/voiceDiagnostics.ts`
- Create: `ftnd/src/features/voice-control/voiceDiagnostics.test.ts`
- Modify: `ftnd/package.json`
- Modify: `ftnd/package-lock.json`

**Interfaces:**
- Produces: `createVoiceDiagnosticId(): string`
- Produces: `writeVoiceDiagnostic(stage, diagnosticId, details, sink?): void`
- Produces: `applyDirectVideoVoiceCommand(result, video): VoiceExecutionOutcome | null`

- [ ] **Step 1: Install the test runner**

Run:

```powershell
npm install --save-dev vitest
```

Expected: `vitest` appears in `devDependencies` and the lockfile is updated.

- [ ] **Step 2: Add the test script**

Add to `ftnd/package.json`:

```json
"test": "vitest run"
```

- [ ] **Step 3: Write failing diagnostics tests**

Create `ftnd/src/features/voice-control/voiceDiagnostics.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { VoiceCommandResult } from "./types";
import {
  applyDirectVideoVoiceCommand,
  createVoiceDiagnosticId,
  writeVoiceDiagnostic,
} from "./voiceDiagnostics";

const result = (
  intent: VoiceCommandResult["command"]["intent"],
  playbackRate?: number,
): VoiceCommandResult => ({
  accepted: true,
  command: {
    transcript: "慢一点",
    normalizedTranscript: "慢一点",
    intent,
    confidence: 0.96,
    parameters: playbackRate === undefined ? {} : { playbackRate },
  },
  label: "慢一点",
  responseText: "已识别",
  executionStatus: "not-dispatched",
});

describe("voice diagnostics", () => {
  it("creates distinct correlation IDs", () => {
    expect(createVoiceDiagnosticId()).not.toBe(createVoiceDiagnosticId());
  });

  it("writes a structured stage label and correlated payload", () => {
    const entries: unknown[][] = [];
    writeVoiceDiagnostic("matched", "voice-7", { accepted: false }, (...args) => {
      entries.push(args);
    });

    expect(entries).toEqual([
      ["[Voice] matched", { diagnosticId: "voice-7", accepted: false }],
    ]);
  });

  it("applies and reports a slow-down command", () => {
    const video = { playbackRate: 1 };
    expect(applyDirectVideoVoiceCommand(result("SLOW_DOWN"), video)).toEqual({
      status: "completed",
      target: "video",
      intent: "SLOW_DOWN",
      playbackRate: 0.5,
    });
    expect(video.playbackRate).toBe(0.5);
  });

  it("returns null for commands handled by the teaching runtime", () => {
    expect(
      applyDirectVideoVoiceCommand(result("PAUSE"), { playbackRate: 1 }),
    ).toBeNull();
  });
});
```

- [ ] **Step 4: Run tests and verify RED**

Run:

```powershell
npm test -- voiceDiagnostics.test.ts
```

Expected: FAIL because `./voiceDiagnostics` does not exist.

- [ ] **Step 5: Implement the diagnostics module**

Create `ftnd/src/features/voice-control/voiceDiagnostics.ts`:

```ts
import type { VoiceCommandResult } from "./types";

export type VoiceDiagnosticStage =
  | "recognized"
  | "matched"
  | "match-error"
  | "executed";

export interface VoiceExecutionOutcome {
  status: "completed" | "failed";
  target: "video" | "teaching-runtime";
  intent: string;
  playbackRate?: number;
  command?: string;
  reason?: string;
}

type DiagnosticSink = (label: string, payload: Record<string, unknown>) => void;
type VideoPlaybackTarget = Pick<HTMLVideoElement, "playbackRate">;

let diagnosticSequence = 0;

export function createVoiceDiagnosticId(): string {
  diagnosticSequence += 1;
  return `voice-${Date.now()}-${diagnosticSequence}`;
}

export function writeVoiceDiagnostic(
  stage: VoiceDiagnosticStage,
  diagnosticId: string,
  details: Record<string, unknown>,
  sink: DiagnosticSink = console.debug,
): void {
  sink(`[Voice] ${stage}`, { diagnosticId, ...details });
}

export function applyDirectVideoVoiceCommand(
  result: VoiceCommandResult,
  video: VideoPlaybackTarget | null,
): VoiceExecutionOutcome | null {
  const intent = result.command.intent;
  if (
    intent !== "SLOW_DOWN" &&
    intent !== "SPEED_UP" &&
    intent !== "SET_PLAYBACK_RATE"
  ) {
    return null;
  }

  if (!video) {
    return {
      status: "failed",
      target: "video",
      intent,
      reason: "reference-video-unavailable",
    };
  }

  const playbackRate =
    intent === "SLOW_DOWN"
      ? 0.5
      : intent === "SPEED_UP"
        ? 1.25
        : Math.max(
            0.25,
            Math.min(2, result.command.parameters.playbackRate ?? 1),
          );
  video.playbackRate = playbackRate;

  return {
    status: "completed",
    target: "video",
    intent,
    playbackRate: video.playbackRate,
  };
}
```

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```powershell
npm test -- voiceDiagnostics.test.ts
```

Expected: 4 tests pass.

- [ ] **Step 7: Commit**

```powershell
git add ftnd/package.json ftnd/package-lock.json ftnd/src/features/voice-control/voiceDiagnostics.ts ftnd/src/features/voice-control/voiceDiagnostics.test.ts
git commit -m "test: add voice diagnostic primitives"
```

### Task 2: Recognition and Matching Diagnostics

**Files:**
- Modify: `ftnd/src/features/voice-control/types.ts`
- Modify: `ftnd/src/features/voice-control/components/VoiceControlPanel.tsx`

**Interfaces:**
- Consumes: `createVoiceDiagnosticId()` and `writeVoiceDiagnostic(...)`
- Produces: `VoiceCommandDiagnosticEnvelope`
- Produces: `onCommandRecognized(envelope: VoiceCommandDiagnosticEnvelope): void`

- [ ] **Step 1: Add the diagnostic envelope type**

Append to `ftnd/src/features/voice-control/types.ts`:

```ts
export interface VoiceCommandDiagnosticEnvelope {
  diagnosticId: string;
  result: VoiceCommandResult;
}
```

- [ ] **Step 2: Add correlated panel diagnostics**

In `VoiceControlPanel.tsx`, change the callback prop to accept `VoiceCommandDiagnosticEnvelope`. At the start of `processTranscript`, create an ID and log:

```ts
const diagnosticId = createVoiceDiagnosticId();
writeVoiceDiagnostic("recognized", diagnosticId, {
  transcript: trimmedTranscript,
});
```

After `interpretVoiceCommand` succeeds, log and dispatch:

```ts
writeVoiceDiagnostic("matched", diagnosticId, {
  accepted: response.data.accepted,
  intent: response.data.command.intent,
  confidence: response.data.command.confidence,
  parameters: response.data.command.parameters,
});
onCommandRecognized?.({ diagnosticId, result: response.data });
```

In the catch block, log before setting the visible request error:

```ts
writeVoiceDiagnostic("match-error", diagnosticId, {
  message: reason instanceof Error ? reason.message : String(reason),
});
```

- [ ] **Step 3: Make the visible label explicit**

Keep the current interim/final text behavior and change its caption to:

```tsx
<Typography variant="caption" color="text.secondary">
  识别文字
</Typography>
```

The processing spinner remains separate, so the recognized text never disappears behind a processing label.

- [ ] **Step 4: Run focused tests and static checks**

Run:

```powershell
npm test -- voiceDiagnostics.test.ts
npm run lint
```

Expected: diagnostics tests pass; TypeScript/ESLint reports the teaching runtime callback mismatch until Task 3 is implemented.

### Task 3: Runtime Execution Diagnostics

**Files:**
- Modify: `ftnd/src/features/ai-teaching/hooks/useTeachingRuntime.ts`

**Interfaces:**
- Consumes: `VoiceCommandDiagnosticEnvelope`
- Consumes: `applyDirectVideoVoiceCommand(...)`
- Consumes: `writeVoiceDiagnostic(...)`
- Produces: correlated `[Voice] executed` log entries

- [ ] **Step 1: Accept the diagnostic envelope**

Change `handleVoiceResult` to receive:

```ts
(envelope: VoiceCommandDiagnosticEnvelope) => {
  const { diagnosticId, result } = envelope;
```

If the result is not accepted, log a skipped execution:

```ts
writeVoiceDiagnostic("executed", diagnosticId, {
  status: "skipped",
  reason: "command-not-matched",
});
```

- [ ] **Step 2: Log direct video execution**

Replace inline speed handling with:

```ts
const directOutcome = applyDirectVideoVoiceCommand(
  result,
  referenceVideoRef.current,
);
if (directOutcome) {
  writeVoiceDiagnostic("executed", diagnosticId, directOutcome);
  return;
}
```

- [ ] **Step 3: Return success from teaching-runtime dispatch**

Change `sendVoiceCommand` to return `true` after `executeTurn(...)` succeeds and `false` from its catch block.

- [ ] **Step 4: Log asynchronous teaching-runtime execution**

For mapped commands:

```ts
void sendVoiceCommand(agentCommand).then((succeeded) => {
  writeVoiceDiagnostic("executed", diagnosticId, {
    status: succeeded ? "completed" : "failed",
    target: "teaching-runtime",
    intent,
    command: agentCommand,
    videoPaused: referenceVideoRef.current?.paused,
    playbackRate: referenceVideoRef.current?.playbackRate,
  });
});
```

If an accepted intent has neither a direct-video handler nor an agent mapping, log:

```ts
writeVoiceDiagnostic("executed", diagnosticId, {
  status: "failed",
  intent,
  reason: "no-runtime-handler",
});
```

- [ ] **Step 5: Run all verification**

Run:

```powershell
npm test
npm run lint
npm run build
```

Expected: all diagnostics tests pass, ESLint exits 0, and the production build succeeds.

- [ ] **Step 6: Start the frontend and inspect the page**

Run:

```powershell
npm run dev
```

Open the teaching page, enable voice control, and say one matching phrase such as “慢一点” plus one unmatched phrase. Expected:

- The panel shows the recognized text.
- The console shows correlated `recognized`, `matched`, and `executed` entries for “慢一点”.
- The console shows `recognized`, `matched`, and a skipped `executed` entry for the unmatched phrase.

- [ ] **Step 7: Commit**

```powershell
git add ftnd/src/features/voice-control/types.ts ftnd/src/features/voice-control/components/VoiceControlPanel.tsx ftnd/src/features/ai-teaching/hooks/useTeachingRuntime.ts
git commit -m "feat: trace voice command execution"
```
