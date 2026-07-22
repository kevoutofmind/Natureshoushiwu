'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FilesetResolver, HolisticLandmarker, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import type { SkeletonSnapshot } from '../vision-types';
const WASM_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/holistic_landmarker/holistic_landmarker/float16/1/holistic_landmarker.task';
const copy = (p: NormalizedLandmark[] | undefined) => (p ?? []).map(({ x, y, z, visibility }) => ({ x, y, z, visibility }));
export function useHolisticLandmarker() {
  const instance = useRef<HolisticLandmarker | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    if (instance.current || state === 'loading') return;
    setState('loading'); setError('');
    try {
      const files = await FilesetResolver.forVisionTasks(WASM_ROOT);
      instance.current = await HolisticLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' }, runningMode: 'VIDEO',
        minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minHandLandmarksConfidence: 0.45,
      });
      setState('ready');
    } catch (reason) { setState('error'); setError(reason instanceof Error ? reason.message : '模型加载失败'); }
  }, [state]);
  const detect = useCallback((source: HTMLVideoElement, timestamp = performance.now()): SkeletonSnapshot | null => {
    const r = instance.current?.detectForVideo(source, timestamp); const pose = r?.poseLandmarks[0];
    return pose?.length ? { timestampMs: Math.round(timestamp), pose: copy(pose), leftHand: copy(r?.leftHandLandmarks[0]), rightHand: copy(r?.rightHandLandmarks[0]) } : null;
  }, []);
  useEffect(() => () => instance.current?.close(), []);
  return { load, detect, state, error };
}