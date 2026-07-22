'use client';

import { useEffect, useRef, useState } from 'react';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CameraswitchRoundedIcon from '@mui/icons-material/CameraswitchRounded';
import FiberManualRecordRoundedIcon from '@mui/icons-material/FiberManualRecordRounded';
import ForumRoundedIcon from '@mui/icons-material/ForumRounded';
import GraphicEqRoundedIcon from '@mui/icons-material/GraphicEqRounded';
import PauseCircleOutlineRoundedIcon from '@mui/icons-material/PauseCircleOutlineRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import StopCircleRoundedIcon from '@mui/icons-material/StopCircleRounded';
import TimelineRoundedIcon from '@mui/icons-material/TimelineRounded';
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { saveDraft } from '@/features/drafts/draft-store';
import { SkeletonOverlay } from '@/features/video-stage/components/SkeletonOverlay';
import { useHolisticLandmarker } from '@/features/video-stage/hooks/useHolisticLandmarker';
import {
  averageVisibility,
  compareGeometry,
  mirrorSkeleton,
} from '@/features/video-stage/vision-geometry';
import type {
  SkeletonSnapshot,
  VisionComparisonPayload,
} from '@/features/video-stage/vision-types';
import { VoiceControlPanel } from '@/features/voice-control';
import { getTeachingWorkspace } from './api';
import TeachingSidePanel from './components/TeachingSidePanel';
import {
  VlmCoachFeedback,
  VlmProgressFeedback,
  VlmStageFeedbackOverlay,
} from './components/VlmFeedbackWidgets';
import { useVlmTeachingFeedback } from './hooks/useVlmTeachingFeedback';

type RecordingState = 'idle' | 'camera-ready' | 'recording' | 'recorded';

