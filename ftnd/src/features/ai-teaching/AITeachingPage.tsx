"use client";

import { useEffect, useRef, useState } from "react";
import CameraswitchRoundedIcon from "@mui/icons-material/CameraswitchRounded";
import FiberManualRecordRoundedIcon from "@mui/icons-material/FiberManualRecordRounded";
import PauseCircleOutlineRoundedIcon from "@mui/icons-material/PauseCircleOutlineRounded";
import SaveRoundedIcon from "@mui/icons-material/SaveRounded";
import StopCircleRoundedIcon from "@mui/icons-material/StopCircleRounded";
import TroubleshootRoundedIcon from "@mui/icons-material/TroubleshootRounded";
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
import MotionBreakdownOverlay from "./components/MotionBreakdownOverlay";
import MotionPreviewSequence from "./components/MotionPreviewSequence";
import { SimilarityEngineeringDialog } from "./components/SimilarityEngineeringDialog";
import {
  getMotionBreakdown,
  type CuratedMotionBreakdown,
} from "./motion-breakdown-api";
import { VlmStageFeedbackOverlay } from "./components/VlmFeedbackWidgets";
import { useVlmTeachingFeedback } from "./hooks/useVlmTeachingFeedback";
import { useTeachingRuntime } from "./hooks/useTeachingRuntime";
import { executeRecordingVoiceCommand } from "./voiceCommandExecution";

type RecordingState = "idle" | "camera-ready" | "recording" | "recorded";

import { teachingMotionClipUrls } from './motion-video-catalog';

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
  onboarding = false,
}: {
  danceId?: string;
  selectedDanceId?: string;
  danceTitle?: string;
  onboarding?: boolean;
}) {
  const activeDanceId = danceId ?? "cat";
  const catalogDanceId = selectedDanceId ?? "dance-001";
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
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
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
  const [similarityDialogOpen, setSimilarityDialogOpen] = useState(false);
  const [lumiStage, setLumiStage] = useState<"intro" | "preview" | "teaching">(
    onboarding ? "intro" : "teaching",
  );
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
    runtimeStatus,
    buildProgress,
    referenceVideoUrl,
    activePlaybackVideoUrl,
    activeMotionClipIndex,
    playTeachingMotionClip,
    session: teachingSession,
    latestJudgeResult,
    latestSpeech,
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
    getMotionBreakdown(catalogDanceId)
      .then((breakdown) => {
        if (active) setMotionBreakdown(breakdown);
      })
      .catch(() => {
        if (active) setMotionBreakdown(null);
      });
    return () => {
      active = false;
    };
  }, [catalogDanceId]);

  const overviewReferenceUrl =
    referenceUrl || referenceVideoUrl || selectedReferenceUrl;
  const motionClipUrls = teachingMotionClipUrls(activeDanceId);
  const effectiveReferenceUrl =
    referenceUrl || activePlaybackVideoUrl || overviewReferenceUrl;
  const currentInstruction = teachingSession
    ? lessonMotions[teachingSession.currentMotionIndex]?.instruction
    : undefined;
  const phaseLabel = teachingSession
    ? {
        PREVIEW: "熟悉整舞",
        MOTION_DEMO: "老师示范",
        PRACTICE: "轮到你练",
        FULL_CHALLENGE: "连贯挑战",
        PAUSED: "稍作休息",
        COMPLETED: "本次完成",
      }[teachingSession.phase]
    : "尚未开始";

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

  const finishLumiIntro = () => {
    setLumiStage("preview");
  };

  const enterTeachingFromPreview = () => {
    const referenceVideo = referenceVideoRef.current;
    if (referenceVideo) {
      referenceVideo.pause();
      referenceVideo.currentTime = 0;
    }
    setLumiStage("teaching");
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

  const startRecording = () => {
    const stream = streamRef.current;
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
    const referenceVideo = referenceVideoRef.current;
    if (referenceVideo) {
      referenceVideo.currentTime = 0;
      referenceVideo.playbackRate = 1;
      referenceVideo.muted = false;
      void referenceVideo.play().catch(() => {
        setError("左侧示例视频无法自动播放，请点击视频后重试。");
      });
    }
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
    <Box className="teaching-page">
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
            motionVideoUrls={motionClipUrls}
            activeMotionIndex={activeMotionClipIndex}
            onSelectMotion={(motionIndex) => {
              setError('');
              void playTeachingMotionClip(motionIndex);
            }}
          />
        </aside>

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
                <VlmStageFeedbackOverlay
                  actionIndex={actionIndex}
                  reaction={vlmReaction}
                  stage="reference"
                />
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
                      className="camera-feed-mirrored"
                      ref={liveVideoRef}
                      muted
                      playsInline
                    />
                    <SkeletonOverlay
                      snapshot={liveSkeleton}
                      videoRef={liveVideoRef}
                      mirrored
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
                  <RecordingEffectsPicker />
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
              {recordingState === "idle" && (
                <Button
                  variant="contained"
                  onClick={startCamera}
                  startIcon={<CameraswitchRoundedIcon />}
                >
                  打开摄像头
                </Button>
              )}
              {recordingState === "camera-ready" && (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={startRecording}
                  startIcon={<FiberManualRecordRoundedIcon />}
                >
                  开始录制并启动 AI 教学
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
                    !effectiveReferenceUrl ||
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
              <Button
                variant="outlined"
                color="info"
                onClick={() =>
                  setSimilarityDialogOpen((current) => !current)
                }
                startIcon={<TroubleshootRoundedIcon />}
              >
                {similarityDialogOpen ? "关闭工程窗口" : "工程：轨迹相似度"}
                {latestJudgeResult
                  ? ` ${Math.round(
                      latestJudgeResult.scores.overall * 100,
                    )}%`
                  : ""}
              </Button>
              <Box className="studio-voice-control">
                <VoiceControlPanel
                  onCommandRecognized={handlePageVoiceResult}
                />
              </Box>
            </Stack>
          </Box>
        </Box>

        {lumiStage !== "preview" && (
          <FloatingAiCoach
            introOpen={lumiStage === "intro"}
            danceTitle={danceTitle ?? selectedDanceId ?? activeDanceId}
            motions={lessonMotions}
            phaseLabel={phaseLabel}
            speech={
              currentInstruction ??
              latestSpeech ??
              "我会陪你一步一步练，先看清手的位置。"
            }
            review={null}
            onFinishIntro={finishLumiIntro}
          />
        )}
        {lumiStage === "preview" && (
          <MotionPreviewSequence
            mode="overlay"
            videoUrl={overviewReferenceUrl}
            motions={motionBreakdown?.motions}
            motionVideoUrls={motionClipUrls}
            onContinue={enterTeachingFromPreview}
          />
        )}
        <SimilarityEngineeringDialog
          open={similarityDialogOpen}
          judge={latestJudgeResult}
        />
      </Box>
    </Box>
  );
}
