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
import { useWhisperSpeechRecognition } from "../hooks/useWhisperSpeechRecognition";
import { resolveLumiWakeTurn } from "../lumiWakeWord";
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
  const startedAutomaticallyRef = useRef(false);
  const wakeWindowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAwakeRef = useRef(false);
  const requestQueueRef = useRef(Promise.resolve());
  const pendingRequestCountRef = useRef(0);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [isAwake, setIsAwake] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastResult, setLastResult] = useState<VoiceCommandResult | null>(null);
  const [requestError, setRequestError] = useState("");

  const returnToStandby = useCallback(() => {
    isAwakeRef.current = false;
    setIsAwake(false);
    if (wakeWindowTimerRef.current) {
      clearTimeout(wakeWindowTimerRef.current);
      wakeWindowTimerRef.current = null;
    }
  }, []);

  const activateLumi = useCallback(() => {
    isAwakeRef.current = true;
    setIsAwake(true);
    if (wakeWindowTimerRef.current) {
      clearTimeout(wakeWindowTimerRef.current);
    }
    wakeWindowTimerRef.current = setTimeout(returnToStandby, 10000);
  }, [returnToStandby]);

  const executeTranscript = useCallback(
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
        returnToStandby();
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
            returnToStandby();
          }
        });

      await requestQueueRef.current;
    },
    [onCommandRecognized, returnToStandby],
  );

  const processTranscript = useCallback(
    async (transcript: string) => {
      const decision = resolveLumiWakeTurn(
        transcript,
        isAwakeRef.current,
      );
      if (decision.type === "standby") return;
      if (decision.type === "wake") {
        activateLumi();
        setLastTranscript("Lumi");
        setLastResult({
          accepted: true,
          command: {
            transcript: "Lumi",
            normalizedTranscript: "lumi",
            intent: null,
            confidence: 1,
            parameters: {},
          },
          label: "Lumi 已唤醒",
          responseText: "我在，请说出你的需求。",
          executionStatus: "not-dispatched",
        });
        return;
      }

      returnToStandby();
      await executeTranscript(decision.commandText);
    },
    [activateLumi, executeTranscript, returnToStandby],
  );

  const {
    isSupported,
    isListening,
    interimTranscript,
    error: recognitionError,
    startListening,
    stopListening,
  } = useWhisperSpeechRecognition({
    onFinalTranscript: processTranscript,
  });

  useEffect(() => {
    if (
      autoListen &&
      !manuallyPaused &&
      isSupported &&
      !isListening &&
      !recognitionError
    ) {
      startedAutomaticallyRef.current = true;
      void startListening();
      return;
    }
    if (!autoListen && startedAutomaticallyRef.current) {
      startedAutomaticallyRef.current = false;
      stopListening();
      returnToStandby();
    }
  }, [
    autoListen,
    isListening,
    isSupported,
    manuallyPaused,
    recognitionError,
    returnToStandby,
    startListening,
    stopListening,
  ]);

  useEffect(
    () => () => {
      if (wakeWindowTimerRef.current) {
        clearTimeout(wakeWindowTimerRef.current);
      }
    },
    [],
  );

  const hasTranscript = Boolean(
    lastTranscript || (isAwake && interimTranscript),
  );
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
              startedAutomaticallyRef.current = false;
              setManuallyPaused(false);
              if (!isListening) void startListening();
            }}
            disabled={!isSupported || processing}
            className="voice-input-button"
          >
            {isListening
              ? isAwake
                ? "Lumi 已唤醒，正在聆听"
                : "Lumi 待机中"
              : "开启 Lumi 实时监听"}
          </Button>

          {isListening && (
            <Button
              variant="outlined"
              color="secondary"
              startIcon={<StopCircleRoundedIcon />}
              onClick={() => {
                startedAutomaticallyRef.current = false;
                setManuallyPaused(true);
                stopListening();
                returnToStandby();
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
                当前浏览器不支持麦克风录音，请使用最新版 Chrome 或 Edge。
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
                  {isAwake ? "Lumi 已唤醒" : "Lumi 待机监听"}
                </Typography>
                <Typography mt={0.5} fontWeight={750}>
                  {isAwake
                    ? interimTranscript ||
                      lastTranscript ||
                      "我在，请说出你的需求。"
                    : '待机中，请说“Lumi”唤醒'}
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
    case 'SHOW_SKELETON':
      return '好的，已显示骨架。';
    case 'HIDE_SKELETON':
      return '好的，已关闭骨架。';
    default:
      return '好的，继续练习。';
  }
}
