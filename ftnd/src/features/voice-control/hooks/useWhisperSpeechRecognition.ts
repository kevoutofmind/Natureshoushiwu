"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeVoiceAudio } from "../api";

interface UseWhisperSpeechRecognitionOptions {
  onFinalTranscript: (transcript: string) => void | Promise<void>;
  commandCaptureActive?: boolean;
}

const RECORDING_CHUNK_MS = 1500;
const MIN_AUDIO_BYTES = 1024;
const SPEECH_RMS_THRESHOLD = 0.0025;
const MIN_SPEECH_FRAMES = 1;
const MIN_COMMAND_SPEECH_FRAMES = 1;
const MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function useWhisperSpeechRecognition({
  onFinalTranscript,
  commandCaptureActive = false,
}: UseWhisperSpeechRecognitionOptions) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const speechMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkPartsRef = useRef<Blob[]>([]);
  const speechFrameCountRef = useRef(0);
  const speechGateAvailableRef = useRef(false);
  const discardCurrentChunkRef = useRef(false);
  const isStartingRef = useRef(false);
  const keepListeningRef = useRef(false);
  const transcriptionQueueRef = useRef(Promise.resolve());
  const pendingTranscriptionsRef = useRef(0);
  const commandCaptureActiveRef = useRef(commandCaptureActive);
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  const startChunkRef = useRef<() => void>(() => undefined);
  const [isSupported, setIsSupported] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    onFinalTranscriptRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  const releaseCapture = useCallback(() => {
    isStartingRef.current = false;
    keepListeningRef.current = false;
    commandCaptureActiveRef.current = false;
    speechGateAvailableRef.current = false;
    discardCurrentChunkRef.current = false;
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    if (
      recorderRef.current &&
      recorderRef.current.state !== "inactive"
    ) {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (speechMonitorRef.current) {
      clearInterval(speechMonitorRef.current);
      speechMonitorRef.current = null;
    }
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    setIsListening(false);
  }, []);

  const queueTranscription = useCallback(
    (audio: Blob) => {
      pendingTranscriptionsRef.current += 1;
      setIsTranscribing(true);

      transcriptionQueueRef.current = transcriptionQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const result = await transcribeVoiceAudio(audio);
            const transcript = result.text.trim();
            setError("");
            if (transcript) {
              setInterimTranscript(transcript);
              await onFinalTranscriptRef.current(transcript);
            }
          } catch (reason) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Whisper 语音识别暂时不可用。",
            );
          } finally {
            pendingTranscriptionsRef.current = Math.max(
              0,
              pendingTranscriptionsRef.current - 1,
            );
            setIsTranscribing(pendingTranscriptionsRef.current > 0);
          }
        });
    },
    [],
  );

  const startChunk = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !keepListeningRef.current) return;

    chunkPartsRef.current = [];
    speechFrameCountRef.current = 0;
    const isCommandCaptureChunk = commandCaptureActiveRef.current;
    const mimeType = selectSupportedMimeType();
    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunkPartsRef.current.push(event.data);
    };

    recorder.onerror = () => {
      setError("浏览器录音失败，请重新允许麦克风权限后再试。");
      releaseCapture();
    };

    recorder.onstop = () => {
      if (chunkTimerRef.current) {
        clearTimeout(chunkTimerRef.current);
        chunkTimerRef.current = null;
      }
      const audio = new Blob(chunkPartsRef.current, {
        type: recorder.mimeType || mimeType || "audio/webm",
      });
      const discardStoppedChunk = discardCurrentChunkRef.current;
      discardCurrentChunkRef.current = false;
      const shouldTranscribe =
        !discardStoppedChunk &&
        keepListeningRef.current &&
        (speechFrameCountRef.current >=
          (isCommandCaptureChunk
            ? MIN_COMMAND_SPEECH_FRAMES
            : MIN_SPEECH_FRAMES) ||
          !speechGateAvailableRef.current) &&
        audio.size >= MIN_AUDIO_BYTES;

      if (keepListeningRef.current) {
        startChunkRef.current();
      }
      if (shouldTranscribe) {
        queueTranscription(audio);
      }
    };

    recorder.start();
    chunkTimerRef.current = setTimeout(() => {
      if (recorder.state !== "inactive") recorder.stop();
    }, RECORDING_CHUNK_MS);
  }, [queueTranscription, releaseCapture]);

  useEffect(() => {
    startChunkRef.current = startChunk;
  }, [startChunk]);

  useEffect(() => {
    commandCaptureActiveRef.current = commandCaptureActive;
    if (!commandCaptureActive) return;

    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    discardCurrentChunkRef.current = true;
    if (chunkTimerRef.current) {
      clearTimeout(chunkTimerRef.current);
      chunkTimerRef.current = null;
    }
    recorder.stop();
  }, [commandCaptureActive]);

  useEffect(() => {
    const supported =
      typeof MediaRecorder !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia);
    setIsSupported(supported);

    return () => {
      releaseCapture();
    };
  }, [releaseCapture]);

  const startListening = useCallback(async () => {
    if (
      typeof MediaRecorder === "undefined" ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      setIsSupported(false);
      setError("当前浏览器不支持麦克风录音，请使用最新版 Chrome 或 Edge。");
      return;
    }
    if (
      isStartingRef.current ||
      keepListeningRef.current ||
      streamRef.current
    ) {
      return;
    }

    isStartingRef.current = true;
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      streamRef.current = stream;
      isStartingRef.current = false;
      keepListeningRef.current = true;
      setIsListening(true);
      try {
        speechGateAvailableRef.current = await startSpeechMonitor(
          stream,
          audioContextRef,
          speechMonitorRef,
          speechFrameCountRef,
        );
      } catch {
        speechGateAvailableRef.current = false;
      }
      startChunkRef.current();
    } catch (reason) {
      releaseCapture();
      setError(microphoneErrorMessage(reason));
    }
  }, [releaseCapture]);

  const stopListening = useCallback(() => {
    releaseCapture();
  }, [releaseCapture]);

  return {
    isSupported,
    isListening,
    isTranscribing,
    interimTranscript,
    error,
    startListening,
    stopListening,
  };
}

function selectSupportedMimeType(): string {
  return (
    MIME_TYPE_CANDIDATES.find((candidate) =>
      MediaRecorder.isTypeSupported(candidate),
    ) ?? ""
  );
}

async function startSpeechMonitor(
  stream: MediaStream,
  audioContextRef: React.MutableRefObject<AudioContext | null>,
  speechMonitorRef: React.MutableRefObject<ReturnType<typeof setInterval> | null>,
  speechFrameCountRef: React.MutableRefObject<number>,
): Promise<boolean> {
  const audioContext = new AudioContext();
  await audioContext.resume();
  if (audioContext.state !== "running") {
    await audioContext.close();
    return false;
  }
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);

  audioContextRef.current = audioContext;
  speechMonitorRef.current = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    let squareSum = 0;
    for (const sample of samples) squareSum += sample * sample;
    const rms = Math.sqrt(squareSum / samples.length);
    if (rms >= SPEECH_RMS_THRESHOLD) {
      speechFrameCountRef.current += 1;
    }
  }, 80);
  return true;
}

function microphoneErrorMessage(reason: unknown): string {
  if (reason instanceof DOMException) {
    if (reason.name === "NotAllowedError") {
      return "麦克风权限被拒绝，请在浏览器中允许麦克风访问。";
    }
    if (reason.name === "NotFoundError") {
      return "没有检测到可用的麦克风。";
    }
  }
  return "麦克风启动失败，请检查浏览器权限后重试。";
}
