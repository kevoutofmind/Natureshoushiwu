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
import { buildPreparedReferenceDataset } from "@/features/video-stage/prepared-skeleton-dataset";
import {
  compareGeometry,
  mirrorSkeleton,
} from "@/features/video-stage/vision-geometry";
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
import { executeVideoVoiceCommand } from "../voiceCommandExecution";
import {
  getReferenceDataset,
  registerReferenceDataset,
  sendTeachingAgentEvent,
  startTeachingSession,
  synthesizeLumiSpeech,
} from "../vlm-runtime-api";

interface UseTeachingRuntimeOptions {
  danceId: string;
  referenceVideoRef: RefObject<HTMLVideoElement | null>;
  applyFeedback: (feedback: VlmTeachingFeedback) => void;
}

export type ChallengeStage =
  | "idle"
  | "slow"
  | "review"
  | "targeted-replay"
  | "fast"
  | "complete";

export interface SlowPracticeReview {
  weakMotionIndex: number | null;
  headline: string;
  detail: string;
}

interface SlowPracticeSample {
  videoTimeMs: number;
  snapshot: SkeletonSnapshot;
}

interface MutableValueRef<T> {
  current: T;
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
  const [challengeStage, setChallengeStage] =
    useState<ChallengeStage>("idle");
  const [slowPracticeReview, setSlowPracticeReview] =
    useState<SlowPracticeReview | null>(null);
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
  const challengeCommandRef = useRef<TeachingAgentCommand | null>(null);
  const slowPracticeActiveRef = useRef(false);
  const slowPracticeSamplesRef = useRef<SlowPracticeSample[]>([]);
  const speechQueueRef = useRef<string[]>([]);
  const speechPlaybackActiveRef = useRef(false);
  const speechRunIdRef = useRef(0);
  const preferredVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const playQueuedSpeechRef = useRef<(() => void) | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechAudioUrlRef = useRef<string | null>(null);

  const playQueuedSpeech = useCallback(() => {
    if (!("speechSynthesis" in window) || speechPlaybackActiveRef.current) {
      return;
    }
    const nextSpeech = speechQueueRef.current.shift();
    if (!nextSpeech) return;

    speechPlaybackActiveRef.current = true;
    const runId = speechRunIdRef.current;
    const finish = () => {
      if (runId !== speechRunIdRef.current) return;
      releaseLumiAudio(speechAudioRef, speechAudioUrlRef);
      speechPlaybackActiveRef.current = false;
      window.setTimeout(() => playQueuedSpeechRef.current?.(), 90);
    };
    let browserFallbackStarted = false;
    const playBrowserFallback = () => {
      if (browserFallbackStarted) return;
      browserFallbackStarted = true;
      if (!("speechSynthesis" in window)) {
        finish();
        return;
      }
      const utterance = createLumiUtterance(
        nextSpeech,
        preferredVoiceRef.current ??
          preferredLumiVoice(window.speechSynthesis.getVoices()),
      );
      utterance.onend = finish;
      utterance.onerror = finish;
      window.speechSynthesis.speak(utterance);
    };
    const fallbackTimer = window.setTimeout(
      playBrowserFallback,
      LUMI_TTS_FALLBACK_DELAY_MS,
    );

    void synthesizeLumiSpeech(nextSpeech)
      .then(async (audioUrl) => {
        window.clearTimeout(fallbackTimer);
        if (runId !== speechRunIdRef.current) {
          URL.revokeObjectURL(audioUrl);
          return;
        }
        if (browserFallbackStarted) {
          URL.revokeObjectURL(audioUrl);
          return;
        }
        const audio = new Audio(audioUrl);
        speechAudioRef.current = audio;
        speechAudioUrlRef.current = audioUrl;
        audio.onended = finish;
        audio.onerror = finish;
        await audio.play();
      })
      .catch(() => {
        window.clearTimeout(fallbackTimer);
        releaseLumiAudio(speechAudioRef, speechAudioUrlRef);
        playBrowserFallback();
      });
  }, []);

  useEffect(() => {
    playQueuedSpeechRef.current = playQueuedSpeech;
  }, [playQueuedSpeech]);

