"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CameraswitchRoundedIcon from "@mui/icons-material/CameraswitchRounded";
import FiberManualRecordRoundedIcon from "@mui/icons-material/FiberManualRecordRounded";
import PauseCircleOutlineRoundedIcon from "@mui/icons-material/PauseCircleOutlineRounded";
import PlayCircleOutlineRoundedIcon from "@mui/icons-material/PlayCircleOutlineRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import StopCircleRoundedIcon from "@mui/icons-material/StopCircleRounded";
import {
  Alert,
  Box,
  Button,
  Stack,
  Typography,
} from "@mui/material";
import { useRouter } from "next/navigation";
import { saveDraft } from "@/features/drafts/draft-store";
import { SkeletonOverlay } from "@/features/video-stage/components/SkeletonOverlay";
import { RecordingEffectsPicker } from "@/features/video-stage/components/RecordingEffectsPicker";
import { useHolisticLandmarker } from "@/features/video-stage/hooks/useHolisticLandmarker";
import { useRecordingEffectRenderer } from "@/features/video-stage/hooks/useRecordingEffectRenderer";
import {
  DEFAULT_BEAUTY_SETTINGS,
  type BeautySettings,
  type RecordingEffectId,
} from "@/features/video-stage/recording-effects";
import {
  averageVisibility,
  compareGeometry,
} from "@/features/video-stage/vision-geometry";
import type {
  SkeletonSnapshot,
  VisionComparisonPayload,
} from "@/features/video-stage/vision-types";
import {
  type VoiceCommandResult,
  VoiceControlPanel,
} from "@/features/voice-control";
import { getPopularDances } from "@/features/popular-dances/api";
import { getTeachingWorkspace } from "./api";
import FloatingAiCoach from "./components/FloatingAiCoach";
import LumiMotionIntro from "./components/LumiMotionIntro";
import MotionBreakdownOverlay from "./components/MotionBreakdownOverlay";
import MotionPreviewSequence from "./components/MotionPreviewSequence";
import {
  getMotionBreakdown,
  type CuratedMotionBreakdown,
} from "./motion-breakdown-api";
import { VlmStageFeedbackOverlay } from "./components/VlmFeedbackWidgets";
import { useVlmTeachingFeedback } from "./hooks/useVlmTeachingFeedback";
import { useTeachingRuntime } from "./hooks/useTeachingRuntime";
import {
  teachingMotionClipUrl,
  teachingMotionClipUrls,
} from "./motion-video-catalog";
import { buildNeutralFailurePrompt } from "./neutral-feedback-vocabulary";
import { executeRecordingVoiceCommand } from "./voiceCommandExecution";

type RecordingState = "idle" | "camera-ready" | "recording" | "recorded";
type LessonFlowStage = "overview" | "training" | "countdown" | "evaluation" | "feedback" | "completed";

interface LessonEvaluationResult {
  passed: boolean;
  score: number;
  headline: string;
  detail: string;
}

const FULL_FRAME_STREAK = 3;
const ACTION_COUNT = 4;
const TRAINING_PRE_FADE_MS = 360;
const TRAINING_POST_END_FADE_MS = 420;
const TRAINING_BLACK_GAP_MS = 1400;
const TRAINING_FADE_IN_MS = 520;
const EVALUATION_COUNTDOWN_SECONDS = 3;

function landmarkConfidence(
  landmark: SkeletonSnapshot["pose"][number] | undefined,
) {
  return landmark?.visibility ?? landmark?.presence ?? 0;
}

function handConfidence(hand: SkeletonSnapshot["leftHand"]) {
  if (hand.length < 15) return 0;
  return hand.reduce(
    (sum, landmark) => sum + landmarkConfidence(landmark),
    0,
  ) / hand.length;
}

function hasStableFullFrame(snapshot: SkeletonSnapshot) {
  const upperBody = [11, 12, 13, 14, 15, 16].every(
    (index) => landmarkConfidence(snapshot.pose[index]) >= 0.35,
  );
  return (
    upperBody &&
    handConfidence(snapshot.leftHand) >= 0.3 &&
    handConfidence(snapshot.rightHand) >= 0.3
  );
}

