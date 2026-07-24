"use client";

import { useEffect, useRef, useState } from "react";
import CameraswitchRoundedIcon from "@mui/icons-material/CameraswitchRounded";
import FiberManualRecordRoundedIcon from "@mui/icons-material/FiberManualRecordRounded";
import PauseCircleOutlineRoundedIcon from "@mui/icons-material/PauseCircleOutlineRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import StopCircleRoundedIcon from "@mui/icons-material/StopCircleRounded";
import TimelineRoundedIcon from "@mui/icons-material/TimelineRounded";
import {
  Alert,
  Box,
  Button,
  Chip,
  LinearProgress,
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
import TeachingSidePanel from "./components/TeachingSidePanel";
import MotionBreakdownOverlay from "./components/MotionBreakdownOverlay";
import {
  getMotionBreakdown,
  type CuratedMotionBreakdown,
} from "./motion-breakdown-api";
import {
  VlmProgressFeedback,
  VlmStageFeedbackOverlay,
} from "./components/VlmFeedbackWidgets";
import { useVlmTeachingFeedback } from "./hooks/useVlmTeachingFeedback";
import { useTeachingRuntime } from "./hooks/useTeachingRuntime";
import { executeRecordingVoiceCommand } from "./voiceCommandExecution";

type RecordingState = "idle" | "camera-ready" | "recording" | "recorded";

const FULL_FRAME_STREAK = 3;

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
}: {
  danceId?: string;
  selectedDanceId?: string;
  danceTitle?: string;
}) {
  const activeDanceId = danceId ?? "dance-001";
  const selectedDanceLabel = danceTitle ?? selectedDanceId ?? activeDanceId;
  const draftDanceId = selectedDanceId ?? activeDanceId;
  const roadshowMode = process.env.NEXT_PUBLIC_ROADSHOW_MODE === "true";
  const router = useRouter();
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const referenceVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewUrlRef = useRef<string | null>(null);
  const animationRef = useRef<number | null>(null);
  const fullFrameStreakRef = useRef(0);
  const preparationStartedRef = useRef(false);
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
  const [introOpen, setIntroOpen] = useState(true);
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
    prepare: prepareTeaching,
    ingestSkeleton,
    handleVoiceResult,
    sendVoiceCommand,
    runtimeStatus,
    buildProgress,
    referenceVideoUrl,
    session: teachingSession,
    latestSpeech,
    lessonMotions,
    challengeStage,
    slowPracticeReview,
    replayWeakMotion,
    startFullSpeedChallenge,
    speak,
  } = useTeachingRuntime({
    danceId: activeDanceId,
    referenceVideoRef,
    applyFeedback,
  });

  useEffect(() => {
    if (preparationStartedRef.current) return;
    preparationStartedRef.current = true;
    speak(
      `欢迎来到手势舞教学，接下来我会全程陪伴你学习《${selectedDanceLabel}》。`,
    );
    void prepareTeaching();
  }, [prepareTeaching, selectedDanceLabel, speak]);

  useEffect(() => {
    getTeachingWorkspace(activeDanceId).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : "工作台加载失败。"),
    );
  }, [activeDanceId]);

  const coachSpeech = latestSpeech.replace(
    /手势舞\s*001/g,
    selectedDanceLabel,
  );
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

  const effectiveReferenceUrl = referenceVideoUrl || selectedReferenceUrl;
  const motionCount = lessonMotions.length;
  const completedMotionCount = teachingSession?.completedMotions.length ?? 0;
  const currentMotionNumber = teachingSession
    ? Math.min(teachingSession.currentMotionIndex + 1, Math.max(1, motionCount))
    : 0;
  const currentInstruction = teachingSession
    ? lessonMotions[teachingSession.currentMotionIndex]?.instruction
    : undefined;
  const lessonProgress =
    teachingSession?.phase === "COMPLETED"
      ? 100
      : motionCount > 0
        ? Math.round((completedMotionCount / motionCount) * 100)
        : 0;
  const phaseLabel = teachingSession
    ? {
        PREVIEW: "整舞预览",
        MOTION_DEMO: "分步学习",
        PRACTICE: "分步学习",
        FULL_CHALLENGE:
          challengeStage === "fast" ? "原速挑战" : "慢速连贯",
        PAUSED: "分步学习 · 暂停",
        COMPLETED: "课程完成",
      }[teachingSession.phase]
    : "整舞预览";
  const coachPhaseIndex =
    challengeStage === "fast" || challengeStage === "complete"
      ? 3
      : ["slow", "review", "targeted-replay"].includes(challengeStage)
        ? 2
        : teachingSession &&
            ["MOTION_DEMO", "PRACTICE", "PAUSED"].includes(
              teachingSession.phase,
            )
          ? 1
          : 0;
  const coachMessage =
    challengeStage === "slow"
      ? "这一遍不中断，跟住音乐做完；结束后我只说一个最值得改的点。"
      : challengeStage === "targeted-replay"
        ? "正在以 0.5 倍速度重看关键动作，先盯住刚才提示的细节。"
        : challengeStage === "fast"
          ? "原速挑战中，跟住音乐完成整支舞。"
          : challengeStage === "complete"
            ? "做得好，四个阶段已经全部完成。今天的动作已经真正连起来了。"
            : currentInstruction ||
              coachSpeech ||
              runtimeStatus.message;
  const showRealtimeFeedback =
    challengeStage === "idle" &&
    Boolean(
      teachingSession &&
        ["MOTION_DEMO", "PRACTICE"].includes(teachingSession.phase),
    );

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewUrlRef.current) {
        previewVideoRef.current?.pause();
        previewVideoRef.current?.removeAttribute("src");
        previewVideoRef.current?.load();
        URL.revokeObjectURL(previewUrlRef.current);
      }
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
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

  const startCamera = async () => {
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
  };

  const finishCoachIntro = () => {
    setIntroOpen(false);
    speak("准备好了，我们先跟着示范找到节奏。");
    void referenceVideoRef.current?.play().catch(() => undefined);
    if (recordingState === "idle") void startCamera();
  };

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
    if (
      !teachingSession &&
      runtimeStatus.state !== "preparing-dataset"
    ) {
      void prepareTeaching();
    }
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
  };

  const startRecordingFromVoice = async () => {
    if (recorderRef.current?.state === "recording") return;
    if (!streamRef.current) await startCamera();
    if (streamRef.current) startRecording();
  };

  const handlePageVoiceResult = (result: VoiceCommandResult) => {
    const recordingHandled = executeRecordingVoiceCommand(result, {
      start: startRecordingFromVoice,
      stop: stopRecording,
    });
    if (!recordingHandled) handleVoiceResult(result);
  };
  const storeDraft = async () => {
    if (!recordedBlob) return;
    setSaving(true);
    setError("");
    try {
      await saveDraft({
        danceId: draftDanceId,
        title: `${selectedDanceLabel}练习`,
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
    <Box className="teaching-page">
      <Stack
        className="teaching-header"
        direction="row"
        justifyContent="space-between"
        alignItems="center"
        gap={2}
      >
        <Typography component="h1" variant="h4" fontWeight={900}>
          AI 教学
        </Typography>
        <Stack direction="row" gap={1}>
          {(danceTitle || selectedDanceId || danceId) && (
            <Chip
              label={`已选择：${danceTitle ?? selectedDanceId ?? danceId}`}
              size="small"
            />
          )}
          <Chip
            size="small"
            label={recordingState === "recording" ? "正在录制" : "本地录制"}
            color={recordingState === "recording" ? "secondary" : "default"}
            icon={
              recordingState === "recording" ? (
                <FiberManualRecordRoundedIcon />
              ) : undefined
            }
          />
        </Stack>
      </Stack>

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
        <Stack className="teaching-side-rail" gap={1.5}>
          <TeachingSidePanel title="教学进度" icon={<TimelineRoundedIcon />}>
            <Stack gap={1.2}>
              <Typography variant="body2" color="text.secondary">
                今天按“预览—分步—慢速—原速”四步完成整支舞，预计 5
                分钟内完成。
              </Typography>
              <Stack direction="row" gap={0.6} flexWrap="wrap">
                {["整舞预览", "分步学习", "慢速连贯", "原速挑战"].map(
                  (label, index) => (
                    <Chip
                      key={label}
                      size="small"
                      label={`${index + 1}. ${label}`}
                      color={coachPhaseIndex === index ? "primary" : "default"}
                      variant={coachPhaseIndex >= index ? "filled" : "outlined"}
                    />
                  ),
                )}
              </Stack>
              <LinearProgress variant="determinate" value={lessonProgress} />
              <Typography variant="body2" fontWeight={800}>
                {motionCount > 0
                  ? `已掌握 ${completedMotionCount}/${motionCount} 个动作单元`
                  : "启动教学后，我会先为你整理动作路线。"}
              </Typography>
            </Stack>
            <VlmProgressFeedback
              actionIndex={actionIndex}
              reaction={vlmReaction}
            />
            <Stack
              gap={0.8}
              sx={{
                mt: 1.5,
                pt: 1.5,
                borderTop: "1px solid",
                borderColor: "divider",
              }}
            >
              <Typography fontWeight={850}>
                {currentMotionNumber > 0
                  ? `当前：动作 ${currentMotionNumber}/${motionCount}`
                  : "等待开始教学"}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {currentInstruction ??
                  "我会把每个动作控制在约 3 秒，并告诉你这一遍只需要关注什么。"}
              </Typography>
            </Stack>
            {comparison && (
              <Stack gap={1}>
                <Chip
                  size="small"
                  label={`${comparison.measurements.length} 项骨骼测量`}
                />
                <Typography variant="body2">
                  已生成当前参考帧与跟练帧的结构化对齐结果。
                </Typography>
              </Stack>
            )}
          </TeachingSidePanel>
        </Stack>

        <Box className="studio-layout">
          <Box className="studio-column studio-column-reference">
            <Box className="studio-panel-header">
              <Typography variant="h6" fontWeight={850}>
                原手势舞
              </Typography>
            </Box>

            <Box className="studio-screen-area studio-screen-area-reference">
              <Box className="phone-stage reference-phone">
                {effectiveReferenceUrl ? (
                  <>
                    <video
                      ref={referenceVideoRef}
                      src={effectiveReferenceUrl}
                      controls
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
                {showRealtimeFeedback && (
                  <VlmStageFeedbackOverlay
                    actionIndex={actionIndex}
                    reaction={vlmReaction}
                    stage="reference"
                  />
                )}
              </Box>
            </Box>

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
                    {recordingState === "idle" && (
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
                {showRealtimeFeedback && (
                  <VlmStageFeedbackOverlay
                    actionIndex={actionIndex}
                    reaction={vlmReaction}
                    stage="camera"
                  />
                )}
              </Box>
            </Box>

          </Box>
        </Box>

        <Box className="studio-control-dock" aria-label="教学控制">
          {recordingState === "idle" && (
            <Button
              size="small"
              variant="contained"
              onClick={() => void startCamera()}
              startIcon={<CameraswitchRoundedIcon />}
            >
              打开摄像头
            </Button>
          )}
          {recordingState === "camera-ready" && (
            <Button
              size="small"
              variant="contained"
              color="secondary"
              onClick={startRecording}
              disabled={rendererState === "loading"}
              startIcon={<FiberManualRecordRoundedIcon />}
            >
              开始录制
            </Button>
          )}
          {recordingState === "recording" && (
            <Button
              size="small"
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
                size="small"
                variant="contained"
                onClick={storeDraft}
                disabled={saving}
                startIcon={<SaveRoundedIcon />}
              >
                {saving ? "保存中…" : "保存到草稿箱"}
              </Button>
              <Button size="small" variant="outlined" onClick={startCamera}>
                重新录制
              </Button>
            </>
          )}
          <Box className="studio-voice-control">
            <VoiceControlPanel onCommandRecognized={handlePageVoiceResult} />
          </Box>
          {!roadshowMode && (
            <Button
              size="small"
              variant="outlined"
              onClick={captureComparison}
              disabled={
                !effectiveReferenceUrl ||
                visionState !== "ready" ||
                recordingState === "idle" ||
                Boolean(previewUrl)
              }
            >
              开发调试：对齐当前帧
            </Button>
          )}
          {comparison && (
            <Button
              size="small"
              variant="outlined"
              onClick={downloadComparison}
            >
              导出 JSON
            </Button>
          )}
        </Box>
      </Box>
      <FloatingAiCoach
        introOpen={introOpen}
        danceTitle={selectedDanceLabel}
        motions={lessonMotions}
        phaseLabel={phaseLabel}
        speech={coachMessage}
        review={challengeStage === "review" ? slowPracticeReview : null}
        onFinishIntro={finishCoachIntro}
      >
        {challengeStage === "review" && (
          <>
            {slowPracticeReview?.weakMotionIndex != null && (
              <Button
                size="small"
                variant="outlined"
                onClick={() => void replayWeakMotion()}
              >
                重看关键动作
              </Button>
            )}
            <Button
              size="small"
              variant="contained"
              onClick={() => void startFullSpeedChallenge()}
            >
              进入原速挑战
            </Button>
          </>
        )}
        {challengeStage === "complete" && (
          <Button
            size="small"
            variant="contained"
            onClick={() => void sendVoiceCommand("RESTART_LESSON")}
          >
            重新练习
          </Button>
        )}
      </FloatingAiCoach>
    </Box>
  );
}
