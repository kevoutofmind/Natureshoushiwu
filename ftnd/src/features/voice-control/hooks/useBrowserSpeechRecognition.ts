"use client";

import {
  type MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  canDispatchAfterCooldown,
  extractImmediateVoiceCommand,
  IMMEDIATE_COMMAND_RESET_DELAY_MS,
  normalizeVoiceTranscript,
} from "../immediateVoiceCommands";
import { extractVoiceWakeWordPayload } from "../wakeWords";

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface BrowserSpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionResultList {
  readonly length: number;
  [index: number]: BrowserSpeechRecognitionResult;
}

interface BrowserSpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface BrowserSpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

interface UseBrowserSpeechRecognitionOptions {
  onFinalTranscript: (transcript: string) => void | Promise<void>;
}

const INTERIM_FINALIZE_DELAY_MS = 900;
const DUPLICATE_TRANSCRIPT_WINDOW_MS = 900;
const WAKE_COMMAND_WINDOW_MS = 8000;

const speechErrorMessages: Record<string, string> = {
  "not-allowed": "麦克风权限被拒绝，请在浏览器中允许麦克风访问。",
  "service-not-allowed": "浏览器不允许使用语音识别服务。",
  "audio-capture": "没有检测到可用的麦克风。",
  network: "语音识别网络服务暂时不可用。",
  "language-not-supported": "当前浏览器不支持中文语音识别。",
};