function getRecordingMimeType() {
  const candidates = [
    "video/webm;codecs=vp8",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? "";
}

export default function AITeachingPage({
  danceId,
  selectedDanceId,
  danceTitle,
  onboarding = false,
}: {
  danceId?: string;
  selectedDanceId?: string;
  danceTitle?: string;
  onboarding?: boolean;
}) {
  const activeDanceId = danceId ?? "dance-001";
  const roadshowMode = process.env.NEXT_PUBLIC_ROADSHOW_MODE === "true";
  const router = useRouter();
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const referenceVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewUrlRef = useRef<string | null>(null);
  const referenceUrlRef = useRef<string | null>(null);
  const animationRef = useRef<number | null>(null);
  const fullFrameStreakRef = useRef(0);
  const {
    load: loadVision,
    detect,
    state: visionState,
    error: visionError,
  } = useHolisticLandmarker();
  const [recordingState, setRecordingState] = useState<RecordingState>("idle");
  const [recordingEffect, setRecordingEffect] =
    useState<RecordingEffectId>("clear");
  const [beautySettings, setBeautySettings] =
    useState<BeautySettings>(DEFAULT_BEAUTY_SETTINGS);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [renderedReferenceUrl, setRenderedReferenceUrl] = useState("");
  const [selectedReferenceUrl, setSelectedReferenceUrl] = useState("");
  const [motionBreakdown, setMotionBreakdown] =
    useState<CuratedMotionBreakdown | null>(null);
  const [referencePlaybackTimeMs, setReferencePlaybackTimeMs] = useState(0);
  const [liveSkeleton, setLiveSkeleton] = useState<SkeletonSnapshot | null>(
    null,
  );
  const [referenceSkeleton, setReferenceSkeleton] =
    useState<SkeletonSnapshot | null>(null);
  const [comparison, setComparison] = useState<VisionComparisonPayload | null>(
    null,
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [lumiStage, setLumiStage] = useState<"intro" | "teaching">(
    onboarding ? "intro" : "teaching",
  );
  const [lessonFlowStage, setLessonFlowStage] =
    useState<LessonFlowStage>("overview");
  const [selectedLessonEndIndex, setSelectedLessonEndIndex] = useState<number | null>(null);
  const [trainingClipIndex, setTrainingClipIndex] = useState(0);
  const [evaluationCountdown, setEvaluationCountdown] = useState(EVALUATION_COUNTDOWN_SECONDS);
  const [recordingCountdown, setRecordingCountdown] = useState<number | null>(null);
  const [evaluationResult, setEvaluationResult] = useState<LessonEvaluationResult | null>(null);
  const [completedThroughIndex, setCompletedThroughIndex] = useState(-1);
  const lessonFlowStageRef = useRef<LessonFlowStage>("overview");
  const selectedLessonEndIndexRef = useRef<number | null>(null);
  const trainingTimerRef = useRef<number | null>(null);
  const trainingPreFadeTimerRef = useRef<number | null>(null);
  const countdownTimerRef = useRef<number | null>(null);
  const recordingCountdownTimerRef = useRef<number | null>(null);
  const evaluationVisibleFrameCountRef = useRef(0);
  const previousTrainingVideoUrlRef = useRef("");
  const referenceStageRef = useRef<HTMLDivElement>(null);
  const referenceTransitionTimerRef = useRef<number | null>(null);
  const {
    containerRef: effectCanvasContainerRef,
    getRecordingStream,
    rendererState,
  } = useRecordingEffectRenderer({
    sourceVideoRef: liveVideoRef,
    sourceStreamRef: streamRef,
    effect: recordingEffect,
    beauty: beautySettings,
    enabled:
      recordingState === "camera-ready" || recordingState === "recording",
  });
  const {
    actionIndex,
    applyFeedback,
    clearNotVisible,
    reaction: vlmReaction,
  } = useVlmTeachingFeedback();
  const {
    ingestSkeleton,
    handleVoiceResult,
    runtimeStatus,
    buildProgress,
    referenceVideoUrl,
    activePlaybackVideoUrl,
    lessonMotions,
  } = useTeachingRuntime({
    danceId: activeDanceId,
    referenceVideoRef,
    applyFeedback,
  });

  useEffect(() => {
    getTeachingWorkspace(activeDanceId).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "工作台加载失败。"),
    );
  }, [activeDanceId]);

  useEffect(() => {
    let active = true;
    getPopularDances()
      .then((response) => {
        const selectedDance = response.data.items.find(
          (item) => (item.runtimeDanceId ?? item.id) === activeDanceId,
        );
        if (active) setSelectedReferenceUrl(selectedDance?.coverUrl ?? "");
      })
      .catch(() => {
        if (active) setSelectedReferenceUrl("");
      });
    return () => {
      active = false;
    };
  }, [activeDanceId]);

  useEffect(() => {
    let active = true;
    getMotionBreakdown(activeDanceId)
      .then((breakdown) => {
        if (active) setMotionBreakdown(breakdown);
      })
      .catch(() => {
        if (active) setMotionBreakdown(null);
      });
    return () => {
      active = false;
    };
  }, [activeDanceId]);

  const overviewReferenceUrl =
    referenceUrl || referenceVideoUrl || `/dances/${activeDanceId}/reference.mp4` || selectedReferenceUrl;
  const motionClipUrls = useMemo(
    () => teachingMotionClipUrls(activeDanceId),
    [activeDanceId],
  );
  const selectedMotionEnd = selectedLessonEndIndex ?? 0;
  const currentMotionUrl =
    motionClipUrls[Math.min(trainingClipIndex, selectedMotionEnd)] ??
    teachingMotionClipUrl(activeDanceId, 0) ??
    "";
  const displayReferenceUrl =
    lessonFlowStage === "overview" || lessonFlowStage === "completed"
      ? overviewReferenceUrl
      : currentMotionUrl || activePlaybackVideoUrl || overviewReferenceUrl;
  const playbackReferenceUrl = renderedReferenceUrl || displayReferenceUrl;
  const activeMotionForCards =
    lessonFlowStage === "overview" || lessonFlowStage === "completed"
      ? null
      : trainingClipIndex;
  const motionLabels = useMemo(
    () =>
      Array.from({ length: ACTION_COUNT }, (_, index) =>
        motionBreakdown?.motions[index]?.label || `动作 ${index + 1}`,
      ),
    [motionBreakdown],
  );
  const currentMotionLabel = motionLabels[trainingClipIndex] ?? "当前动作";
  const selectedLessonLabel = `1-${selectedMotionEnd + 1}`;
  const phaseLabel = {
    overview: "主界面",
    training: "训练阶段",
    countdown: "准备评估",
    evaluation: "评估中",
    feedback: "评估反馈",
    completed: "完成教学",
  }[lessonFlowStage];
  const coachSpeech = (() => {
    if (lessonFlowStage === "overview") {
      return completedThroughIndex >= 0
        ? `第 ${completedThroughIndex + 1} 关已经通过，可以选择下一个动作继续。`
        : "点击任意动作开始教学。选第几个动作，就练习从 1 到它的动作组合。";
    }
    if (lessonFlowStage === "training") {
      return `正在训练第 ${selectedLessonLabel} 个动作组合。看左侧 ${currentMotionLabel}，学会后说“我学会了”进入评估。`;
    }
    if (lessonFlowStage === "countdown") {
      return `准备好，${evaluationCountdown} 秒后跟着左侧视频完整跳一遍。`;
    }
    if (lessonFlowStage === "evaluation") {
      return `跟住视频，把第 ${selectedLessonLabel} 个动作组合连起来。`;
    }
    if (lessonFlowStage === "feedback" && evaluationResult) {
      return evaluationResult.passed
        ? "很稳，这一关通过了。"
        : "这次还差一点，可以跳过回主界面，也可以直接从训练阶段再来。";
    }
    return "四个动作都完成了，可以开始录制你的完整版本。";
  })();

  useEffect(() => {
    const stage = referenceStageRef.current;
    if (referenceTransitionTimerRef.current) {
      window.clearTimeout(referenceTransitionTimerRef.current);
      referenceTransitionTimerRef.current = null;
    }

    if (!displayReferenceUrl) return;

    if (lessonFlowStage !== "training") {
      previousTrainingVideoUrlRef.current = "";
      stage?.classList.remove("is-video-fading-half", "is-video-fading-out", "is-video-transitioning");
      referenceTransitionTimerRef.current = window.setTimeout(() => {
        setRenderedReferenceUrl(displayReferenceUrl);
        referenceTransitionTimerRef.current = null;
      }, 0);
      return;
    }

    if (previousTrainingVideoUrlRef.current === displayReferenceUrl) return;
    const isFirstTrainingClip = previousTrainingVideoUrlRef.current === "";
    previousTrainingVideoUrlRef.current = displayReferenceUrl;

    if (isFirstTrainingClip) {
      referenceTransitionTimerRef.current = window.setTimeout(() => {
        setRenderedReferenceUrl(displayReferenceUrl);
        stage?.classList.add("is-video-transitioning");
        referenceTransitionTimerRef.current = window.setTimeout(() => {
          stage?.classList.remove("is-video-transitioning");
          referenceTransitionTimerRef.current = null;
        }, TRAINING_FADE_IN_MS);
      }, 0);
      return;
    }

    const alreadyFadedOut = stage?.classList.contains("is-video-fading-out") ?? false;
    stage?.classList.remove("is-video-transitioning");
    stage?.classList.add("is-video-fading-out");
    referenceTransitionTimerRef.current = window.setTimeout(() => {
      setRenderedReferenceUrl(displayReferenceUrl);
      stage?.classList.remove("is-video-fading-half", "is-video-fading-out");
      stage?.classList.add("is-video-transitioning");
      referenceTransitionTimerRef.current = window.setTimeout(() => {
        stage?.classList.remove("is-video-transitioning");
        referenceTransitionTimerRef.current = null;
      }, TRAINING_FADE_IN_MS);
    }, alreadyFadedOut ? 0 : TRAINING_POST_END_FADE_MS);
  }, [displayReferenceUrl, lessonFlowStage]);
  useEffect(() => {
    lessonFlowStageRef.current = lessonFlowStage;
    selectedLessonEndIndexRef.current = selectedLessonEndIndex;
  }, [lessonFlowStage, selectedLessonEndIndex]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewUrlRef.current) {
        previewVideoRef.current?.pause();
        previewVideoRef.current?.removeAttribute("src");
        previewVideoRef.current?.load();
        URL.revokeObjectURL(previewUrlRef.current);
      }
      if (referenceUrlRef.current) {
        referenceVideoRef.current?.pause();
        referenceVideoRef.current?.removeAttribute("src");
        referenceVideoRef.current?.load();
        URL.revokeObjectURL(referenceUrlRef.current);
      }
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      if (trainingTimerRef.current) window.clearTimeout(trainingTimerRef.current);
      if (trainingPreFadeTimerRef.current)
        window.clearTimeout(trainingPreFadeTimerRef.current);
      if (countdownTimerRef.current) window.clearTimeout(countdownTimerRef.current);
      if (recordingCountdownTimerRef.current)
        window.clearInterval(recordingCountdownTimerRef.current);
      if (referenceTransitionTimerRef.current)
        window.clearTimeout(referenceTransitionTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const liveVideo = liveVideoRef.current;
    const stream = streamRef.current;
    if (recordingState !== "camera-ready" || !liveVideo || !stream) return;

    liveVideo.srcObject = stream;
    void liveVideo.play().catch(() => {
      setError("摄像头画面无法播放，请重新打开摄像头。");
    });
  }, [recordingState]);

  useEffect(() => {
    if (visionState !== "ready" || recordingState === "idle" || previewUrl) {
      return;
    }

    let active = true;
    const tick = () => {
      const video = liveVideoRef.current;
      if (active && video?.readyState && !video.paused) {
        const result = detect(video);
        if (result) {
          setLiveSkeleton(result);
          ingestSkeleton(result);
          if (hasStableFullFrame(result)) {
            fullFrameStreakRef.current += 1;
            if (lessonFlowStageRef.current === "evaluation") {
              evaluationVisibleFrameCountRef.current += 1;
            }
            if (fullFrameStreakRef.current >= FULL_FRAME_STREAK) {
              clearNotVisible();
            }
          } else {
            fullFrameStreakRef.current = 0;
          }
        }
      }
      if (active) animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [
    clearNotVisible,
    detect,
    ingestSkeleton,
    previewUrl,
    recordingState,
    visionState,
  ]);

  const selectReference = (file?: File) => {
    if (!file) return;
    if (referenceUrlRef.current) {
      referenceVideoRef.current?.pause();
      referenceVideoRef.current?.removeAttribute("src");
      referenceVideoRef.current?.load();
      URL.revokeObjectURL(referenceUrlRef.current);
    }

    const url = URL.createObjectURL(file);
    referenceUrlRef.current = url;
    setReferenceUrl(url);
    setReferenceSkeleton(null);
    setComparison(null);
  };

  const canvasFrame = (video: HTMLVideoElement, mirrored: boolean) => {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth || 360;
    canvas.height = video.videoHeight || 640;
    const context = canvas.getContext("2d");
    if (!context) return "";

    if (mirrored) {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.82);
  };

  const captureComparison = () => {
    const reference = referenceVideoRef.current;
    const practice = liveVideoRef.current;
    if (!reference || !practice || visionState !== "ready") {
      setError("请先加载模型、参考视频并打开摄像头。");
      return;
    }

    const timestamp = performance.now();
    const referenceResult = detect(reference, timestamp);
    const practiceResult = detect(practice, timestamp + 1);
    if (!referenceResult || !practiceResult) {
      setError("当前帧未检测到完整人体，请调整站位后重试。");
      return;
    }

    setReferenceSkeleton(referenceResult);
    setLiveSkeleton(practiceResult);
    const now = Date.now();
    setComparison({
      schemaVersion: "vision-output-v0",
      sessionId: `session-${now}`,
      sampleId: `sample-${now}`,
      actionId: activeDanceId,
      motionId: "motion-manual-001",
      status: "COMPLETED",
      selectedReferenceId: "reference-manual-001",
      referenceFrame: {
        timestampMs: Math.round(reference.currentTime * 1000),
        imageDataUrl: canvasFrame(reference, false),
      },
      practiceFrame: {
        timestampMs: practiceResult.timestampMs,
        imageDataUrl: canvasFrame(practice, false),
      },
      landmarks: {
        reference: referenceResult,
        practice: practiceResult,
      },
      measurements: compareGeometry(referenceResult, practiceResult),
      quality: {
        bodyVisibility: averageVisibility(practiceResult.pose),
        leftHandVisibility: averageVisibility(practiceResult.leftHand),
        rightHandVisibility: averageVisibility(practiceResult.rightHand),
        alignmentConfidence: 1,
        mirrored: false,
      },
      metadata: {
        model: "mediapipe-holistic-landmarker",
        normalizationVersion: "skeleton-normalization-v1",
        alignmentVersion: "single-keyframe-v1",
      },
    });
    setError("");
  };

  const downloadComparison = () => {
    if (!comparison) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(comparison, null, 2)], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${comparison.sampleId}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const enterTeachingFromLumi = () => {
    const referenceVideo = referenceVideoRef.current;
    if (referenceVideo) {
      referenceVideo.pause();
      referenceVideo.currentTime = 0;
    }
    setLumiStage("teaching");
  };

  const startCamera = useCallback(async () => {
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持摄像头访问，请使用最新版 Chrome 或 Edge。");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;

      if (previewUrlRef.current) {
        previewVideoRef.current?.pause();
        previewVideoRef.current?.removeAttribute("src");
        previewVideoRef.current?.load();
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setPreviewUrl("");
      setRecordedBlob(null);
      setRecordingState("camera-ready");
      await loadVision();
    } catch {
      setError("无法打开摄像头，请检查浏览器摄像头权限。");
    }
  }, [loadVision]);

  const clearLessonTimers = useCallback(() => {
    if (trainingTimerRef.current) {
      window.clearTimeout(trainingTimerRef.current);
      trainingTimerRef.current = null;
    }
    if (countdownTimerRef.current) {
      window.clearTimeout(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    if (trainingPreFadeTimerRef.current) {
      window.clearTimeout(trainingPreFadeTimerRef.current);
      trainingPreFadeTimerRef.current = null;
    }
  }, []);

  const startTrainingFromMotion = useCallback(
    (motionIndex: number, startAtSelectedMotion = false) => {
      const targetIndex = Math.min(ACTION_COUNT - 1, Math.max(0, motionIndex));
      clearLessonTimers();
      setError("");
      setLumiStage("teaching");
      setEvaluationResult(null);
      setSelectedLessonEndIndex(targetIndex);
      setTrainingClipIndex(startAtSelectedMotion ? targetIndex : 0);
      setEvaluationCountdown(EVALUATION_COUNTDOWN_SECONDS);
      setLessonFlowStage("training");
      if (!streamRef.current) void startCamera();
    },
    [clearLessonTimers, startCamera],
  );
  const returnToOverview = useCallback(() => {
    clearLessonTimers();
    setLessonFlowStage("overview");
    setSelectedLessonEndIndex(null);
    setTrainingClipIndex(0);
    setEvaluationResult(null);
    setEvaluationCountdown(EVALUATION_COUNTDOWN_SECONDS);
    window.requestAnimationFrame(() => {
      const video = referenceVideoRef.current;
      if (!video) return;
      video.currentTime = 0;
      setReferencePlaybackTimeMs(0);
      void video.play().catch(() => undefined);
    });
  }, [clearLessonTimers]);

  const retryCurrentTraining = useCallback(() => {
    const targetIndex = selectedLessonEndIndexRef.current ?? selectedMotionEnd;
    startTrainingFromMotion(targetIndex);
  }, [selectedMotionEnd, startTrainingFromMotion]);

  const beginEvaluation = useCallback(() => {
    if (selectedLessonEndIndexRef.current == null) {
      setError("请先选择一个动作开始训练。");
      return;
    }
    clearLessonTimers();
    setError("");
    setEvaluationResult(null);
    setTrainingClipIndex(0);
    setEvaluationCountdown(EVALUATION_COUNTDOWN_SECONDS);
    evaluationVisibleFrameCountRef.current = 0;
    setLessonFlowStage("countdown");
    if (!streamRef.current) void startCamera();
  }, [clearLessonTimers, startCamera]);

  const finishEvaluation = useCallback(() => {
    const targetIndex = selectedLessonEndIndexRef.current ?? selectedMotionEnd;
    const visibleFrames = evaluationVisibleFrameCountRef.current;
    const score = Math.min(100, Math.round(58 + visibleFrames * 3.2));
    const passed = visibleFrames >= 8;
    const neutralFailurePrompt = buildNeutralFailurePrompt({
      danceId: activeDanceId,
      actionIndex: targetIndex,
      limit: 3,
    });
    const result: LessonEvaluationResult = passed
      ? {
          passed: true,
          score,
          headline: `第 ${targetIndex + 1} 关通过`,
          detail: "动作和镜头里的身体状态都比较稳定，可以回主界面继续下一关。",
        }
      : {
          passed: false,
          score: Math.max(35, Math.min(score, 72)),
          headline: "这次还没过",
          detail: `${neutralFailurePrompt}你可以回到训练再看一轮，或先跳过。`,
        };

    setEvaluationResult(result);
    if (passed) {
      const completedIndex = Math.max(completedThroughIndex, targetIndex);
      setCompletedThroughIndex(completedIndex);
      setSelectedLessonEndIndex(null);
      setTrainingClipIndex(0);
      setLessonFlowStage(completedIndex >= ACTION_COUNT - 1 ? "completed" : "overview");
    } else {
      setLessonFlowStage("feedback");
    }
  }, [activeDanceId, completedThroughIndex, selectedMotionEnd]);
  useEffect(() => {
    if (lessonFlowStage !== "countdown") return;

    countdownTimerRef.current = window.setInterval(() => {
      setEvaluationCountdown((current) => {
        if (current <= 1) {
          if (countdownTimerRef.current) {
            window.clearInterval(countdownTimerRef.current);
            countdownTimerRef.current = null;
          }
          evaluationVisibleFrameCountRef.current = 0;
          setTrainingClipIndex(0);
          setLessonFlowStage("evaluation");
          return EVALUATION_COUNTDOWN_SECONDS;
        }
        return current - 1;
      });
    }, 1000);

    return () => {
      if (countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
  }, [lessonFlowStage]);
  useEffect(() => {
    const video = referenceVideoRef.current;
    if (!video || !playbackReferenceUrl) return;

    const stage = referenceStageRef.current;
    const autoPlay =
      lessonFlowStage === "overview" ||
      lessonFlowStage === "completed" ||
      lessonFlowStage === "training" ||
      lessonFlowStage === "evaluation";

    const clearTrainingPlaybackTimers = () => {
      if (trainingTimerRef.current) {
        window.clearTimeout(trainingTimerRef.current);
        trainingTimerRef.current = null;
      }
      if (trainingPreFadeTimerRef.current) {
        window.clearTimeout(trainingPreFadeTimerRef.current);
        trainingPreFadeTimerRef.current = null;
      }
    };

    const scheduleTrainingPreFade = () => {
      if (lessonFlowStage !== "training") return;
      if (trainingPreFadeTimerRef.current) {
        window.clearTimeout(trainingPreFadeTimerRef.current);
        trainingPreFadeTimerRef.current = null;
      }

      const durationMs = Number.isFinite(video.duration) && video.duration > 0
        ? video.duration * 1000
        : 0;
      if (!durationMs) return;

      const remainingMs = Math.max(0, durationMs - video.currentTime * 1000);
      const fadeDelayMs = Math.max(0, remainingMs - TRAINING_PRE_FADE_MS);
      trainingPreFadeTimerRef.current = window.setTimeout(() => {
        stage?.classList.remove("is-video-transitioning", "is-video-fading-out");
        stage?.classList.add("is-video-fading-half");
        trainingPreFadeTimerRef.current = null;
      }, fadeDelayMs);
    };

    const replayCurrentTrainingClip = () => {
      clearTrainingPlaybackTimers();
      video.currentTime = 0;
      stage?.classList.remove("is-video-fading-half", "is-video-fading-out");
      stage?.classList.add("is-video-transitioning");
      void video.play().catch(() => undefined);
      referenceTransitionTimerRef.current = window.setTimeout(() => {
        stage?.classList.remove("is-video-transitioning");
        referenceTransitionTimerRef.current = null;
      }, TRAINING_FADE_IN_MS);
      scheduleTrainingPreFade();
    };

    video.loop = lessonFlowStage === "overview" || lessonFlowStage === "completed";
    const silenceForLumiIntro = lumiStage === "intro";
    video.defaultMuted = silenceForLumiIntro;
    video.muted = silenceForLumiIntro;

    const desiredUrl = new URL(playbackReferenceUrl, window.location.href).href;
    if ((video.currentSrc || video.src) !== desiredUrl) {
      video.pause();
      video.src = playbackReferenceUrl;
      video.load();
    }
    video.currentTime = 0;

    if (autoPlay) {
      void video.play().then(scheduleTrainingPreFade).catch(() => undefined);
    } else {
      video.pause();
    }

    const handleLoadedMetadata = () => scheduleTrainingPreFade();
    const handlePlaying = () => scheduleTrainingPreFade();

    const handleEnded = () => {
      if (lessonFlowStage === "training") {
        clearTrainingPlaybackTimers();
        stage?.classList.remove("is-video-transitioning", "is-video-fading-half");
        stage?.classList.add("is-video-fading-out");
        trainingTimerRef.current = window.setTimeout(() => {
          if (trainingClipIndex >= selectedMotionEnd) {
            if (selectedMotionEnd === 0) {
              replayCurrentTrainingClip();
            } else {
              setTrainingClipIndex(0);
            }
            return;
          }
          setTrainingClipIndex((current) => current + 1);
        }, TRAINING_BLACK_GAP_MS + TRAINING_POST_END_FADE_MS);
        return;
      }

      if (lessonFlowStage === "evaluation") {
        if (trainingClipIndex < selectedMotionEnd) {
          setTrainingClipIndex((current) => current + 1);
        } else {
          finishEvaluation();
        }
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    video.addEventListener("playing", handlePlaying);
    video.addEventListener("ended", handleEnded);
    return () => {
      video.removeEventListener("loadedmetadata", handleLoadedMetadata);
      video.removeEventListener("playing", handlePlaying);
      video.removeEventListener("ended", handleEnded);
      clearTrainingPlaybackTimers();
    };
  }, [
    finishEvaluation,
    playbackReferenceUrl,
    lessonFlowStage,
    lumiStage,
    selectedMotionEnd,
    trainingClipIndex,
  ]);
  const startRecording = () => {
    const stream = getRecordingStream();
    if (!stream || typeof MediaRecorder === "undefined") {
      setError("请先打开摄像头，或更换支持 MediaRecorder 的浏览器。");
      return;
    }

    if (previewUrlRef.current) {
      previewVideoRef.current?.pause();
      previewVideoRef.current?.removeAttribute("src");
      previewVideoRef.current?.load();
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl("");
    setRecordedBlob(null);
    chunksRef.current = [];
    const mimeType = getRecordingMimeType();
    const recorder = new MediaRecorder(
      stream,
      mimeType ? { mimeType } : undefined,
    );
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || "video/webm",
      });

      if (blob.size === 0) {
        setRecordedBlob(null);
        setPreviewUrl("");
        setRecordingState("camera-ready");
        setError("没有录制到有效视频，请检查摄像头后重新录制。");
        return;
      }

      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setRecordedBlob(blob);
      setPreviewUrl(url);
      setRecordingState("recorded");
    };
    recorder.start(250);
    setRecordingState("recording");

    if (lessonFlowStage === "overview" || lessonFlowStage === "completed") {
      const referenceVideo = referenceVideoRef.current;
      if (referenceVideo) {
        referenceVideo.currentTime = 0;
        setReferencePlaybackTimeMs(0);
        void referenceVideo.play().catch(() => undefined);
      }
    }
  };

  const beginRecordingCountdown = () => {
    if (recordingCountdownTimerRef.current || recordingCountdown !== null) return;
    if (!streamRef.current || typeof MediaRecorder === "undefined") {
      setError("请先打开摄像头，或更换支持 MediaRecorder 的浏览器。");
      return;
    }

    setError("");
    const referenceVideo = referenceVideoRef.current;
    if (referenceVideo) {
      referenceVideo.pause();
      referenceVideo.currentTime = 0;
      setReferencePlaybackTimeMs(0);
    }

    let remaining = EVALUATION_COUNTDOWN_SECONDS;
    setRecordingCountdown(remaining);
    recordingCountdownTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining > 0) {
        setRecordingCountdown(remaining);
        return;
      }

      if (recordingCountdownTimerRef.current) {
        window.clearInterval(recordingCountdownTimerRef.current);
        recordingCountdownTimerRef.current = null;
      }
      setRecordingCountdown(null);
      startRecording();
    }, 1000);
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  };

  const startRecordingFromVoice = async () => {
    if (recorderRef.current?.state === "recording") return;
    if (!streamRef.current) await startCamera();
    if (streamRef.current) beginRecordingCountdown();
  };

  const handlePageVoiceResult = (result: VoiceCommandResult) => {
    if (!result.accepted || !result.command.intent) return;

    if (result.command.intent === "START_EVALUATION") {
      beginEvaluation();
      return;
    }
    if (result.command.intent === "SKIP_TO_OVERVIEW") {
      returnToOverview();
      return;
    }
    if (result.command.intent === "RETRY_PRACTICE") {
      retryCurrentTraining();
      return;
    }

    const recordingHandled = executeRecordingVoiceCommand(result, {
      start: startRecordingFromVoice,
      stop: stopRecording,
    });
    if (recordingHandled) return;

    if (result.command.intent === "NEXT_ACTION") {
      const current = selectedLessonEndIndexRef.current;
      if (lessonFlowStage === "overview" || lessonFlowStage === "completed") {
        startTrainingFromMotion(Math.min(ACTION_COUNT - 1, completedThroughIndex + 1), true);
      } else if (current != null) {
        startTrainingFromMotion(Math.min(ACTION_COUNT - 1, current + 1), true);
      }
      return;
    }
    if (result.command.intent === "PREVIOUS_ACTION") {
      const current = selectedLessonEndIndexRef.current ?? trainingClipIndex;
      startTrainingFromMotion(Math.max(0, current - 1), true);
      return;
    }
    if (result.command.intent === "REPEAT_ACTION") {
      retryCurrentTraining();
      return;
    }
    if (result.command.intent === "RESTART_LESSON") {
      startTrainingFromMotion(0);
      return;
    }

    handleVoiceResult(result);
  };
  const storeDraft = async () => {
    if (!recordedBlob) return;
    setSaving(true);
    setError("");
    try {
      await saveDraft({
        danceId: activeDanceId,
        title: `手势舞练习 · ${activeDanceId}`,
        mimeType: recordedBlob.type || "video/webm",
        video: recordedBlob,
      });
      router.push("/drafts");
    } catch {
      setError("草稿保存失败，请确认浏览器允许本地存储。");
      setSaving(false);
    }
  };

  return (
    <Box
      className={`teaching-page lesson-flow-stage-${lessonFlowStage}${
        recordingCountdown !== null ? " is-recording-countdown" : ""
      }`}
    >
      <Box className="teaching-header teaching-header-spacer" aria-hidden="true" />

      {(visionState === "loading" || visionError) && (
        <Alert
          severity={visionError ? "error" : "info"}
          className="teaching-alert"
        >
          {visionError || "正在加载本地骨骼模型…"}
        </Alert>
      )}

      {runtimeStatus.state !== "idle" && (
        <Alert
          severity={runtimeStatus.state === "error" ? "error" : "info"}
          className="teaching-alert"
        >
          {runtimeStatus.message}
          {buildProgress && runtimeStatus.state === "preparing-dataset"
            ? `（${buildProgress.completedVideos}/${buildProgress.totalVideos}）`
            : ""}
        </Alert>
      )}

      {error && (
        <Alert severity="error" className="teaching-alert">
          {error}
        </Alert>
      )}

      <Box className="teaching-studio-workspace">
        <aside className="motion-thumbnail-rail" aria-label="四个关键动作">
          <MotionPreviewSequence
            mode="compact"
            videoUrl={overviewReferenceUrl}
            motions={motionBreakdown?.motions}
            activeMotionIndex={activeMotionForCards}
            onSelectMotion={(motionIndex) =>
              startTrainingFromMotion(
                motionIndex,
                lessonFlowStage === "training" || lessonFlowStage === "feedback",
              )
            }

          />
          <Button
            className="motion-overview-button"
            variant="outlined"
            onClick={returnToOverview}
            startIcon={<PlayCircleOutlineRoundedIcon />}
          >
            完整视频
          </Button>
        </aside>

        <Box className="studio-layout">
          <Box className="studio-column studio-column-reference">
            <Box className="studio-panel-header">
              <Typography variant="h6" fontWeight={850}>
                原手势舞
              </Typography>
            </Box>

            <Box className="studio-screen-area studio-screen-area-reference">
              <Box ref={referenceStageRef} className="phone-stage reference-phone">
                {playbackReferenceUrl ? (
                  <>
                    <video
                      ref={referenceVideoRef}
                      src={playbackReferenceUrl}
                      controls
                      autoPlay
                      loop={lessonFlowStage === "overview" || lessonFlowStage === "completed"}
                      muted={lumiStage === "intro"}
                      playsInline
                      preload="metadata"
                      onLoadedMetadata={(event) =>
                        setReferencePlaybackTimeMs(
                          Math.round(event.currentTarget.currentTime * 1000),
                        )
                      }
                      onTimeUpdate={(event) =>
                        setReferencePlaybackTimeMs(
                          Math.round(event.currentTarget.currentTime * 1000),
                        )
                      }
                    />
                    <SkeletonOverlay
                      snapshot={referenceSkeleton}
                      videoRef={referenceVideoRef}
                      mirrored={false}
                    />
                  </>
                ) : (
                  <>
                    <PauseCircleOutlineRoundedIcon />
                    <Typography fontWeight={800}>等待原视频</Typography>
                  </>
                )}
                <VlmStageFeedbackOverlay
                  actionIndex={actionIndex}
                  reaction={vlmReaction}
                  stage="reference"
                />
                 {lessonFlowStage !== "overview" && lessonFlowStage !== "completed" && (
                  <Box className="lesson-stage-badge">
                    <span>{phaseLabel}</span>
                    <strong>{currentMotionLabel}</strong>
                  </Box>
                )}
                {(lessonFlowStage === "countdown" || recordingCountdown !== null) && (
                  <Box className="lesson-countdown">
                    {recordingCountdown ?? evaluationCountdown}
                  </Box>
                )}
              </Box>
            </Box>

            <Stack
              className="studio-actions"
              direction="row"
              justifyContent="center"
              alignItems="center"
            >
              <Button component="label" variant="outlined">
                导入参考视频
                <input
                  hidden
                  type="file"
                  accept="video/*"
                  onChange={(event) => selectReference(event.target.files?.[0])}
                />
              </Button>
            </Stack>
          </Box>

          <Box className="studio-column studio-column-camera">
            <Box className="studio-panel-header">
              <Typography variant="h6" fontWeight={850}>
                跟练教学
              </Typography>
            </Box>

            <Box className="studio-screen-area studio-screen-area-camera">
              <Box className="phone-stage camera-stage">
                {previewUrl ? (
                  <video
                    ref={previewVideoRef}
                    src={previewUrl}
                    controls
                    playsInline
                    preload="none"
                  />
                ) : (
                  <>
                    <video
                      className="camera-feed-mirrored camera-source-video"
                      ref={liveVideoRef}
                      muted
                      playsInline
                    />
                    <Box
                      ref={effectCanvasContainerRef}
                      className="camera-effect-layer"
                      aria-hidden="true"
                    />
                    <SkeletonOverlay
                      snapshot={liveSkeleton}
                      videoRef={liveVideoRef}
                      mirrored={false}
                    />
                    {recordingState === "idle" && lessonFlowStage !== "completed" && (
                      <Stack className="camera-placeholder" alignItems="center">
                        <CameraswitchRoundedIcon />
                        <Typography fontWeight={800}>等待摄像头</Typography>
                      </Stack>
                    )}
                  </>
                )}
                {recordingState === "recording" && (
                  <Box className="recording-indicator">REC</Box>
                )}
                {motionBreakdown && (
                  <MotionBreakdownOverlay
                    motions={motionBreakdown.motions}
                    currentTimeMs={referencePlaybackTimeMs}
                  />
                )}
                {error && <Box className="stage-error">{error}</Box>}
                {!previewUrl && (
                  <RecordingEffectsPicker
                    value={recordingEffect}
                    onChange={setRecordingEffect}
                    beauty={beautySettings}
                    onBeautyChange={(key, value) =>
                      setBeautySettings((current) => ({
                        ...current,
                        [key]: value,
                      }))
                    }
                  />
                )}
                <VlmStageFeedbackOverlay
                  actionIndex={actionIndex}
                  reaction={vlmReaction}
                  stage="camera"
                />
              </Box>
            </Box>

            <Stack
              className="studio-actions"
              direction="row"
              justifyContent="center"
              alignItems="center"
              gap={1.2}
              flexWrap="wrap"
            >
              {lessonFlowStage === "training" && (
                <Button variant="contained" color="secondary" onClick={beginEvaluation}>
                  我学会了，开始评估
                </Button>
              )}
              {lessonFlowStage === "countdown" && (
                <Button variant="contained" disabled>
                  倒计时 {evaluationCountdown}
                </Button>
              )}
              {lessonFlowStage === "feedback" && (
                <Button variant="outlined" onClick={retryCurrentTraining}>
                  从训练再来
                </Button>
              )}
              {lessonFlowStage === "completed" && recordingState !== "recording" && (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={startRecordingFromVoice}
                  startIcon={<FiberManualRecordRoundedIcon />}
                >
                  开始录制完整版本
                </Button>
              )}
              {recordingState === "idle" && lessonFlowStage !== "completed" && (
                <Button
                  variant="contained"
                  onClick={startCamera}
                  startIcon={<CameraswitchRoundedIcon />}
                >
                  打开摄像头
                </Button>
              )}
              {recordingState === "camera-ready" && lessonFlowStage === "overview" && (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={beginRecordingCountdown}
                  disabled={rendererState === "loading" || recordingCountdown !== null}
                  startIcon={<FiberManualRecordRoundedIcon />}
                >
                  {recordingCountdown === null
                    ? "开始录制并启动 AI 教学"
                    : `倒计时 ${recordingCountdown}`}
                </Button>
              )}
              {recordingState === "recording" && (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={stopRecording}
                  startIcon={<StopCircleRoundedIcon />}
                >
                  停止录制
                </Button>
              )}
              {recordingState === "recorded" && (
                <>
                  <Button
                    variant="contained"
                    onClick={storeDraft}
                    disabled={saving}
                    startIcon={<SaveRoundedIcon />}
                  >
                    {saving ? "保存中…" : "保存到草稿箱"}
                  </Button>
                  <Button variant="outlined" onClick={startCamera}>
                    重新录制
                  </Button>
                </>
              )}
              {!roadshowMode && (
                <Button
                  variant="outlined"
                  className="studio-development-control"
                  onClick={captureComparison}
                  disabled={
                    !playbackReferenceUrl ||
                    visionState !== "ready" ||
                    recordingState === "idle" ||
                    Boolean(previewUrl)
                  }
                >
                  开发调试：冻结当前对齐帧
                </Button>
              )}
              {comparison && (
                <Button variant="outlined" onClick={downloadComparison}>
                  导出 JSON
                </Button>
              )}
              <Box className="studio-voice-control">
                <VoiceControlPanel
                  autoListen={lessonFlowStage === "training"}
                  onCommandRecognized={handlePageVoiceResult}
                />
              </Box>
            </Stack>
          </Box>
        </Box>

        {lumiStage === "teaching" && (
          <FloatingAiCoach
            introOpen={false}
            danceTitle={danceTitle ?? selectedDanceId ?? activeDanceId}
            motions={lessonMotions}
            phaseLabel={phaseLabel}
            speech={coachSpeech}
            review={evaluationResult}
            onFinishIntro={() => undefined}
          />
        )}
        {lumiStage === "intro" && (
          <LumiMotionIntro
            danceId={selectedDanceId ?? activeDanceId}
            motions={motionBreakdown?.motions}
            onStart={enterTeachingFromLumi}
          />
        )}
      </Box>
    </Box>
  );
}
