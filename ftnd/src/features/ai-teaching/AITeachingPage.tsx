'use client';

import { useEffect, useRef, useState } from 'react';
import CameraswitchRoundedIcon from '@mui/icons-material/CameraswitchRounded';
import FiberManualRecordRoundedIcon from '@mui/icons-material/FiberManualRecordRounded';
import PauseCircleOutlineRoundedIcon from '@mui/icons-material/PauseCircleOutlineRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import StopCircleRoundedIcon from '@mui/icons-material/StopCircleRounded';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { saveDraft } from '@/features/drafts/draft-store';
import { VoiceControlPanel } from '@/features/voice-control';
import { getTeachingWorkspace } from './api';

type RecordingState = 'idle' | 'camera-ready' | 'recording' | 'recorded';

function getRecordingMimeType() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

export default function AITeachingPage({ danceId }: { danceId?: string }) {
  const router = useRouter();
  const liveVideoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const previewUrlRef = useRef<string | null>(null);
  const [recordingState, setRecordingState] =
    useState<RecordingState>('idle');
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getTeachingWorkspace(danceId)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : '工作台加载失败。'),
      );
  }, [danceId]);

  useEffect(
    () => () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    },
    [],
  );

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
      if (liveVideoRef.current) {
        liveVideoRef.current.srcObject = stream;
        await liveVideoRef.current.play();
      }
      setRecordingState('camera-ready');
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

      {error && (
        <Alert severity="error" className="teaching-alert">
          {error}
        </Alert>
      )}

      <Box className="studio-layout">
        <Paper className="feature-panel studio-panel" elevation={0}>
          <Stack
            className="studio-panel-header"
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="h6" fontWeight={850}>
              原手势舞
            </Typography>
            <Chip label="等待视频" size="small" variant="outlined" />
          </Stack>

          <Box className="studio-screen-area">
            <Box className="phone-stage reference-phone">
              <PauseCircleOutlineRoundedIcon />
              <Typography fontWeight={800}>等待原视频</Typography>
            </Box>
          </Box>

          <Box className="studio-actions" aria-hidden="true" />
        </Paper>

        <Paper className="feature-panel studio-panel" elevation={0}>
          <Stack
            className="studio-panel-header"
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Typography variant="h6" fontWeight={850}>
              跟练录制
            </Typography>
          </Stack>

          <Box className="studio-screen-area">
            <Box className="phone-stage camera-stage">
              {previewUrl ? (
                <video src={previewUrl} controls playsInline />
              ) : (
                <>
                  <video ref={liveVideoRef} muted playsInline />
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
            <VoiceControlPanel />
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
}