export function useBrowserSpeechRecognition({
  onFinalTranscript,
}: UseBrowserSpeechRecognitionOptions) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const isStartingRef = useRef(false);
  const isListeningRef = useRef(false);
  const keepListeningRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interimFinalizeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const wakeWindowTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAwakeRef = useRef(false);
  const commandResetPendingRef = useRef(false);
  const ignoreResultsRef = useRef(false);
  const lastInterimRef = useRef("");
  const commandBlockedUntilRef = useRef(0);
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  const lastDispatchedRef = useRef({ transcript: "", at: 0 });
  const [isSupported, setIsSupported] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isAwake, setIsAwake] = useState(false);
  const [wakeDebugTranscript, setWakeDebugTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    onFinalTranscriptRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  useEffect(() => {
    const RecognitionConstructor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!RecognitionConstructor) {
      const unsupportedTimer = setTimeout(() => setIsSupported(false), 0);
      return () => clearTimeout(unsupportedTimer);
    }

    const clearInterimFinalizeTimer = () => {
      if (interimFinalizeTimerRef.current) {
        clearTimeout(interimFinalizeTimerRef.current);
        interimFinalizeTimerRef.current = null;
      }
    };

    const clearWakeWindowTimer = () => {
      if (wakeWindowTimerRef.current) {
        clearTimeout(wakeWindowTimerRef.current);
        wakeWindowTimerRef.current = null;
      }
    };

    const returnToWakeWaiting = () => {
      clearWakeWindowTimer();
      isAwakeRef.current = false;
      lastInterimRef.current = "";
      setIsAwake(false);
      setInterimTranscript("");
      clearInterimFinalizeTimer();
    };

    const activateWakeWindow = () => {
      clearWakeWindowTimer();
      isAwakeRef.current = true;
      setIsAwake(true);
      wakeWindowTimerRef.current = setTimeout(
        returnToWakeWaiting,
        WAKE_COMMAND_WINDOW_MS,
      );
    };

    const resetRecognitionAfterDispatch = () => {
      returnToWakeWaiting();
      commandResetPendingRef.current = true;
      lastDispatchedRef.current = { transcript: "", at: 0 };
      setInterimTranscript("");
      clearInterimFinalizeTimer();
      recognitionRef.current?.abort();
    };

    const dispatchTranscriptAndReset = (transcript: string) => {
      const dispatched = dispatchRecognizedTranscript(
        transcript,
        lastDispatchedRef,
        onFinalTranscriptRef,
      );
      if (dispatched) resetRecognitionAfterDispatch();
      return dispatched;
    };

    const recognition = new RecognitionConstructor();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      ignoreResultsRef.current = false;
      isStartingRef.current = false;
      isListeningRef.current = true;
      setIsListening(true);
      setError("");
    };

    recognition.onresult = (event) => {
      if (commandResetPendingRef.current || ignoreResultsRef.current) return;

      let interim = "";
      const finalParts: string[] = [];

      for (
        let index = event.resultIndex;
        index < event.results.length;
        index++
      ) {
        const result = event.results[index];
        const transcript = result[0]?.transcript.trim() ?? "";
        if (!transcript) continue;

        if (result.isFinal) {
          finalParts.push(transcript);
        } else {
          interim += transcript;
        }
      }

      let activeInterim = interim;
      let finalTranscript = finalParts.join("，");
      const interimWakeMatch = extractVoiceWakeWordPayload(activeInterim);
      const finalWakeMatch = extractVoiceWakeWordPayload(finalTranscript);
      const hasWakeWord = interimWakeMatch.matched || finalWakeMatch.matched;
      const wasAwake = isAwakeRef.current;
      const wakeCandidate = [finalTranscript, activeInterim]
        .filter(Boolean)
        .join("，")
        .trim();

      if (!wasAwake && !hasWakeWord) {
        setWakeDebugTranscript(wakeCandidate);
        if (wakeCandidate && process.env.NODE_ENV !== "production") {
          console.debug("[早上好 wake] 未命中唤醒词", wakeCandidate);
        }
        lastInterimRef.current = "";
        setInterimTranscript("");
        clearInterimFinalizeTimer();
        return;
      }

      if (hasWakeWord) {
        setWakeDebugTranscript("");
        if (process.env.NODE_ENV !== "production") {
          console.debug("[早上好 wake] 已唤醒", wakeCandidate);
        }
      }
      if (hasWakeWord || wasAwake) activateWakeWindow();
      if (interimWakeMatch.matched) {
        activeInterim = interimWakeMatch.payload;
        if (!wasAwake) finalTranscript = "";
      }
      if (finalWakeMatch.matched) finalTranscript = finalWakeMatch.payload;
      setInterimTranscript(activeInterim);

      if (!activeInterim && !finalTranscript) return;

      const now = Date.now();
      const immediateCommand = extractImmediateVoiceCommand(
        activeInterim || finalTranscript,
      );
      if (
        immediateCommand &&
        canDispatchAfterCooldown(now, commandBlockedUntilRef.current)
      ) {
        const dispatched = dispatchTranscriptAndReset(immediateCommand);
        if (dispatched) {
          commandBlockedUntilRef.current =
            now + IMMEDIATE_COMMAND_RESET_DELAY_MS;
        }
        return;
      }

      if (activeInterim) {
        if (activeInterim !== lastInterimRef.current) {
          lastInterimRef.current = activeInterim;
          if (interimFinalizeTimerRef.current) {
            clearTimeout(interimFinalizeTimerRef.current);
          }
          interimFinalizeTimerRef.current = setTimeout(() => {
            interimFinalizeTimerRef.current = null;
            dispatchTranscriptAndReset(activeInterim);
          }, INTERIM_FINALIZE_DELAY_MS);
        }
      } else {
        lastInterimRef.current = "";
        clearInterimFinalizeTimer();
      }

      if (finalTranscript) {
        lastInterimRef.current = "";
        clearInterimFinalizeTimer();
        dispatchTranscriptAndReset(finalTranscript);
      }
    };

    recognition.onerror = (event) => {
      isStartingRef.current = false;
      if (event.error === "aborted" || event.error === "no-speech") return;
      isListeningRef.current = false;
      setIsListening(false);
      setError(
        speechErrorMessages[event.error] ??
          `语音识别发生错误：${event.error}`,
      );
      if (event.error === "network") return;
      keepListeningRef.current = false;
    };

    recognition.onend = () => {
      const isCommandReset = commandResetPendingRef.current;
      commandResetPendingRef.current = false;
      isStartingRef.current = false;
      isListeningRef.current = false;
      if (!keepListeningRef.current) {
        setIsListening(false);
        return;
      }
      // Keep the logical listening state active while Chrome rotates its
      // recognition session, so autoListen cannot erase a fresh wake window.
      setIsListening(true);

      restartTimerRef.current = setTimeout(() => {
        if (isStartingRef.current || isListeningRef.current) return;
        try {
          isStartingRef.current = true;
          recognition.start();
        } catch (reason) {
          isStartingRef.current = false;
          if (isInvalidStateError(reason)) {
            setError("");
            return;
          }
          keepListeningRef.current = false;
          isListeningRef.current = false;
          setIsListening(false);
          setError("语音识别无法继续，请重新点击开始监听。");
        }
      }, isCommandReset ? IMMEDIATE_COMMAND_RESET_DELAY_MS : 250);
    };

    recognitionRef.current = recognition;

    return () => {
      keepListeningRef.current = false;
      isStartingRef.current = false;
      isListeningRef.current = false;
      clearInterimFinalizeTimer();
      clearWakeWindowTimer();
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) {
      setError(
        "当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge。",
      );
      return;
    }

    if (isStartingRef.current || isListeningRef.current || isListening) {
      setError("");
      return;
    }

    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }

    keepListeningRef.current = true;
    ignoreResultsRef.current = false;
    isAwakeRef.current = false;
    setIsAwake(false);
    setWakeDebugTranscript("");
    isStartingRef.current = true;
    setError("");
    try {
      recognitionRef.current.start();
    } catch (reason) {
      isStartingRef.current = false;
      if (isInvalidStateError(reason)) {
        isListeningRef.current = true;
        setIsListening(true);
        setError("");
        return;
      }
      if (!isListeningRef.current && !isListening) {
        keepListeningRef.current = false;
        setError("语音识别启动失败，请稍后重试。");
      }
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    keepListeningRef.current = false;
    ignoreResultsRef.current = true;
    isAwakeRef.current = false;
    setIsAwake(false);
    setWakeDebugTranscript("");
    isStartingRef.current = false;
    isListeningRef.current = false;
    commandResetPendingRef.current = false;
    commandBlockedUntilRef.current = 0;
    lastDispatchedRef.current = { transcript: "", at: 0 };
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (interimFinalizeTimerRef.current) {
      clearTimeout(interimFinalizeTimerRef.current);
      interimFinalizeTimerRef.current = null;
    }
    if (wakeWindowTimerRef.current) {
      clearTimeout(wakeWindowTimerRef.current);
      wakeWindowTimerRef.current = null;
    }
    recognitionRef.current?.abort();
    setIsListening(false);
    setInterimTranscript("");
  }, []);

  return {
    isSupported,
    isListening,
    isAwake,
    wakeDebugTranscript,
    interimTranscript,
    error,
    startListening,
    stopListening,
  };
}

function dispatchRecognizedTranscript(
  transcript: string,
  lastDispatchedRef: MutableRefObject<{ transcript: string; at: number }>,
  callbackRef: MutableRefObject<(transcript: string) => void | Promise<void>>,
): boolean {
  const normalized = normalizeVoiceTranscript(transcript);
  if (!normalized) return false;

  const previous = lastDispatchedRef.current;
  const now = Date.now();
  const isLikelyDuplicate =
    now - previous.at < DUPLICATE_TRANSCRIPT_WINDOW_MS &&
    normalized === previous.transcript;
  if (isLikelyDuplicate) return false;

  lastDispatchedRef.current = { transcript: normalized, at: now };
  void callbackRef.current(transcript);
  return true;
}

function isInvalidStateError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "InvalidStateError"
    : error instanceof Error && error.name === "InvalidStateError";
}
