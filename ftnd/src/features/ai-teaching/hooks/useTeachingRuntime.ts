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
  RealtimeJudgeFeedback,
  TeachingRuntimeStatus,
  TeachingVoiceCommand,
} from "../contracts/teaching-runtime";
import { executeVideoVoiceCommand } from "../voiceCommandExecution";
import {
  getReferenceDataset,
  registerReferenceDataset,
  sendTeachingAgentEvent,
  startTeachingSession,
} from "../vlm-runtime-api";

import {
  TEACHING_MOTION_CLIP_COUNT,
  teachingMotionClipUrl,
} from "../motion-video-catalog";

interface UseTeachingRuntimeOptions {
  danceId: string;
  referenceVideoRef: RefObject<HTMLVideoElement | null>;
  applyFeedback: (feedback: VlmTeachingFeedback) => void;
}

export type ChallengeStage =
  "idle" | "slow" | "review" | "targeted-replay" | "fast" | "complete";

export interface SlowPracticeReview {
  weakMotionIndex: number | null;
  headline: string;
  detail: string;
}

interface SlowPracticeSample {
  videoTimeMs: number;
  snapshot: SkeletonSnapshot;
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
  const [latestJudgeResult, setLatestJudgeResult] =
    useState<RealtimeJudgeFeedback>();
  const [challengeStage, setChallengeStage] = useState<ChallengeStage>("idle");
  const [slowPracticeReview, setSlowPracticeReview] =
    useState<SlowPracticeReview | null>(null);
  const [lessonMotions, setLessonMotions] = useState<
    Array<{ motionId: string; instruction: string }>
  >([]);
  const [activePlaybackVideoUrl, setActivePlaybackVideoUrl] = useState("");
  const [activeMotionClipIndex, setActiveMotionClipIndex] = useState<
    number | null
  >(null);
  const datasetRef = useRef<ReferenceDanceDataset | null>(null);
  const originalVideoUrlRef = useRef("");
  const sessionRef = useRef<TeachingAgentSession | null>(null);
  const eventSequenceRef = useRef(0);
  const evaluatingRef = useRef(false);
  const frameBufferRef = useRef<SkeletonSnapshot[]>([]);
  const lastBufferedAtRef = useRef(0);
  const evaluationTimerRef = useRef<number | null>(null);
  const stageSubmissionRef = useRef<
    (motionId: string, durationMs: number) => Promise<void>
  >(async () => undefined);
  const playbackCleanupRef = useRef<(() => void) | null>(null);
  const challengeCommandRef = useRef<TeachingAgentCommand | null>(null);
  const slowPracticeActiveRef = useRef(false);
  const slowPracticeSamplesRef = useRef<SlowPracticeSample[]>([]);
  const playTeachingMotionClipRef = useRef<
    (motionIndex: number) => Promise<void>
  >(async () => undefined);

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
      status: TeachingRuntimeStatus,
      onFinished: () => Promise<void>,
    ) => {
      playbackCleanupRef.current?.();
      const video = await waitForVideo(referenceVideoRef);
      const requestedMotionIndex = numberArgument(
        command.arguments.motionIndex,
        sessionRef.current?.currentMotionIndex ?? -1,
      );
      const motionClipUrl =
        command.tool === "PLAY_MOTION_DEMO"
          ? teachingMotionClipUrl(danceId, requestedMotionIndex)
          : null;
      const originalVideoUrl = originalVideoUrlRef.current;
      let usingMotionClip = false;

      if (motionClipUrl) {
        try {
          setActivePlaybackVideoUrl(motionClipUrl);
          await loadPlaybackSource(video, motionClipUrl);
          usingMotionClip = true;
          setActiveMotionClipIndex(requestedMotionIndex);
        } catch {
          setActivePlaybackVideoUrl(originalVideoUrl);
          setActiveMotionClipIndex(null);
          await loadPlaybackSource(video, originalVideoUrl);
        }
      } else {
        setActivePlaybackVideoUrl(originalVideoUrl);
        setActiveMotionClipIndex(null);
        await loadPlaybackSource(video, originalVideoUrl);
      }

      const startMs = usingMotionClip
        ? 0
        : numberArgument(command.arguments.startMs, 0);
      const endMs = usingMotionClip
        ? Math.round(video.duration * 1000)
        : numberArgument(
            command.arguments.endMs,
            Math.round(video.duration * 1000),
          );
      const playbackRate = numberArgument(command.arguments.playbackRate, 1);
      video.currentTime = Math.max(0, startMs / 1000);
      video.playbackRate = Math.max(0.25, Math.min(2, playbackRate));
      video.muted = !(
        status.state === "slow-practice" || status.state === "fast-challenge"
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
        if (error instanceof DOMException && error.name === "NotAllowedError") {
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
    [danceId, referenceVideoRef],
  );

  const executeCommandsRef = useRef<
    ((turn: TeachingAgentTurnResult) => Promise<void>) | null
  >(null);
  const clearStageEvaluationTimer = useCallback(() => {
    if (evaluationTimerRef.current !== null) {
      window.clearTimeout(evaluationTimerRef.current);
      evaluationTimerRef.current = null;
    }
  }, []);
  const beginStageCollection = useCallback(
    (motionId: string, durationMs: number, retrying = false) => {
      clearStageEvaluationTimer();
      evaluatingRef.current = true;
      frameBufferRef.current = [];
      lastBufferedAtRef.current = 0;
      if (!retrying) setLatestJudgeResult(undefined);
      setRuntimeStatus({
        state: "practice",
        message: retrying
          ? "刚才没有采到完整骨架，请把当前动作完整做一遍，结束后统一评估。"
          : "请完整做完当前动作，系统会在动作结束后统一评估。",
      });
      evaluationTimerRef.current = window.setTimeout(
        () => void stageSubmissionRef.current(motionId, durationMs),
        Math.max(1200, durationMs),
      );
    },
    [clearStageEvaluationTimer],
  );
  const submitStageEvaluation = useCallback(
    async (motionId: string, durationMs: number) => {
      evaluationTimerRef.current = null;
      const currentSession = sessionRef.current;
      if (
        !evaluatingRef.current ||
        !currentSession ||
        currentSession.phase !== "PRACTICE" ||
        currentSession.currentMotionId !== motionId
      ) {
        return;
      }

      evaluatingRef.current = false;
      const frames = [...frameBufferRef.current];
      const firstTimestamp = frames[0]?.timestampMs ?? 0;
      const observationFrames = frames.map((frame) => ({
        timestampMs: Math.max(
          0,
          Math.round(frame.timestampMs - firstTimestamp),
        ),
        pose: frame.pose,
        ...(frame.leftHand.length >= 21 ? { leftHand: frame.leftHand } : {}),
        ...(frame.rightHand.length >= 21 ? { rightHand: frame.rightHand } : {}),
      }));

      setRuntimeStatus({
        state: "practice",
        message: "当前动作已完成，正在评估整段动作…",
      });

      try {
        const turn = await sendEvent({
          type: "REALTIME_OBSERVATION",
          sampleId: `stage-${motionId}-${Date.now()}`,
          observation: {
            mirrored: true,
            progress: 1,
            frames: observationFrames,
          },
        });
        await executeCommandsRef.current?.(turn);
        const judge = turn.session.latestJudgeResult;
        if (
          turn.session.phase === "PRACTICE" &&
          (judge?.decision === "KEEP_WATCHING" ||
            judge?.decision === "NOT_VISIBLE")
        ) {
          beginStageCollection(motionId, durationMs, true);
        }
      } catch (error: unknown) {
        setRuntimeStatus({ state: "error", message: errorMessage(error) });
      }
    },
    [beginStageCollection, sendEvent],
  );
  stageSubmissionRef.current = submitStageEvaluation;

  const executeTurn = useCallback(
    async (turn: TeachingAgentTurnResult) => {
      sessionRef.current = turn.session;
      setSession(turn.session);
      const judge = turn.session.latestJudgeResult;
      if (judge) {
        setLatestJudgeResult(judge);
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
                message:
                  "0.65 倍慢速连贯练习中；这一遍不中断，结束后再集中反馈。",
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
            {
              const motionId = sessionRef.current?.currentMotionId;
              const durationMs =
                datasetRef.current?.templatePacks.find(
                  (pack) => pack.motionId === motionId,
                )?.expectedDurationMs ?? 3000;
              if (motionId) {
                beginStageCollection(motionId, durationMs);
              }
            }
            break;
          case "STOP_REALTIME_EVALUATION":
            clearStageEvaluationTimer();
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
            clearStageEvaluationTimer();
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
    [
      applyFeedback,
      beginStageCollection,
      clearStageEvaluationTimer,
      playRange,
      referenceVideoRef,
      sendEvent,
      speak,
    ],
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
    clearStageEvaluationTimer();
    evaluatingRef.current = false;
    challengeCommandRef.current = null;
    slowPracticeActiveRef.current = false;
    slowPracticeSamplesRef.current = [];
    setChallengeStage("idle");
    setSlowPracticeReview(null);
    setLatestJudgeResult(undefined);
    frameBufferRef.current = [];
    setRuntimeStatus({
      state: "preparing-dataset",
      message: "正在准备本地骨骼模板…",
    });
    try {
      const manifest = await loadReferenceManifest(danceId);
      const primary =
        manifest.references.find(
          (reference) => reference.referenceId === manifest.primaryReferenceId,
        ) ?? manifest.references[0];
      originalVideoUrlRef.current = primary.videoUrl;
      setReferenceVideoUrl(primary.videoUrl);
      setActivePlaybackVideoUrl(primary.videoUrl);
      let dataset = await getReferenceDataset(danceId);
      if (dataset) {
        setReferenceVideoUrl(dataset.referenceVideoUrl);
        setBuildProgress({
          stage: "completed",
          completedVideos: dataset.sourceVideoCount,
          totalVideos: dataset.sourceVideoCount,
          message: `已复用 ${dataset.sourceVideoCount} 条参考视频生成的本地模板。`,
        });
      } else {
        const manifest = await loadReferenceManifest(danceId);
        const primary =
          manifest.references.find(
            (reference) =>
              reference.referenceId === manifest.primaryReferenceId,
          ) ?? manifest.references[0];
        setReferenceVideoUrl(primary.videoUrl);
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
  }, [clearStageEvaluationTimer, danceId, executeTurn]);

  const ingestSkeleton = useCallback(
    (snapshot: SkeletonSnapshot) => {
      if (slowPracticeActiveRef.current) {
        const videoTimeMs =
          (referenceVideoRef.current?.currentTime ?? 0) * 1000;
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
      frameBufferRef.current = [
        ...frameBufferRef.current.slice(-239),
        snapshot,
      ];
    },
    [referenceVideoRef],
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
      if (!result.accepted || !result.command.intent) return;
      const intent = result.command.intent as string;
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

      const currentMotionIndex =
        activeMotionClipIndex ?? sessionRef.current?.currentMotionIndex ?? 0;
      if (intent === "PREVIOUS_ACTION") {
        void playTeachingMotionClipRef.current(
          Math.max(0, currentMotionIndex - 1),
        );
        return;
      }
      if (intent === "NEXT_ACTION") {
        void playTeachingMotionClipRef.current(
          Math.min(TEACHING_MOTION_CLIP_COUNT - 1, currentMotionIndex + 1),
        );
        return;
      }
      if (intent === "REPEAT_ACTION") {
        void playTeachingMotionClipRef.current(currentMotionIndex);
        return;
      }
      if (intent === "RESTART_LESSON") {
        void playTeachingMotionClipRef.current(0);
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
    [activeMotionClipIndex, referenceVideoRef, sendVoiceCommand],
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

  const playTeachingMotionClip = useCallback(
    async (motionIndex: number) => {
      if (!teachingMotionClipUrl(danceId, motionIndex)) {
        setRuntimeStatus({
          state: "error",
          message: "这个动作暂时没有可播放的视频切片。",
        });
        return;
      }

      try {
        await playRange(
          {
            commandId: `manual-motion-clip-${motionIndex}-${Date.now()}`,
            tool: "PLAY_MOTION_DEMO",
            arguments: {
              motionIndex,
              startMs: 0,
              playbackRate: 1,
            },
            requiresAck: false,
            blocking: true,
          },
          {
            state: "demo",
            message: `正在教学第 ${motionIndex + 1} 个动作，再点一次可以重新播放。`,
          },
          async () => {
            setRuntimeStatus({
              state: "ready",
              message: `第 ${motionIndex + 1} 个动作播放完成，可以选择其他动作继续学习。`,
            });
          },
        );
      } catch (error: unknown) {
        setRuntimeStatus({ state: "error", message: errorMessage(error) });
      }
    },
    [danceId, playRange],
  );
  playTeachingMotionClipRef.current = playTeachingMotionClip;

  useEffect(
    () => () => {
      playbackCleanupRef.current?.();
      clearStageEvaluationTimer();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    [clearStageEvaluationTimer],
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
    activePlaybackVideoUrl,
    activeMotionClipIndex,
    playTeachingMotionClip,
    session,
    latestJudgeResult,
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

async function loadPlaybackSource(
  video: HTMLVideoElement,
  sourceUrl: string,
): Promise<void> {
  if (!sourceUrl) throw new Error("参考视频地址为空。");
  const requestedUrl = new URL(sourceUrl, window.location.href).href;
  const currentUrl = video.currentSrc || video.src;
  if (currentUrl !== requestedUrl) {
    video.pause();
    video.src = sourceUrl;
    video.load();
  }
  await waitForMetadata(video);
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