function getRecordingMimeType() {
  const candidates = [
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

export default function AITeachingPage({ danceId }: { danceId?: string }) {
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
  const {
    load: loadVision,
    detect,
    state: visionState,
    error: visionError,
  } = useHolisticLandmarker();
  const [recordingState, setRecordingState] =
    useState<RecordingState>('idle');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [liveSkeleton, setLiveSkeleton] =
    useState<SkeletonSnapshot | null>(null);
  const [referenceSkeleton, setReferenceSkeleton] =
    useState<SkeletonSnapshot | null>(null);
  const [comparison, setComparison] =
    useState<VisionComparisonPayload | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const { actionIndex, reaction: vlmReaction } = useVlmTeachingFeedback();

  useEffect(() => {
    getTeachingWorkspace(danceId).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : '工作台加载失败。'),
    );
  }, [danceId]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewUrlRef.current) {
        previewVideoRef.current?.pause();
        previewVideoRef.current?.removeAttribute('src');
        previewVideoRef.current?.load();
        URL.revokeObjectURL(previewUrlRef.current);
      }
      if (referenceUrlRef.current) {
        referenceVideoRef.current?.pause();
        referenceVideoRef.current?.removeAttribute('src');
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
    if (recordingState !== 'camera-ready' || !liveVideo || !stream) return;

    liveVideo.srcObject = stream;
    void liveVideo.play().catch(() => {
      setError('摄像头画面无法播放，请重新打开摄像头。');
    });
  }, [recordingState]);

  useEffect(() => {
    if (
      visionState !== 'ready' ||
      recordingState === 'idle' ||
      previewUrl
    ) {
      return;
    }

    let active = true;
    const tick = () => {
      const video = liveVideoRef.current;
      if (active && video?.readyState && !video.paused) {
        const result = detect(video);
        if (result) setLiveSkeleton(result);
      }
      if (active) animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      active = false;
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [detect, previewUrl, recordingState, visionState]);

  const selectReference = (file?: File) => {
    if (!file) return;
    if (referenceUrlRef.current) {
      referenceVideoRef.current?.pause();
      referenceVideoRef.current?.removeAttribute('src');
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
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 360;
    canvas.height = video.videoHeight || 640;
    const context = canvas.getContext('2d');
    if (!context) return '';

    if (mirrored) {
      context.translate(canvas.width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  };

  const captureComparison = () => {
    const reference = referenceVideoRef.current;
    const practice = liveVideoRef.current;
    if (!reference || !practice || visionState !== 'ready') {
      setError('请先加载模型、参考视频并打开摄像头。');
      return;
    }

    const timestamp = performance.now();
    const referenceResult = detect(reference, timestamp);
    const practiceResult = detect(practice, timestamp + 1);
    if (!referenceResult || !practiceResult) {
      setError('当前帧未检测到完整人体，请调整站位后重试。');
      return;
    }

    const mirroredPractice = mirrorSkeleton(practiceResult);
    setReferenceSkeleton(referenceResult);
    setLiveSkeleton(practiceResult);
    const now = Date.now();
    setComparison({
      schemaVersion: 'vision-output-v0',
      sessionId: `session-${now}`,
      sampleId: `sample-${now}`,
      actionId: danceId ?? 'unassigned-dance',
      motionId: 'motion-manual-001',
      status: 'COMPLETED',
      selectedReferenceId: 'reference-manual-001',
      referenceFrame: {
        timestampMs: Math.round(reference.currentTime * 1000),
        imageDataUrl: canvasFrame(reference, false),
      },
      practiceFrame: {
        timestampMs: practiceResult.timestampMs,
        imageDataUrl: canvasFrame(practice, true),
      },
      landmarks: {
        reference: referenceResult,
        practice: mirroredPractice,
      },
      measurements: compareGeometry(referenceResult, mirroredPractice),
      quality: {
        bodyVisibility: averageVisibility(practiceResult.pose),
        leftHandVisibility: averageVisibility(practiceResult.leftHand),
        rightHandVisibility: averageVisibility(practiceResult.rightHand),
        alignmentConfidence: 1,
        mirrored: true,
      },
      metadata: {
        model: 'mediapipe-holistic-landmarker',
        normalizationVersion: 'skeleton-normalization-v1',
        alignmentVersion: 'single-keyframe-v1',
      },
    });
    setError('');
  };

  const downloadComparison = () => {
    if (!comparison) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(comparison, null, 2)], {
        type: 'application/json',
      }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${comparison.sampleId}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const startCamera = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setError('当前浏览器不支持摄像头访问，请使用最新版 Chrome 或 Edge。');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user' },
        audio: false,
      });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;

      if (previewUrlRef.current) {
        previewVideoRef.current?.pause();
        previewVideoRef.current?.removeAttribute('src');
        previewVideoRef.current?.load();
        URL.revokeObjectURL(previewUrlRef.current);
        previewUrlRef.current = null;
      }
      setPreviewUrl('');
      setRecordedBlob(null);
      setRecordingState('camera-ready');
      await loadVision();
    } catch {
      setError('无法打开摄像头，请检查浏览器摄像头权限。');
    }
  };

  const startRecording = () => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') {
      setError('请先打开摄像头，或更换支持 MediaRecorder 的浏览器。');
      return;
    }

    if (previewUrlRef.current) {
      previewVideoRef.current?.pause();
      previewVideoRef.current?.removeAttribute('src');
      previewVideoRef.current?.load();
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
    setPreviewUrl('');
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
        type: recorder.mimeType || 'video/webm',
      });

      if (blob.size === 0) {
        setRecordedBlob(null);
        setPreviewUrl('');
        setRecordingState('camera-ready');
        setError('没有录制到有效视频，请检查摄像头后重新录制。');
        return;
      }

      const url = URL.createObjectURL(blob);
      previewUrlRef.current = url;
      setRecordedBlob(blob);
      setPreviewUrl(url);
      setRecordingState('recorded');
    };
    recorder.start(250);
    setRecordingState('recording');
  };

  const stopRecording = () => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop();
    }
  };

  const storeDraft = async () => {
    if (!recordedBlob) return;
    setSaving(true);
    setError('');
    try {
      await saveDraft({
        danceId: danceId ?? null,
        title: danceId ? `手势舞练习 · ${danceId}` : '自由练习',
        mimeType: recordedBlob.type || 'video/webm',
        video: recordedBlob,
      });
      router.push('/drafts');
    } catch {
      setError('草稿保存失败，请确认浏览器允许本地存储。');
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
          {danceId && <Chip label={`已选择：${danceId}`} size="small" />}
          <Chip
            size="small"
            label={recordingState === 'recording' ? '正在录制' : '本地录制'}
            color={recordingState === 'recording' ? 'secondary' : 'default'}
            icon={
              recordingState === 'recording' ? (
                <FiberManualRecordRoundedIcon />
              ) : undefined
            }
          />
        </Stack>
      </Stack>

      {(visionState === 'loading' || visionError) && (
        <Alert
          severity={visionError ? 'error' : 'info'}
          className="teaching-alert"
        >
          {visionError || '正在加载本地骨骼模型…'}
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
            <VlmProgressFeedback
              actionIndex={actionIndex}
              reaction={vlmReaction}
            />
          </TeachingSidePanel>
          <TeachingSidePanel title="动作拆解" icon={<AutoAwesomeRoundedIcon />}>
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
                {referenceUrl ? (
                  <>
                    <video
                      ref={referenceVideoRef}
                      src={referenceUrl}
                      controls
                      playsInline
                      preload="metadata"
                    />
                    <SkeletonOverlay
                      snapshot={referenceSkeleton}
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
                  onChange={(event) =>
                    selectReference(event.target.files?.[0])
                  }
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
                    <video ref={liveVideoRef} muted playsInline />
                    <SkeletonOverlay snapshot={liveSkeleton} />
                    {recordingState === 'idle' && (
                      <Stack className="camera-placeholder" alignItems="center">
                        <CameraswitchRoundedIcon />
                        <Typography fontWeight={800}>等待摄像头</Typography>
                      </Stack>
                    )}
                  </>
                )}
                {recordingState === 'recording' && (
                  <Box className="recording-indicator">REC</Box>
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
              {recordingState === 'idle' && (
                <Button
                  variant="contained"
                  onClick={startCamera}
                  startIcon={<CameraswitchRoundedIcon />}
                >
                  打开摄像头
                </Button>
              )}
              {recordingState === 'camera-ready' && (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={startRecording}
                  startIcon={<FiberManualRecordRoundedIcon />}
                >
                  开始录制
                </Button>
              )}
              {recordingState === 'recording' && (
                <Button
                  variant="contained"
                  color="secondary"
                  onClick={stopRecording}
                  startIcon={<StopCircleRoundedIcon />}
                >
                  停止录制
                </Button>
              )}
              {recordingState === 'recorded' && (
                <>
                  <Button
                    variant="contained"
                    onClick={storeDraft}
                    disabled={saving}
                    startIcon={<SaveRoundedIcon />}
                  >
                    {saving ? '保存中…' : '保存到草稿箱'}
                  </Button>
                  <Button variant="outlined" onClick={startCamera}>
                    重新录制
                  </Button>
                </>
              )}
              <Button
                variant="outlined"
                onClick={captureComparison}
                disabled={
                  !referenceUrl ||
                  visionState !== 'ready' ||
                  recordingState === 'idle' ||
                  Boolean(previewUrl)
                }
              >
                冻结对齐帧
              </Button>
              {comparison && (
                <Button variant="outlined" onClick={downloadComparison}>
                  导出 JSON
                </Button>
              )}
              <VoiceControlPanel />
            </Stack>
          </Box>
        </Box>

        <Stack className="teaching-side-rail" gap={1.5}>
          <TeachingSidePanel title="AI 教练" icon={<ForumRoundedIcon />}>
            <VlmCoachFeedback
              actionIndex={actionIndex}
              reaction={vlmReaction}
            />
          </TeachingSidePanel>
          <TeachingSidePanel title="语音记录" icon={<GraphicEqRoundedIcon />} />
        </Stack>
      </Box>
    </Box>
  );
}
