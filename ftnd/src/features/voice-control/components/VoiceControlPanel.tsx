'use client';

import { useCallback, useState } from 'react';
import MicRoundedIcon from '@mui/icons-material/MicRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import StopCircleRoundedIcon from '@mui/icons-material/StopCircleRounded';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { interpretVoiceCommand } from '../api';
import { useBrowserSpeechRecognition } from '../hooks/useBrowserSpeechRecognition';
import type { VoiceCommandResult } from '../types';

const supportedCommandExamples = [
  '暂停',
  '继续播放',
  '慢一点',
  '快一点',
  '调到 0.5 倍',
  '倒回 5 秒',
  '重新播放',
  '开始录制',
  '停止录制',
];

interface VoiceControlPanelProps {
  onCommandRecognized?: (result: VoiceCommandResult) => void;
}

export default function VoiceControlPanel({
  onCommandRecognized,
}: VoiceControlPanelProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [manualTranscript, setManualTranscript] = useState('');
  const [lastTranscript, setLastTranscript] = useState('');
  const [lastResult, setLastResult] = useState<VoiceCommandResult | null>(null);
  const [requestError, setRequestError] = useState('');

  const processTranscript = useCallback(
    async (transcript: string) => {
      const trimmedTranscript = transcript.trim();
      if (!trimmedTranscript) return;

      setLastTranscript(trimmedTranscript);
      setProcessing(true);
      setRequestError('');

      try {
        const response = await interpretVoiceCommand(trimmedTranscript);
        setLastResult(response.data);
        onCommandRecognized?.(response.data);
      } catch (reason) {
        setRequestError(
          reason instanceof Error
            ? reason.message
            : '语音指令解析服务暂时不可用。',
        );
      } finally {
        setProcessing(false);
      }
    },
    [onCommandRecognized],
  );

  const {
    isSupported,
    isListening,
    interimTranscript,
    error: recognitionError,
    startListening,
    stopListening,
  } = useBrowserSpeechRecognition({
    onFinalTranscript: processTranscript,
  });

  const openVoicePanel = () => {
    setDialogOpen(true);
    if (!isListening) startListening();
  };

  const closeVoicePanel = () => {
    stopListening();
    setDialogOpen(false);
  };

  const submitManualTranscript = () => {
    void processTranscript(manualTranscript);
    setManualTranscript('');
  };

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<MicRoundedIcon />}
        onClick={openVoicePanel}
        className="voice-input-button"
      >
        {isListening ? '正在监听' : '语音输入'}
      </Button>

      <Dialog
        open={dialogOpen}
        onClose={closeVoicePanel}
        fullWidth
        maxWidth="sm"
        aria-labelledby="voice-control-dialog-title"
      >
        <DialogTitle id="voice-control-dialog-title">
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            gap={2}
          >
            <Typography component="span" variant="h6" fontWeight={900}>
              语音指令
            </Typography>
            <Chip
              size="small"
              color={isListening ? 'primary' : 'default'}
              label={
                processing
                  ? '解析中'
                  : isListening
                    ? '持续监听'
                    : '已停止'
              }
            />
          </Stack>
        </DialogTitle>

        <DialogContent>
          <Stack gap={2}>
            {!isSupported && (
              <Alert severity="warning">
                当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge，或使用下方文字测试。
              </Alert>
            )}

            {recognitionError && (
              <Alert severity="error">{recognitionError}</Alert>
            )}

            <Box
              sx={{
                minHeight: 76,
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                px: 2,
                py: 1.5,
              }}
            >
              <Typography variant="caption" color="text.secondary">
                {isListening ? '请说出指令' : '识别文本'}
              </Typography>
              <Typography mt={0.5} fontWeight={750}>
                {interimTranscript ||
                  lastTranscript ||
                  '例如：暂停、倒回五秒、调到零点五倍'}
              </Typography>
            </Box>

            {processing && (
              <Stack direction="row" alignItems="center" gap={1}>
                <CircularProgress size={18} />
                <Typography variant="body2">正在解析指令…</Typography>
              </Stack>
            )}

            {lastResult && !processing && (
              <Alert severity={lastResult.accepted ? 'success' : 'info'}>
                <Typography fontWeight={850}>
                  {lastResult.responseText}
                </Typography>
              </Alert>
            )}

            <Divider />

            <Stack direction={{ xs: 'column', sm: 'row' }} gap={1}>
              <TextField
                fullWidth
                size="small"
                label="文字测试"
                placeholder="输入“倒回五秒”"
                value={manualTranscript}
                onChange={(event) => setManualTranscript(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') submitManualTranscript();
                }}
                inputProps={{ maxLength: 200 }}
              />
              <Button
                variant="contained"
                startIcon={<SendRoundedIcon />}
                disabled={!manualTranscript.trim() || processing}
                onClick={submitManualTranscript}
              >
                测试
              </Button>
            </Stack>

            <Stack direction="row" gap={0.75} flexWrap="wrap">
              {supportedCommandExamples.map((command) => (
                <Chip
                  key={command}
                  label={command}
                  size="small"
                  variant="outlined"
                  onClick={() => void processTranscript(command)}
                />
              ))}
            </Stack>
          </Stack>
        </DialogContent>

        <DialogActions>
          {isListening ? (
            <Button
              color="secondary"
              startIcon={<StopCircleRoundedIcon />}
              onClick={stopListening}
            >
              停止监听
            </Button>
          ) : (
            <Button
              startIcon={<MicRoundedIcon />}
              disabled={!isSupported}
              onClick={startListening}
            >
              开始监听
            </Button>
          )}
          <Button onClick={closeVoicePanel}>关闭</Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(requestError)}
        autoHideDuration={3600}
        onClose={() => setRequestError('')}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="error"
          onClose={() => setRequestError('')}
        >
          {requestError}
        </Alert>
      </Snackbar>
    </>
  );
}
