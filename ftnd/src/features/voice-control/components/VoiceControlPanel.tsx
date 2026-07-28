"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import MicRoundedIcon from "@mui/icons-material/MicRounded";
import StopCircleRoundedIcon from "@mui/icons-material/StopCircleRounded";
import {
  Alert,
  Button,
  CircularProgress,
  Snackbar,
  Stack,
} from "@mui/material";
import { interpretVoiceCommand } from "../api";
import { useWhisperSpeechRecognition } from "../hooks/useWhisperSpeechRecognition";
import { resolveLumiWakeTurn } from "../lumiWakeWord";
import type {
  VoiceCommandResult,
  VoiceInteractionViewState,
} from "../types";

import { matchActionNavigationVoiceIntent } from '../immediateVoiceCommands';

interface VoiceControlPanelProps {
  autoListen?: boolean;
  onCommandRecognized?: (result: VoiceCommandResult) => void;
  onInteractionChange?: (state: VoiceInteractionViewState) => void;
}

interface HeardTranscriptEntry {
  id: number;
  text: string;
  time: string;
}

export default function VoiceControlPanel({
  autoListen = false,
  onCommandRecognized,
  onInteractionChange,
}: VoiceControlPanelProps) {
  const startedAutomaticallyRef = useRef(false);
  const wakeWindowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAwakeRef = useRef(false);
  const requestQueueRef = useRef(Promise.resolve());
  const pendingRequestCountRef = useRef(0);
  const heardTranscriptSequenceRef = useRef(0);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [isAwake, setIsAwake] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [lastTranscript, setLastTranscript] = useState("");
  const [lastResult, setLastResult] = useState<VoiceCommandResult | null>(null);
  const [requestError, setRequestError] = useState("");
  const [debugPortalReady, setDebugPortalReady] = useState(false);
  const [heardTranscripts, setHeardTranscripts] = useState<
    HeardTranscriptEntry[]
  >([]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setDebugPortalReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

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

      await executeTranscript(decision.commandText);
    },
    [activateLumi, executeTranscript, returnToStandby],
  );

  const handleFinalTranscript = useCallback(
    async (transcript: string) => {
      const rawTranscript = transcript.trim();
      if (rawTranscript) {
        heardTranscriptSequenceRef.current += 1;
        const entry: HeardTranscriptEntry = {
          id: heardTranscriptSequenceRef.current,
          text: rawTranscript,
          time: new Date().toLocaleTimeString("zh-CN", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: false,
          }),
        };
        setHeardTranscripts((current) => [...current, entry].slice(-3));
      }
      await processTranscript(transcript);
    },
    [processTranscript],
  );

  const {
    isSupported,
    isListening,
    isTranscribing,
    interimTranscript,
    error: recognitionError,
    startListening,
    stopListening,
  } = useWhisperSpeechRecognition({
    onFinalTranscript: handleFinalTranscript,
    commandCaptureActive: isAwake,
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

  const visibleUserText =
    (isAwake && interimTranscript.trim()) || lastTranscript;
  const debugStatus = recognitionError
    ? "识别异常"
    : isListening
      ? isTranscribing
        ? "正在识别"
        : "监听中"
      : "监听已暂停";
  let interactionState: VoiceInteractionViewState;

  if (!isSupported) {
    interactionState = {
      status: "unsupported",
      statusLabel: "麦克风不可用",
      userText: visibleUserText,
      lumiText: "当前浏览器不支持麦克风录音，请使用最新版 Chrome 或 Edge。",
    };
  } else if (recognitionError || requestError) {
    interactionState = {
      status: "error",
      statusLabel: "语音连接异常",
      userText: visibleUserText,
      lumiText:
        requestError ||
        recognitionError ||
        "语音识别暂时不可用，请稍后重试。",
    };
  } else if (processing) {
    interactionState = {
      status: "processing",
      statusLabel: "Lumi 正在理解",
      userText: visibleUserText,
      lumiText: "正在理解你的问题…",
    };
  } else if (isListening && isAwake) {
    interactionState = {
      status: "listening",
      statusLabel: "Lumi 正在聆听",
      userText: visibleUserText,
      lumiText: lastResult?.responseText ?? "我在，请说出你的需求。",
    };
  } else if (isListening) {
    interactionState = {
      status: "standby",
      statusLabel: "Lumi 待机中",
      userText: visibleUserText,
      lumiText: lastResult?.responseText ?? "",
    };
  } else {
    interactionState = {
      status: "off",
      statusLabel: "语音未开启",
      userText: visibleUserText,
      lumiText: lastResult?.responseText ?? "",
    };
  }
  useEffect(() => {
    onInteractionChange?.(interactionState);
  }, [
    interactionState.lumiText,
    interactionState.status,
    interactionState.statusLabel,
    interactionState.userText,
    onInteractionChange,
  ]);

  return (
    <>
      {debugPortalReady &&
        createPortal(
          <div
            className="lumi-listening-debug"
            role="status"
            aria-live="polite"
            aria-atomic="false"
          >
            <div className="lumi-listening-debug-header">
              <span
                className={`lumi-listening-debug-dot${
                  isListening ? " is-listening" : ""
                }`}
                aria-hidden="true"
              />
              <span className="lumi-listening-debug-label">
                Lumi 原始监听文字
              </span>
              <span className="lumi-listening-debug-state">{debugStatus}</span>
            </div>
            <div className="lumi-listening-debug-log">
              {heardTranscripts.length > 0 ? (
                heardTranscripts.map((entry) => (
                  <div className="lumi-listening-debug-entry" key={entry.id}>
                    <time>{entry.time}</time>
                    <span>{entry.text}</span>
                  </div>
                ))
              ) : (
                <span className="lumi-listening-debug-empty">
                  尚未识别到文字，请对着麦克风说话…
                </span>
              )}
            </div>
          </div>,
          document.body,
        )}

      <Stack className="lumi-voice-controls" gap={1.25}>
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
      return '好的，显示骨骼。';
    case 'HIDE_SKELETON':
      return '好的，隐藏骨骼。';
    default:
      return '好的，继续练习。';
  }
}
