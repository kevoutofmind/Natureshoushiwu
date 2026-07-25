"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import StopCircleRoundedIcon from "@mui/icons-material/StopCircleRounded";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Snackbar,
  Stack,
  Typography,
} from "@mui/material";
import { interpretVoiceCommand } from "../api";
import { useBrowserSpeechRecognition } from "../hooks/useBrowserSpeechRecognition";
import type { VoiceCommandResult } from "../types";

import { matchActionNavigationVoiceIntent } from '../immediateVoiceCommands';

interface VoiceControlPanelProps {
  autoListen?: boolean;
  onCommandRecognized?: (result: VoiceCommandResult) => void;
}

export default function VoiceControlPanel({
  autoListen = false,
  onCommandRecognized,
}: VoiceControlPanelProps) {
  const autoStartedRef = useRef(false);
  const requestQueueRef = useRef(Promise.resolve());
  const pendingRequestCountRef = useRef(0);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastResult, setLastResult] = useState<VoiceCommandResult | null>(null);
  const [requestError, setRequestError] = useState("");

  const processTranscript = useCallback(
    async (transcript: string) => {
      const trimmedTranscript = transcript.trim();
      if (!trimmedTranscript) return;

      setLastTranscript(trimmedTranscript);
      const localActionIntent =
        matchActionNavigationVoiceIntent(trimmedTranscript);
      if (localActionIntent) {
        const localResult: VoiceCommandResult = {
          accepted: true,
          command: {
            transcript: trimmedTranscript,
            normalizedTranscript: trimmedTranscript,
            intent: localActionIntent,
            confidence: 1,
            parameters: {},
          },
          label: '动作导航',
          responseText: actionNavigationResponse(localActionIntent),
          executionStatus: 'not-dispatched',
        };
        setRequestError('');
        setLastResult(localResult);
        onCommandRecognized?.(localResult);
        return;
      }
      pendingRequestCountRef.current += 1;
      setProcessing(true);
      setRequestError("");

      requestQueueRef.current = requestQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const response = await interpretVoiceCommand(trimmedTranscript);
            setLastResult(response.data);
            onCommandRecognized?.(response.data);
          } catch (reason) {
            setRequestError(
              reason instanceof Error
                ? reason.message
                : "语音指令解析服务暂时不可用。",
            );
          } finally {
            pendingRequestCountRef.current = Math.max(
              0,
              pendingRequestCountRef.current - 1,
            );
            setProcessing(pendingRequestCountRef.current > 0);
          }
        });

      await requestQueueRef.current;
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

  useEffect(() => {
    if (
      autoListen &&
      !manuallyPaused &&
      isSupported &&
      !isListening &&
      !processing
    ) {
      autoStartedRef.current = true;
      startListening();
      return;
    }
    if (!autoListen) {
      if (autoStartedRef.current) {
        autoStartedRef.current = false;
        stopListening();
      }
    }
  }, [
    autoListen,
    isListening,
    isSupported,
    manuallyPaused,
    processing,
    startListening,
    stopListening,
  ]);

  const hasTranscript = Boolean(interimTranscript || lastTranscript);
  const showStatusPanel =
    !isSupported ||
    Boolean(recognitionError) ||
    isListening ||
    processing ||
    hasTranscript ||
    Boolean(lastResult);

  return (
    <>
      <Stack gap={1.25}>
        <Stack direction={{ xs: "column", sm: "row" }} gap={1}>
          <Button
            fullWidth
            variant="contained"
            color="secondary"
            startIcon={
              isListening ? (
                <CircularProgress size={18} color="inherit" />
              ) : (
                <MicRoundedIcon />
              )
            }
            onClick={() => {
              autoStartedRef.current = false;
              setManuallyPaused(false);
              if (!isListening) startListening();
            }}
            disabled={!isSupported || processing}
            className="voice-input-button"
          >
            {isListening ? "正在持续监听" : "开启语音控制"}
          </Button>

          {isListening && (
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<StopCircleRoundedIcon />}
              onClick={() => {
                autoStartedRef.current = false;
                setManuallyPaused(true);
                stopListening();
              }}
              sx={{ flexShrink: 0 }}
            >
              关闭
            </Button>
          )}
        </Stack>

        {showStatusPanel && (
          <Stack gap={1}>
            {!isSupported && (
              <Alert severity="warning">
                当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge。
              </Alert>
            )}

            {recognitionError && (
              <Alert severity="error">{recognitionError}</Alert>
            )}

            {(isListening || processing || hasTranscript) && (
              <Box
                sx={{
                  minHeight: 68,
                  border: "1px solid",
                  borderColor: "divider",
                  borderRadius: 2,
                  px: 2,
                  py: 1.25,
                }}
              >
                <Typography variant="caption" color="text.secondary">
                  识别文字
                </Typography>
                <Typography mt={0.5} fontWeight={750}>
                  {interimTranscript ||
                    lastTranscript ||
                    "请直接说出指令，例如：慢一点"}
                </Typography>
              </Box>
            )}

            {processing && (
              <Stack direction="row" alignItems="center" gap={1}>
                <CircularProgress size={18} />
                <Typography variant="body2">正在解析指令…</Typography>
              </Stack>
            )}

            {lastResult && !processing && (
              <Alert severity={lastResult.accepted ? "success" : "info"}>
                <Typography fontWeight={850}>
                  {lastResult.responseText}
                </Typography>
              </Alert>
            )}
          </Stack>
        )}
      </Stack>

      <Snackbar
        open={Boolean(requestError)}
        autoHideDuration={3600}
        onClose={() => setRequestError("")}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert severity="error" onClose={() => setRequestError("")}>
          {requestError}
        </Alert>
      </Snackbar>
    </>
  );
}

function actionNavigationResponse(intent: VoiceCommandResult['command']['intent']) {
  switch (intent) {
    case 'PREVIOUS_ACTION':
      return '好的，播放上一个动作。';
    case 'REPEAT_ACTION':
      return '没关系，我们把当前动作再看一遍。';
    case 'NEXT_ACTION':
      return '好的，播放下一个动作。';
    case 'RESTART_LESSON':
      return '好的，从第一个动作重新开始。';
    case 'START_EVALUATION':
      return '好的，进入评估。';
    case 'SKIP_TO_OVERVIEW':
      return '好的，回到主界面。';
    case 'RETRY_PRACTICE':
      return '好的，我们从训练再来一遍。';
    default:
      return '好的，继续练习。';
  }
}
