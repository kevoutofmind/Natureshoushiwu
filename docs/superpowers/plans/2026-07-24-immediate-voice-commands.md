# Immediate Voice Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute every explicit short voice command as soon as it appears in an interim browser speech-recognition result.

**Architecture:** A pure matcher normalizes interim text and recognizes only complete short-command forms. The existing browser speech hook calls its current deduplicated dispatcher immediately for a match, while final results and natural-language requests continue through the unchanged path.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest

## Global Constraints

- Listening continues until the user clicks close.
- Only complete explicit short commands trigger from interim results.
- Natural language and incomplete phrases wait for a final transcript.
- The existing 2.5-second interim/final duplicate suppression remains active.
- Backend matching, API contracts, UI, and teaching runtime remain unchanged.

---

### Task 1: Immediate Short-Command Matcher

**Files:**
- Create: `ftnd/src/features/voice-control/immediateVoiceCommand.ts`
- Create: `ftnd/src/features/voice-control/immediateVoiceCommand.test.ts`
- Modify: `ftnd/src/features/voice-control/hooks/useBrowserSpeechRecognition.ts:128-135,216-221`
- Modify: `ftnd/package.json`
- Modify: `ftnd/package-lock.json`

**Interfaces:**
- Produces: `normalizeVoiceTranscript(transcript: string): string`
- Produces: `isImmediateVoiceCommand(transcript: string): boolean`
- Consumes: `isImmediateVoiceCommand(interim)` inside `useBrowserSpeechRecognition`

- [ ] **Step 1: Install Vitest and add the test script**

Run from `ftnd`:

```powershell
npm install --save-dev vitest
```

Add this script to `ftnd/package.json`:

```json
"test": "vitest run"
```

- [ ] **Step 2: Write the failing matcher tests**

Create `ftnd/src/features/voice-control/immediateVoiceCommand.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isImmediateVoiceCommand } from "./immediateVoiceCommand";

describe("isImmediateVoiceCommand", () => {
  it.each([
    "暂停",
    "继续播放",
    "快一点",
    "慢一点",
    "我准备好了",
    "重新播放",
    "上一个动作",
    "这个动作重新做一遍",
    "下一个动作",
    "从头开始教学",
    "开始录制",
    "停止录制",
    "调到 0.5 倍",
    "倒回 5 秒",
    "快进三秒",
  ])("accepts the complete short command %s", (transcript) => {
    expect(isImmediateVoiceCommand(transcript)).toBe(true);
  });

  it.each([
    "",
    "请",
    "调到",
    "倒回五",
    "我觉得这个视频有一点",
    "老师我脑子有点乱，能不能慢一点讲",
    "今天天气怎么样",
  ])("waits for a final transcript for %s", (transcript) => {
    expect(isImmediateVoiceCommand(transcript)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the focused test and verify RED**

Run from `ftnd`:

```powershell
npm test -- immediateVoiceCommand.test.ts
```

Expected: FAIL because `./immediateVoiceCommand` does not exist.

- [ ] **Step 4: Implement the pure matcher**

Create `ftnd/src/features/voice-control/immediateVoiceCommand.ts`:

```ts
const SIMPLE_COMMANDS = new Set([
  "暂停",
  "停一下",
  "先停",
  "停",
  "继续",
  "接着",
  "播放",
  "恢复播放",
  "继续播放",
  "快一点",
  "快点",
  "加速",
  "慢一点",
  "慢点",
  "慢放",
  "减速",
  "我准备好了",
  "我已经准备好了",
  "直接开始练习",
  "重新播放",
  "重新开始",
  "重来",
  "重来一遍",
  "上个动作",
  "上一个动作",
  "前一个动作",
  "倒退到上个",
  "退回上个",
  "这个动作再来",
  "这个动作重做",
  "这个动作重新做一遍",
  "当前动作再来",
  "再做一遍",
  "再来一遍",
  "重新做一遍",
  "重复这个动作",
  "下个动作",
  "下一个动作",
  "跳到下个",
  "进入下个",
  "从头开始",
  "整支重来",
  "重新开始教学",
  "开始录制",
  "启动录制",
  "开始录像",
  "停止录制",
  "结束录制",
  "完成录制",
  "停止录像",
]);

const PLAYBACK_RATE_COMMAND =
  /^(?:调到|调整到|设置为)?(?:0\.(?:25|5|75)|1(?:\.(?:25|5|75))?|2)倍(?:速)?$/;
const SEEK_COMMAND =
  /^(?:倒回|回退|退回|往回|后退|快进|往后跳|向后跳)(?:(?:\d+(?:\.\d+)?|[一二两三四五六七八九十])秒)?$/;

export function normalizeVoiceTranscript(transcript: string): string {
  return transcript
    .trim()
    .toLowerCase()
    .replace(/[，。！？、,.!?]/g, "")
    .replace(/\s+/g, "");
}

export function isImmediateVoiceCommand(transcript: string): boolean {
  const normalized = normalizeVoiceTranscript(transcript);
  return (
    SIMPLE_COMMANDS.has(normalized) ||
    PLAYBACK_RATE_COMMAND.test(normalized) ||
    SEEK_COMMAND.test(normalized)
  );
}
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run from `ftnd`:

```powershell
npm test -- immediateVoiceCommand.test.ts
```

Expected: all parameterized cases pass.

- [ ] **Step 6: Connect the matcher to interim recognition**

In `useBrowserSpeechRecognition.ts`, import:

```ts
import { isImmediateVoiceCommand } from "../immediateVoiceCommand";
```

Replace:

```ts
if (isUrgentInterimCommand(interim)) {
```

with:

```ts
if (isImmediateVoiceCommand(interim)) {
```

Delete the local `isUrgentInterimCommand` function. Leave `dispatchRecognizedTranscript` unchanged so interim and final transcripts share the current 2.5-second duplicate suppression.

- [ ] **Step 7: Run complete verification**

Run from `ftnd`:

```powershell
npm test
npm run lint
npm run build
```

Expected: matcher tests pass, ESLint exits 0, and the production build succeeds.

- [ ] **Step 8: Start the frontend for manual speech verification**

Run from `ftnd`:

```powershell
npm run dev
```

Expected while listening:

- Saying “快一点” changes playback speed without clicking anything or waiting for listening to stop.
- Saying “慢一点” changes playback speed immediately.
- The matching final transcript does not execute the same command twice.
- Listening stays active until the close button is clicked.
