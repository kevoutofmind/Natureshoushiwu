'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

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

const speechErrorMessages: Record<string, string> = {
  'not-allowed': '麦克风权限被拒绝，请在浏览器中允许麦克风访问。',
  'service-not-allowed': '浏览器不允许使用语音识别服务。',
  'audio-capture': '没有检测到可用的麦克风。',
  network: '语音识别网络服务暂时不可用。',
  'language-not-supported': '当前浏览器不支持中文语音识别。',
};

export function useBrowserSpeechRecognition({
  onFinalTranscript,
}: UseBrowserSpeechRecognitionOptions) {
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const keepListeningRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinalTranscriptRef = useRef(onFinalTranscript);
  const [isSupported, setIsSupported] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [error, setError] = useState('');

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

    const recognition = new RecognitionConstructor();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;

    recognition.onstart = () => {
      setIsListening(true);
      setError('');
    };

    recognition.onresult = (event) => {
      let interim = '';
      const finalParts: string[] = [];

      for (let index = event.resultIndex; index < event.results.length; index++) {
        const result = event.results[index];
        const transcript = result[0]?.transcript.trim() ?? '';
        if (!transcript) continue;

        if (result.isFinal) {
          finalParts.push(transcript);
        } else {
          interim += transcript;
        }
      }

      setInterimTranscript(interim);
      const finalTranscript = finalParts.join('，');
      if (finalTranscript) {
        setInterimTranscript('');
        void onFinalTranscriptRef.current(finalTranscript);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return;
      keepListeningRef.current = false;
      setIsListening(false);
      setError(
        speechErrorMessages[event.error] ??
          `语音识别发生错误：${event.error}`,
      );
    };

    recognition.onend = () => {
      setIsListening(false);
      if (!keepListeningRef.current) return;

      restartTimerRef.current = setTimeout(() => {
        try {
          recognition.start();
        } catch {
          keepListeningRef.current = false;
          setError('语音识别无法继续，请重新点击开始监听。');
        }
      }, 250);
    };

    recognitionRef.current = recognition;

    return () => {
      keepListeningRef.current = false;
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      recognition.abort();
      recognitionRef.current = null;
    };
  }, []);

  const startListening = useCallback(() => {
    if (!recognitionRef.current) {
      setError('当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge。');
      return;
    }

    keepListeningRef.current = true;
    setError('');
    try {
      recognitionRef.current.start();
    } catch {
      if (!isListening) {
        keepListeningRef.current = false;
        setError('语音识别启动失败，请稍后重试。');
      }
    }
  }, [isListening]);

  const stopListening = useCallback(() => {
    keepListeningRef.current = false;
    if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
    recognitionRef.current?.stop();
    setIsListening(false);
    setInterimTranscript('');
  }, []);

  return {
    isSupported,
    isListening,
    interimTranscript,
    error,
    startListening,
    stopListening,
  };
}