  const stopSpeech = useCallback(() => {
    speechRunIdRef.current += 1;
    speechQueueRef.current = [];
    speechPlaybackActiveRef.current = false;
    releaseLumiAudio(speechAudioRef, speechAudioUrlRef);
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  const speak = useCallback(
    (speech: string) => {
      const normalizedSpeech = normalizeLumiSpeech(speech);
      if (!normalizedSpeech) return;
      setLatestSpeech(normalizedSpeech);
      if (!("speechSynthesis" in window)) return;

      const nextChunks = chunkLumiSpeech(normalizedSpeech);
      if (nextChunks.length === 0) return;
      speechQueueRef.current = limitLumiSpeechQueue([
        ...speechQueueRef.current,
        ...nextChunks,
      ]);
      playQueuedSpeech();
    },
    [playQueuedSpeech],
  );
  const speakImmediately = useCallback(
    (speech: string) => {
      stopSpeech();
      speak(speech);
    },
    [speak, stopSpeech],
  );

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
      status: TeachingRuntimeStatus,
      onFinished: () => Promise<void>,
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
      video.muted = !(
        status.state === "slow-practice" ||
        status.state === "fast-challenge"
      );
      setRuntimeStatus(status);

      let finished = false;
      const finish = async () => {
        if (finished) return;
        finished = true;
        video.pause();
        cleanup();
        try {
          await onFinished();
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
      try {
        await video.play();
      } catch (error: unknown) {
        if (
          error instanceof DOMException &&
          error.name === "NotAllowedError"
        ) {
          setRuntimeStatus({
            ...status,
            message: `${status.message} 点击“开始练习”后继续播放。`,
          });
          return;
        }
        cleanup();
        throw error;
      }
    },
    [referenceVideoRef],
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
              { state: "preview", message: "先完整观看一遍参考舞蹈。" },
              async () =>
                executeCommandsRef.current!(
                  await sendEvent({ type: "PREVIEW_FINISHED" }),
                ),
            );
            break;
          case "PLAY_MOTION_DEMO":
            await playRange(
              command,
              { state: "demo", message: "正在慢速示范当前动作。" },
              async () =>
                executeCommandsRef.current!(
                  await sendEvent({ type: "MOTION_DEMO_FINISHED" }),
                ),
            );
            break;
          case "START_FULL_CHALLENGE":
            challengeCommandRef.current = command;
            slowPracticeSamplesRef.current = [];
            slowPracticeActiveRef.current = true;
            setSlowPracticeReview(null);
            setChallengeStage("slow");
            await playRange(
              {
                ...command,
                arguments: { ...command.arguments, playbackRate: 0.65 },
              },
              {
                state: "slow-practice",
                message: "0.65 倍慢速连贯练习中；这一遍不中断，结束后再集中反馈。",
              },
              async () => {
                slowPracticeActiveRef.current = false;
                const review = buildSlowPracticeReview(
                  datasetRef.current,
                  slowPracticeSamplesRef.current,
                );
                setSlowPracticeReview(review);
                setChallengeStage("review");
                setRuntimeStatus({
                  state: "slow-review",
                  message: review.detail,
                });
                speak(`${review.headline}${review.detail}`);
              },
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
            setChallengeStage("complete");
            break;
          case "REQUEST_CLOUD_COACHING":
          case "REQUEST_CLOUD_SUMMARY":
            // Cloud enhancement is intentionally non-blocking for the demo.
            break;
        }
      }
    },
    [applyFeedback, playRange, referenceVideoRef, sendEvent, speak],
  );
  useEffect(() => {
    executeCommandsRef.current = executeTurn;
    return () => {
      if (executeCommandsRef.current === executeTurn) {
        executeCommandsRef.current = null;
      }
    };
  }, [executeTurn]);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const refreshPreferredVoice = () => {
      preferredVoiceRef.current =
        preferredLumiVoice(window.speechSynthesis.getVoices()) ?? null;
    };
    refreshPreferredVoice();
    window.speechSynthesis.addEventListener(
      "voiceschanged",
      refreshPreferredVoice,
    );
    return () => {
      window.speechSynthesis.removeEventListener(
        "voiceschanged",
        refreshPreferredVoice,
      );
    };
  }, []);

  const prepare = useCallback(async () => {
    playbackCleanupRef.current?.();
    stopSpeech();
    evaluatingRef.current = false;
    challengeCommandRef.current = null;
    slowPracticeActiveRef.current = false;
    slowPracticeSamplesRef.current = [];
    setChallengeStage("idle");
    setSlowPracticeReview(null);
    setRuntimeStatus({
      state: "preparing-dataset",
      message: "正在从 5 个参考视频生成本地骨骼模板…",
    });
    try {
      setRuntimeStatus({
        state: "preparing-dataset",
        message: "正在读取当前类别的 10 个骨架素材，并建立主示例与泛化模板。",
      });
      let dataset: ReferenceDanceDataset;
      try {
        dataset = await buildPreparedReferenceDataset(
          danceId,
          setBuildProgress,
        );
        setReferenceVideoUrl(dataset.referenceVideoUrl);
        await registerReferenceDataset(dataset);
      } catch {
        const manifest = await loadReferenceManifest(danceId);
        const primary =
          manifest.references.find(
            (reference) =>
              reference.referenceId === manifest.primaryReferenceId,
          ) ?? manifest.references[0];
        setReferenceVideoUrl(primary.videoUrl);
        const existingDataset = await getReferenceDataset(danceId);
        if (existingDataset) {
          dataset = existingDataset;
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
  }, [danceId, executeTurn, stopSpeech]);

  const ingestSkeleton = useCallback(
    (snapshot: SkeletonSnapshot) => {
      if (slowPracticeActiveRef.current) {
        const videoTimeMs = (referenceVideoRef.current?.currentTime ?? 0) * 1000;
        if (videoTimeMs > 0) {
          slowPracticeSamplesRef.current = [
            ...slowPracticeSamplesRef.current.slice(-359),
            { videoTimeMs, snapshot },
          ];
        }
      }
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
          mirrored: false,
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
    [executeTurn, referenceVideoRef, sendEvent],
  );

  const replayWeakMotion = useCallback(async () => {
    const dataset = datasetRef.current;
    const review = slowPracticeReview;
    if (!dataset || review?.weakMotionIndex == null) return;
    const motion = dataset.lesson.motions[review.weakMotionIndex];
    if (!motion) return;
    setChallengeStage("targeted-replay");
    await playRange(
      {
        commandId: `local-targeted-replay-${Date.now()}`,
        tool: "PLAY_MOTION_DEMO",
        arguments: {
          startMs: motion.demoStartMs,
          endMs: motion.demoEndMs,
          playbackRate: 0.5,
        },
        requiresAck: false,
        blocking: true,
      },
      {
        state: "demo",
        message: `正在针对性重看动作 ${review.weakMotionIndex + 1}。`,
      },
      async () => {
        setChallengeStage("review");
        setRuntimeStatus({ state: "slow-review", message: review.detail });
      },
    );
  }, [playRange, slowPracticeReview]);

  const startFullSpeedChallenge = useCallback(async () => {
    const command = challengeCommandRef.current;
    if (!command || challengeStage === "fast") return;
    setChallengeStage("fast");
    await playRange(
      {
        ...command,
        arguments: { ...command.arguments, playbackRate: 1 },
      },
      {
        state: "fast-challenge",
        message: "原速完整挑战中。跟住音乐完成整支舞，不打断。",
      },
      async () =>
        executeCommandsRef.current!(
          await sendEvent({ type: "FULL_CHALLENGE_FINISHED" }),
        ),
    );
  }, [challengeStage, playRange, sendEvent]);

  const sendVoiceCommand = useCallback(
    async (command: TeachingVoiceCommand) => {
      try {
        if (command === "RESTART_LESSON") {
          setChallengeStage("idle");
          setSlowPracticeReview(null);
          challengeCommandRef.current = null;
        }
        await executeTurn(await sendEvent({ type: "VOICE_COMMAND", command }));
      } catch (error: unknown) {
        setRuntimeStatus({ state: "error", message: errorMessage(error) });
      }
    },
    [executeTurn, sendEvent],
  );

  const handleVoiceResult = useCallback(
    (result: VoiceCommandResult) => {
      if (!result.accepted || !result.command.intent) {
        if (result.responseText.trim()) {
          setRuntimeStatus((currentStatus) => ({
            ...currentStatus,
            message: result.responseText,
          }));
          speakImmediately(result.responseText);
        }
        return;
      }
      const intent = result.command.intent as string;
      if (intent === "COACH_QUESTION") {
        if (result.responseText.trim()) {
          setRuntimeStatus((currentStatus) => ({
            ...currentStatus,
            message: result.responseText,
          }));
          speakImmediately(result.responseText);
        }
        return;
      }
      const directVideoIntents = new Set([
        "PAUSE",
        "RESUME",
        "RESTART",
        "SLOW_DOWN",
        "SPEED_UP",
        "SET_PLAYBACK_RATE",
      ]);
      if (directVideoIntents.has(intent)) {
        void executeVideoVoiceCommand(result, referenceVideoRef.current).catch(
          (error: unknown) =>
            setRuntimeStatus({ state: "error", message: errorMessage(error) }),
        );
        return;
      }

      const mappings: Partial<Record<string, TeachingVoiceCommand>> = {
        READY: "READY",
        REWIND: "PREVIOUS_ACTION",
        PREVIOUS_ACTION: "PREVIOUS_ACTION",
        REPEAT_ACTION: "REPEAT_ACTION",
        FAST_FORWARD: "NEXT_ACTION",
        NEXT_ACTION: "NEXT_ACTION",
        RESTART_LESSON: "RESTART_LESSON",
      };
      const agentCommand = mappings[intent];
      if (agentCommand) void sendVoiceCommand(agentCommand);
    },
    [referenceVideoRef, sendVoiceCommand, speakImmediately],
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
      stopSpeech();
    },
    [stopSpeech],
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
    challengeStage,
    slowPracticeReview,
    replayWeakMotion,
    startFullSpeedChallenge,
    speak,
  };
}

function buildSlowPracticeReview(
  dataset: ReferenceDanceDataset | null,
  samples: SlowPracticeSample[],
): SlowPracticeReview {
  if (!dataset || samples.length < 6) {
    return {
      weakMotionIndex: dataset && dataset.lesson.motions.length > 1 ? 1 : null,
      headline: "节奏已经连起来了。",
      detail:
        "这遍没有采集到足够完整的骨骼帧；建议再看一次第 2 个动作的手腕高度，也可以直接进入原速挑战。",
    };
  }

  let weakest:
    | {
        motionIndex: number;
        measurement: ReturnType<typeof compareGeometry>[number];
        severity: number;
      }
    | undefined;

  dataset.lesson.motions.forEach((motion, motionIndex) => {
    const midpoint = (motion.demoStartMs + motion.demoEndMs) / 2;
    const practice = samples.reduce<SlowPracticeSample | undefined>(
      (closest, sample) =>
        sample.videoTimeMs >= motion.demoStartMs &&
        sample.videoTimeMs <= motion.demoEndMs &&
        (!closest ||
          Math.abs(sample.videoTimeMs - midpoint) <
            Math.abs(closest.videoTimeMs - midpoint))
          ? sample
          : closest,
      undefined,
    );
    const pack = dataset.templatePacks.find(
      (candidate) => candidate.motionId === motion.motionId,
    );
    const frames = pack?.templates[0]?.frames;
    const referenceFrame = frames?.[Math.floor(frames.length / 2)];
    if (!practice || !referenceFrame) return;

    const measurements = compareGeometry(
      {
        timestampMs: referenceFrame.timestampMs,
        pose: referenceFrame.pose,
        leftHand: referenceFrame.leftHand ?? [],
        rightHand: referenceFrame.rightHand ?? [],
      },
      mirrorSkeleton(practice.snapshot),
    );
    measurements.forEach((measurement) => {
      if (measurement.reliability < 0.3) return;
      const severity =
        Math.abs(measurement.delta) /
        (measurement.unit === "degree" ? 28 : 0.34);
      if (!weakest || severity > weakest.severity) {
        weakest = { motionIndex, measurement, severity };
      }
    });
  });

  if (!weakest || weakest.severity < 0.72) {
    return {
      weakMotionIndex: null,
      headline: "这一遍很连贯。",
      detail: "动作衔接和高度都比较稳定，可以带着刚才的感觉进入原速挑战。",
    };
  }

  return {
    weakMotionIndex: weakest.motionIndex,
    headline: `第 ${weakest.motionIndex + 1} 个动作值得再抠一下。`,
    detail: describeWeakMeasurement(weakest.measurement),
  };
}

function describeWeakMeasurement(
  measurement: ReturnType<typeof compareGeometry>[number],
): string {
  const side = measurement.name.startsWith("left") ? "左" : "右";
  if (measurement.name.includes("wrist_height")) {
    return `${side}手腕${measurement.delta < 0 ? "稍微偏低" : "稍微偏高"}。下一遍只盯住手腕高度，其他部分保持刚才的节奏。`;
  }
  if (measurement.name.includes("elbow_angle")) {
    return `${side}手肘${measurement.delta < 0 ? "可以再打开一点" : "可以再收一点"}。先慢看一次局部，再进入原速会更稳。`;
  }
  return `身体重心有一点偏移。下一遍保持肩膀放松、躯干稳定，手部动作会更干净。`;
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

const LUMI_MAX_CHUNK_LENGTH = 28;
const LUMI_MAX_QUEUED_CHUNKS = 8;
const LUMI_TTS_FALLBACK_DELAY_MS = 2500;

function normalizeLumiSpeech(speech: string): string {
  return speech
    .replace(/\s+/g, " ")
    .replace(/([\u3002\uff01\uff1f!?;\uff1b])(?=\S)/g, "$1 ")
    .trim();
}

function chunkLumiSpeech(speech: string): string[] {
  const normalizedSpeech = normalizeLumiSpeech(speech);
  if (!normalizedSpeech) return [];
  const sentenceChunks =
    normalizedSpeech.match(
      /[^\u3002\uff01\uff1f!?;\uff1b]+[\u3002\uff01\uff1f!?;\uff1b]?/g,
    ) ?? [normalizedSpeech];

  return sentenceChunks
    .flatMap(splitLongLumiSentence)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map(ensureLumiPause);
}

function splitLongLumiSentence(sentence: string): string[] {
  const trimmed = sentence.trim();
  if (trimmed.length <= LUMI_MAX_CHUNK_LENGTH) return [trimmed];

  const commaChunks =
    trimmed.match(/[^\u3001\uff0c,]+[\u3001\uff0c,]?/g) ?? [trimmed];
  const chunks: string[] = [];
  let currentChunk = "";
  commaChunks.forEach((chunk) => {
    const nextChunk = `${currentChunk}${chunk}`.trim();
    if (nextChunk.length <= LUMI_MAX_CHUNK_LENGTH || !currentChunk) {
      currentChunk = nextChunk;
      return;
    }
    chunks.push(currentChunk);
    currentChunk = chunk.trim();
  });
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

function ensureLumiPause(speech: string): string {
  return /[\u3002\uff01\uff1f!?;\uff1b]$/.test(speech)
    ? speech
    : `${speech}\u3002`;
}

function limitLumiSpeechQueue(chunks: string[]): string[] {
  return chunks.slice(-LUMI_MAX_QUEUED_CHUNKS);
}

function createLumiUtterance(
  speech: string,
  voice: SpeechSynthesisVoice | undefined | null,
): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(speech);
  utterance.lang = voice?.lang ?? "zh-CN";
  utterance.rate = 0.86;
  utterance.pitch = 1.06;
  utterance.volume = 1;
  if (voice) utterance.voice = voice;
  return utterance;
}

function releaseLumiAudio(
  audioRef: MutableValueRef<HTMLAudioElement | null>,
  audioUrlRef: MutableValueRef<string | null>,
) {
  audioRef.current?.pause();
  audioRef.current = null;
  if (audioUrlRef.current) {
    URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = null;
  }
}

function preferredLumiVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | undefined {
  const chineseVoices = voices.filter((voice) =>
    voice.lang.toLowerCase().startsWith("zh"),
  );
  if (chineseVoices.length === 0) return undefined;
  return [...chineseVoices].sort(
    (left, right) => voiceNaturalnessScore(right) - voiceNaturalnessScore(left),
  )[0] ?? preferredChineseVoice(voices);
}

function voiceNaturalnessScore(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase();
  const rankedNames: Array<[string, number]> = [
    ["xiaoxiao", 100],
    ["xiaoyi", 96],
    ["yunxia", 94],
    ["xiaobei", 92],
    ["yunxi", 88],
    ["xiaohan", 86],
    ["tingting", 84],
    ["meijia", 82],
    ["google", 78],
    ["microsoft", 72],
  ];
  const matchedScore =
    rankedNames.find(([candidate]) => name.includes(candidate))?.[1] ?? 50;
  return matchedScore + (voice.localService ? 2 : 0);
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
