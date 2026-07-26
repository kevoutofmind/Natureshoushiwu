"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { transcribeVoiceAudio } from "../api";

interface UseWhisperSpeechRecognitionOptions {
  onFinalTranscript: (transcript: string) => void | Promise<void>;
}

const RECORDING_CHUNK_MS = 1200;
const MIN_AUDIO_BYTES = 1024;
// Favor quieter voices. The local Whisper model can reject ambient noise later,
// while this gate should not discard a softly spoken Lumi command.
const SPEECH_RMS_THRESHOLD = 0.005;
const MIN_SPEECH_FRAMES = 2;
const MIME_TYPE_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function useWhisperSpeechRecognition({
  onFinalTranscript,
}: UseWhisperSpeechRecognitionOptions) {
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunkTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const speechMonitorRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chunkPartsRef = useRef<Blob[]>([]);
  const speechFrameCountRef = useRef(0);
  const isStartingRef = useRef(false);
  const keepListeningRef = useRef(false);
  const transcriptionQueueRef = useRef(Promise.resolve());
  const pendingTranscriptionsRef = useRef(0);
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  const startChunkRef = useRef<() => void>(() => undefined);
  const [isSupported, setIsSupported] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    onFinalTranscriptRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  const releaseCapture = useCallback(() => {
    isStartingRef.current = false;
    keepListeningRef.current = false;
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
      setInterimTranscript("正在通过 Whisper 识别…");

      transcriptionQueueRef.current = transcriptionQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            const result = await transcribeVoiceAudio(audio);
            const transcript = result.text.trim();
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
            releaseCapture();
          } finally {
            pendingTranscriptionsRef.current = Math.max(
              0,
              pendingTranscriptionsRef.current - 1,
            );
            if (pendingTranscriptionsRef.current === 0) {
              setInterimTranscript("");
            }
          }
        });
    },
    [releaseCapture],
  );

  const startChunk = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || !keepListeningRef.current) return;

    chunkPartsRef.current = [];
    speechFrameCountRef.current = 0;
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
      const shouldTranscribe =
        keepListeningRef.current &&
        speechFrameCountRef.current >= MIN_SPEECH_FRAMES &&
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
    setInterimTranscript("");
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
      await startSpeechMonitor(
        stream,
        audioContextRef,
        speechMonitorRef,
        speechFrameCountRef,
      );
      startChunkRef.current();
    } catch (reason) {
      releaseCapture();
      setError(microphoneErrorMessage(reason));
    }
  }, [releaseCapture]);

  const stopListening = useCallback(() => {
    releaseCapture();
    setInterimTranscript("");
  }, [releaseCapture]);

  return {
    isSupported,
    isListening,
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
): Promise<void> {
  const audioContext = new AudioContext();
  await audioContext.resume();
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
    if (Math.sqrt(squareSum / samples.length) >= SPEECH_RMS_THRESHOLD) {
      speechFrameCountRef.current += 1;
    }
  }, 80);
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
