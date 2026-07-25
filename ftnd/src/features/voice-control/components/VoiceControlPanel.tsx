"use client";

import { useCallback, useState } from "react";
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
  onCommandRecognized?: (result: VoiceCommandResult) => void;
}

export default function VoiceControlPanel({
  onCommandRecognized,
}: VoiceControlPanelProps) {
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
      setProcessing(true);
      setRequestError("");

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
              onClick={stopListening}
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
    default:
      return '好的，继续练习。';
  }
}
