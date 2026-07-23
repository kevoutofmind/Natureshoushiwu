"use client";

import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { VoiceCommandResult } from "@/features/voice-control";
import {
  buildReferenceDataset,
  loadReferenceManifest,
} from "@/features/video-stage/reference-template-builder";
import type {
  DatasetBuildProgress,
  ReferenceDanceDataset,
} from "@/features/video-stage/reference-dataset.types";
import type { SkeletonSnapshot } from "@/features/video-stage/vision-types";
import type { VlmTeachingFeedback } from "../contracts/vlm-teaching-feedback";
import type {
  TeachingAgentCommand,
  TeachingAgentEventInput,
  TeachingAgentSession,
  TeachingAgentTurnResult,
  TeachingRuntimeStatus,
  TeachingVoiceCommand,
} from "../contracts/teaching-runtime";
import {
  getReferenceDataset,
  registerReferenceDataset,
  sendTeachingAgentEvent,
  startTeachingSession,
} from "../vlm-runtime-api";

interface UseTeachingRuntimeOptions {
  danceId: string;
  referenceVideoRef: RefObject<HTMLVideoElement | null>;
  applyFeedback: (feedback: VlmTeachingFeedback) => void;
}

export function useTeachingRuntime({
  danceId,
  referenceVideoRef,
  applyFeedback,
}: UseTeachingRuntimeOptions) {
  const [runtimeStatus, setRuntimeStatus] = useState<TeachingRuntimeStatus>({
    state: "idle",
    message: "准备参考数据后即可开始 AI 教学。",
  });
  const [buildProgress, setBuildProgress] =
    useState<DatasetBuildProgress | null>(null);
  const [referenceVideoUrl, setReferenceVideoUrl] = useState("");
  const [session, setSession] = useState<TeachingAgentSession | null>(null);
  const [latestSpeech, setLatestSpeech] = useState("");
  const [lessonMotions, setLessonMotions] = useState<
    Array<{ motionId: string; instruction: string }>
  >([]);
  const datasetRef = useRef<ReferenceDanceDataset | null>(null);
  const sessionRef = useRef<TeachingAgentSession | null>(null);
  const eventSequenceRef = useRef(0);
  const evaluatingRef = useRef(false);
  const evaluationStartedAtRef = useRef(0);
  const frameBufferRef = useRef<SkeletonSnapshot[]>([]);
  const lastBufferedAtRef = useRef(0);
  const lastObservationAtRef = useRef(0);
  const observationPendingRef = useRef(false);
  const playbackCleanupRef = useRef<(() => void) | null>(null);

  const speak = useCallback((speech: string) => {
    if (!speech.trim()) return;
    setLatestSpeech(speech);
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(speech);
      utterance.lang = "zh-CN";
      utterance.rate = 0.92;
      utterance.pitch = 1.03;
      utterance.volume = 1;
      const voice = preferredChineseVoice(window.speechSynthesis.getVoices());
      if (voice) utterance.voice = voice;
      window.speechSynthesis.speak(utterance);
    }
  }, []);

  const sendEvent = useCallback(
    async (
      event: TeachingAgentEventInput,
    ): Promise<TeachingAgentTurnResult> => {
      const currentSession = sessionRef.current;
      if (!currentSession) throw new Error("教学会话尚未启动。");
      eventSequenceRef.current += 1;
      const result = await sendTeachingAgentEvent(
        currentSession.sessionId,
        `${currentSession.sessionId}-event-${eventSequenceRef.current}`,
        currentSession.version,
        event,
      );
      sessionRef.current = result.session;
      setSession(result.session);
      return result;
    },
    [],
  );

  const playRange = useCallback(
    async (
      command: TeachingAgentCommand,
      completionEvent: TeachingAgentEventInput,
      status: TeachingRuntimeStatus,
      executeTurn: (turn: TeachingAgentTurnResult) => Promise<void>,
    ) => {
      playbackCleanupRef.current?.();
      const video = await waitForVideo(referenceVideoRef);
      await waitForMetadata(video);
      const startMs = numberArgument(command.arguments.startMs, 0);
      const endMs = numberArgument(
        command.arguments.endMs,
        Math.round(video.duration * 1000),
      );
      const playbackRate = numberArgument(command.arguments.playbackRate, 1);
      video.currentTime = Math.max(0, startMs / 1000);
      video.playbackRate = Math.max(0.25, Math.min(2, playbackRate));
      video.muted = true;
      setRuntimeStatus(status);

      let finished = false;
      const finish = async () => {
        if (finished) return;
        finished = true;
        video.pause();
        cleanup();
        try {
          await executeTurn(await sendEvent(completionEvent));
        } catch (error: unknown) {
          setRuntimeStatus({ state: "error", message: errorMessage(error) });
        }
      };
      const handleTimeUpdate = () => {
        if (video.currentTime * 1000 >= endMs - 35) void finish();
      };
      const cleanup = () => {
        video.removeEventListener("timeupdate", handleTimeUpdate);
        video.removeEventListener("ended", finish);
        if (playbackCleanupRef.current === cleanup) {
          playbackCleanupRef.current = null;
        }
      };
      playbackCleanupRef.current = cleanup;
      video.addEventListener("timeupdate", handleTimeUpdate);
      video.addEventListener("ended", finish);
      await video.play();
    },
    [referenceVideoRef, sendEvent],
  );

  const executeCommandsRef = useRef<
    ((turn: TeachingAgentTurnResult) => Promise<void>) | null
  >(null);
  const executeTurn = useCallback(
    async (turn: TeachingAgentTurnResult) => {
      sessionRef.current = turn.session;
      setSession(turn.session);
      const judge = turn.session.latestJudgeResult;
      if (judge) {
        applyFeedback({
          decision: judge.decision,
          shouldAdvance: judge.shouldAdvance,
          shouldPause: judge.shouldPause,
        });
        if (judge.speech) setLatestSpeech(judge.speech);
      }

      for (const command of turn.commands) {
        switch (command.tool) {
          case "PLAY_FULL_PREVIEW":
            await playRange(
              command,
              { type: "PREVIEW_FINISHED" },
              { state: "preview", message: "先完整观看一遍参考舞蹈。" },
              executeCommandsRef.current!,
            );
            break;
          case "PLAY_MOTION_DEMO":
            await playRange(
              command,
              { type: "MOTION_DEMO_FINISHED" },
              { state: "demo", message: "正在慢速示范当前动作。" },
              executeCommandsRef.current!,
            );
            break;
          case "START_FULL_CHALLENGE":
            await playRange(
              command,
              { type: "FULL_CHALLENGE_FINISHED" },
              { state: "challenge", message: "现在完整挑战整支舞蹈。" },
              executeCommandsRef.current!,
            );
            break;
          case "START_REALTIME_EVALUATION":
            evaluatingRef.current = true;
            evaluationStartedAtRef.current = performance.now();
            lastObservationAtRef.current = 0;
            frameBufferRef.current = [];
            setRuntimeStatus({
              state: "practice",
              message: "轮到你做当前动作，系统正在本地实时判断。",
            });
            break;
          case "STOP_REALTIME_EVALUATION":
            evaluatingRef.current = false;
            frameBufferRef.current = [];
            break;
          case "PAUSE_PLAYBACK":
            referenceVideoRef.current?.pause();
            setRuntimeStatus({ state: "paused", message: "教学已暂停。" });
            break;
          case "RESUME_PLAYBACK":
            await referenceVideoRef.current?.play();
            break;
          case "SPEAK":
          case "SHOW_HINT":
            speak(stringArgument(command.arguments.speech));
            break;
          case "SESSION_COMPLETED":
            evaluatingRef.current = false;
            setRuntimeStatus({
              state: "completed",
              message: "整支舞蹈教学已经完成。",
            });
            break;
          case "REQUEST_CLOUD_COACHING":
          case "REQUEST_CLOUD_SUMMARY":
            // Cloud enhancement is intentionally non-blocking for the demo.
            break;
        }
      }
    },
    [applyFeedback, playRange, referenceVideoRef, speak],
  );
  useEffect(() => {
    executeCommandsRef.current = executeTurn;
    return () => {
      if (executeCommandsRef.current === executeTurn) {
        executeCommandsRef.current = null;
      }
    };
  }, [executeTurn]);

  const prepare = useCallback(async () => {
    playbackCleanupRef.current?.();
    evaluatingRef.current = false;
    setRuntimeStatus({
      state: "preparing-dataset",
      message: "正在从 5 个参考视频生成本地骨骼模板…",
    });
    try {
      const manifest = await loadReferenceManifest(danceId);
      const primary =
        manifest.references.find(
          (reference) => reference.referenceId === manifest.primaryReferenceId,
        ) ?? manifest.references[0];
      setReferenceVideoUrl(primary.videoUrl);
      let dataset = await getReferenceDataset(danceId);
      if (dataset) {
        setBuildProgress({
          stage: "completed",
          completedVideos: dataset.sourceVideoCount,
          totalVideos: dataset.sourceVideoCount,
          message: `已复用 ${dataset.sourceVideoCount} 条参考视频生成的本地模板。`,
        });
      } else {
        dataset = await buildReferenceDataset(manifest, setBuildProgress);
        await registerReferenceDataset(dataset);
      }
      datasetRef.current = dataset;
      setLessonMotions(
        dataset.lesson.motions.map(({ motionId, instruction }) => ({
          motionId,
          instruction,
        })),
      );
      const sessionId = `lesson-${danceId}-${Date.now()}`;
      const turn = await startTeachingSession(sessionId, danceId);
      sessionRef.current = turn.session;
      setSession(turn.session);
      setRuntimeStatus({ state: "ready", message: "参考模板已就绪。" });
      await executeTurn(turn);
    } catch (error: unknown) {
      setRuntimeStatus({ state: "error", message: errorMessage(error) });
    }
  }, [danceId, executeTurn]);

  const ingestSkeleton = useCallback(
    (snapshot: SkeletonSnapshot) => {
      if (!evaluatingRef.current) return;
      const now = performance.now();
      if (now - lastBufferedAtRef.current < 100) return;
      lastBufferedAtRef.current = now;
      frameBufferRef.current = [...frameBufferRef.current.slice(-23), snapshot];
      const elapsedMs = now - evaluationStartedAtRef.current;
      if (
        elapsedMs < 650 ||
        now - lastObservationAtRef.current < 450 ||
        observationPendingRef.current ||
        frameBufferRef.current.length < 5
      ) {
        return;
      }

      lastObservationAtRef.current = now;
      observationPendingRef.current = true;
      const currentSession = sessionRef.current;
      const durationMs =
        datasetRef.current?.templatePacks.find(
          (pack) => pack.motionId === currentSession?.currentMotionId,
        )?.expectedDurationMs ?? 3000;
      const observationFrames = frameBufferRef.current.map((frame) => ({
        ...frame,
        timestampMs: Math.max(
          0,
          Math.round(frame.timestampMs - frameBufferRef.current[0].timestampMs),
        ),
      }));

      void sendEvent({
        type: "REALTIME_OBSERVATION",
        sampleId: `sample-${Date.now()}`,
        observation: {
          mirrored: true,
          progress: Math.min(1, elapsedMs / durationMs),
          frames: observationFrames,
        },
      })
        .then(executeTurn)
        .catch((error: unknown) =>
          setRuntimeStatus({ state: "error", message: errorMessage(error) }),
        )
        .finally(() => {
          observationPendingRef.current = false;
        });
    },
    [executeTurn, sendEvent],
  );

  const sendVoiceCommand = useCallback(
    async (command: TeachingVoiceCommand) => {
      try {
        await executeTurn(await sendEvent({ type: "VOICE_COMMAND", command }));
      } catch (error: unknown) {
        setRuntimeStatus({ state: "error", message: errorMessage(error) });
      }
    },
    [executeTurn, sendEvent],
  );

  const handleVoiceResult = useCallback(
    (result: VoiceCommandResult) => {
      if (!result.accepted || !result.command.intent) return;
      const intent = result.command.intent as string;
      const video = referenceVideoRef.current;
      const requestedPlaybackRate = result.command.parameters.playbackRate;
      if (video && requestedPlaybackRate !== undefined) {
        video.playbackRate = Math.max(0.25, Math.min(2, requestedPlaybackRate));
      }
      const mappings: Partial<Record<string, TeachingVoiceCommand>> = {
        PAUSE: "PAUSE",
        RESUME: "RESUME",
        READY: "READY",
        REWIND: "PREVIOUS_ACTION",
        PREVIOUS_ACTION: "PREVIOUS_ACTION",
        REPEAT_ACTION: "REPEAT_ACTION",
        FAST_FORWARD: "NEXT_ACTION",
        NEXT_ACTION: "NEXT_ACTION",
        RESTART: "RESTART_LESSON",
        RESTART_LESSON: "RESTART_LESSON",
      };
      const agentCommand = mappings[intent];
      if (agentCommand) {
        void sendVoiceCommand(agentCommand);
        return;
      }
      if (!video) return;
      if (intent === "SLOW_DOWN") video.playbackRate = 0.5;
      if (intent === "SPEED_UP") video.playbackRate = 1.25;
      if (intent === "SET_PLAYBACK_RATE") {
        video.playbackRate = Math.max(
          0.25,
          Math.min(2, result.command.parameters.playbackRate ?? 1),
        );
      }
    },
    [referenceVideoRef, sendVoiceCommand],
  );

  const simulateCorrectMotion = useCallback(async () => {
    const currentSession = sessionRef.current;
    const dataset = datasetRef.current;
    if (!currentSession || !dataset || currentSession.phase !== "PRACTICE") {
      setRuntimeStatus({
        state: "ready",
        message: "请先看完当前动作示范，再进行无摄像头模拟。",
      });
      return;
    }

    const pack = dataset.templatePacks.find(
      (candidate) => candidate.motionId === currentSession.currentMotionId,
    );
    const template = pack?.templates[0];
    if (!template) {
      setRuntimeStatus({
        state: "error",
        message: "当前动作没有可用参考模板。",
      });
      return;
    }

    try {
      setRuntimeStatus({
        state: "practice",
        message: "正在用参考骨骼模拟一次正确动作……",
      });
      await executeTurn(
        await sendEvent({
          type: "REALTIME_OBSERVATION",
          sampleId: `roadshow-simulation-${Date.now()}`,
          observation: {
            mirrored: template.mirrored,
            progress: 1,
            frames: template.frames.map((frame) => ({
              ...frame,
              leftHand: frame.leftHand ?? [],
              rightHand: frame.rightHand ?? [],
            })),
          },
        }),
      );
    } catch (error: unknown) {
      setRuntimeStatus({ state: "error", message: errorMessage(error) });
    }
  }, [executeTurn, sendEvent]);

  useEffect(
    () => () => {
      playbackCleanupRef.current?.();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    [],
  );

  return {
    prepare,
    ingestSkeleton,
    handleVoiceResult,
    simulateCorrectMotion,
    sendVoiceCommand,
    runtimeStatus,
    buildProgress,
    referenceVideoUrl,
    session,
    latestSpeech,
    lessonMotions,
  };
}

async function waitForVideo(
  ref: RefObject<HTMLVideoElement | null>,
): Promise<HTMLVideoElement> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (ref.current) return ref.current;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error("参考视频播放器尚未准备好。");
}

function waitForMetadata(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= 1 && Number.isFinite(video.duration)) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("参考视频元数据加载超时。")),
      8000,
    );
    video.addEventListener(
      "loadedmetadata",
      () => {
        window.clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function numberArgument(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringArgument(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "教学运行时发生未知错误。";
}

function preferredChineseVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
  const preferredNames = [
    "Xiaoxiao",
    "Xiaoyi",
    "Yunxi",
    "Tingting",
    "Meijia",
    "Google 普通话",
  ];
  return (
    voices.find((voice) =>
      preferredNames.some((name) => voice.name.includes(name)),
    ) ?? voices.find((voice) => voice.lang.toLowerCase().startsWith("zh"))
  );
}
