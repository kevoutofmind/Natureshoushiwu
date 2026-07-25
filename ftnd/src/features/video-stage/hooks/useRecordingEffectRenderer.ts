"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { BeautySettings, RecordingEffectId } from "../recording-effects";

type FacePoint = { x: number; y: number };

type FaceLandmarkerRunner = {
  detectForVideo: (
    video: HTMLVideoElement,
    timestampMs: number,
  ) => { faceLandmarks: FacePoint[][] };
  close?: () => void;
};

type FxTexture = {
  loadContentsOf: (element: HTMLCanvasElement) => void;
};

type FxCanvas = HTMLCanvasElement & {
  texture: (element: HTMLCanvasElement) => FxTexture;
  draw: (texture: FxTexture) => FxCanvas;
  update: () => FxCanvas;
  brightnessContrast: (brightness: number, contrast: number) => FxCanvas;
  vibrance: (amount: number) => FxCanvas;
  denoise: (exponent: number) => FxCanvas;
  hueSaturation: (hue: number, saturation: number) => FxCanvas;
  noise: (amount: number) => FxCanvas;
  vignette: (size: number, amount: number) => FxCanvas;
  sepia: (amount: number) => FxCanvas;
  triangleBlur: (radius: number) => FxCanvas;
  unsharpMask: (radius: number, strength: number) => FxCanvas;
  bulgePinch: (
    centerX: number,
    centerY: number,
    radius: number,
    strength: number,
  ) => FxCanvas;
};

type FxModule = { canvas: () => FxCanvas };

const MAX_RENDER_HEIGHT = 1280;
// Matches the source hand-dance videos (720×1280 / 1080×1920). Drawing and
// CSS use the same 9:16 ratio, so opening the camera cannot stretch a person.
const OUTPUT_ASPECT_RATIO = 9 / 16;

function getRenderSize(video: HTMLVideoElement) {
  const sourceWidth = video.videoWidth || 720;
  const sourceHeight = video.videoHeight || 1280;
  const scale = Math.min(1, MAX_RENDER_HEIGHT / sourceHeight);
  const height = Math.max(2, Math.round(sourceHeight * scale));
  const width = Math.max(2, Math.round(height * OUTPUT_ASPECT_RATIO));
  return { width, height, sourceWidth, sourceHeight };
}

function drawCover(
  context: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  context.save();
  context.clearRect(0, 0, width, height);
  context.translate(width, 0);
  context.scale(-1, 1);
  context.drawImage(
    video,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
  context.restore();
}

function projectFacePoint(
  point: FacePoint,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
) {
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  return {
    x: width - ((width - drawWidth) / 2 + point.x * drawWidth),
    y: (height - drawHeight) / 2 + point.y * drawHeight,
  };
}

function applyBeauty(
  canvas: FxCanvas,
  beauty: BeautySettings,
  face: FacePoint[] | null,
  width: number,
  height: number,
  sourceWidth: number,
  sourceHeight: number,
) {
  let chain = canvas;
  if (beauty.skinSmooth > 0) {
    chain = chain.denoise(4 + beauty.skinSmooth * 14);
  }
  if (beauty.brightness > 0) {
    chain = chain.brightnessContrast(beauty.brightness * 0.14, 0);
  }
  if (!face) return chain;

  const faceWidth = Math.abs((face[454]?.x ?? 0.7) - (face[234]?.x ?? 0.3)) * sourceWidth;
  const cheekRadius = Math.max(20, faceWidth * Math.max(width / sourceWidth, height / sourceHeight) * 0.23);
  if (beauty.faceSlim > 0) {
    const leftCheek = projectFacePoint(face[234] ?? face[1], width, height, sourceWidth, sourceHeight);
    const rightCheek = projectFacePoint(face[454] ?? face[1], width, height, sourceWidth, sourceHeight);
    chain = chain
      .bulgePinch(leftCheek.x, leftCheek.y, cheekRadius, -beauty.faceSlim * 0.32)
      .bulgePinch(rightCheek.x, rightCheek.y, cheekRadius, -beauty.faceSlim * 0.32);
  }
  if (beauty.eyeEnlarge > 0) {
    const eyeRadius = Math.max(12, cheekRadius * 0.45);
    const leftEye = projectFacePoint(face[33] ?? face[1], width, height, sourceWidth, sourceHeight);
    const rightEye = projectFacePoint(face[263] ?? face[1], width, height, sourceWidth, sourceHeight);
    chain = chain
      .bulgePinch(leftEye.x, leftEye.y, eyeRadius, beauty.eyeEnlarge * 0.34)
      .bulgePinch(rightEye.x, rightEye.y, eyeRadius, beauty.eyeEnlarge * 0.34);
  }
  return chain;
}

function applyGlfxEffect(canvas: FxCanvas, effect: RecordingEffectId) {
  switch (effect) {
    case "clear":
      return canvas.brightnessContrast(0.06, 0.08).vibrance(0.12);
    case "soft":
      return canvas.denoise(12).brightnessContrast(0.04, -0.1);
    case "cream":
      return canvas.brightnessContrast(0.09, -0.18).hueSaturation(0, -0.12);
    case "peach":
      return canvas.brightnessContrast(0.08, 0.02).hueSaturation(-0.04, 0.12);
    case "cool":
      return canvas.brightnessContrast(0.05, 0.08).hueSaturation(0.06, -0.05);
    case "film":
      return canvas.brightnessContrast(-0.02, 0.15).noise(0.03).vignette(0.55, 0.18);
    case "vintage":
      return canvas.sepia(0.35).vignette(0.55, 0.2);
    case "dream":
      return canvas.triangleBlur(1.1).brightnessContrast(0.1, -0.1);
    case "spotlight":
      return canvas.brightnessContrast(0.05, 0.1).vignette(0.4, 0.35);
    case "crisp":
      return canvas.unsharpMask(1, 0.45).brightnessContrast(0.02, 0.12);
    case "original":
    default:
      return canvas;
  }
}

function fallbackFilter(effect: RecordingEffectId) {
  const filters: Record<RecordingEffectId, string> = {
    original: "none",
    clear: "brightness(1.06) contrast(1.08) saturate(1.12)",
    soft: "brightness(1.04) contrast(0.9) saturate(0.94)",
    cream: "brightness(1.09) contrast(0.82) saturate(0.88)",
    peach: "brightness(1.08) contrast(1.02) saturate(1.12) sepia(0.08)",
    cool: "brightness(1.05) contrast(1.08) saturate(0.94) hue-rotate(8deg)",
    film: "brightness(0.98) contrast(1.15) saturate(0.9)",
    vintage: "sepia(0.35) contrast(0.95)",
    dream: "brightness(1.1) contrast(0.9) blur(1px)",
    spotlight: "brightness(1.06) contrast(1.1)",
    crisp: "brightness(1.02) contrast(1.15) saturate(1.04)",
  };
  return filters[effect];
}

export function useRecordingEffectRenderer({
  sourceVideoRef,
  sourceStreamRef,
  effect,
  beauty,
  enabled,
}: {
  sourceVideoRef: RefObject<HTMLVideoElement | null>;
  sourceStreamRef: RefObject<MediaStream | null>;
  effect: RecordingEffectId;
  beauty: BeautySettings;
  enabled: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const effectRef = useRef(effect);
  const beautyRef = useRef(beauty);
  const [rendererState, setRendererState] = useState<
    "idle" | "loading" | "webgl" | "fallback"
  >("idle");

  useEffect(() => {
    effectRef.current = effect;
  }, [effect]);

  useEffect(() => {
    beautyRef.current = beauty;
  }, [beauty]);

  useEffect(() => {
    let active = true;
    let animationFrame: number | null = null;
    let fxCanvas: FxCanvas | null = null;
    let texture: FxTexture | null = null;
    let sourceCanvas: HTMLCanvasElement | null = null;
    let faceLandmarker: FaceLandmarkerRunner | null = null;
    let latestFace: FacePoint[] | null = null;
    let lastFaceDetectionAt = 0;
    const container = containerRef.current;
    if (!container) return;
    if (!enabled) {
      container.replaceChildren();
      outputCanvasRef.current = null;
      return;
    }

    const fallbackCanvas = document.createElement("canvas");
    fallbackCanvas.className = "camera-effect-canvas";
    container.replaceChildren(fallbackCanvas);
    outputCanvasRef.current = fallbackCanvas;

    const drawFallback = () => {
      const video = sourceVideoRef.current;
      if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      const { width, height, sourceWidth, sourceHeight } = getRenderSize(video);
      if (fallbackCanvas.width !== width || fallbackCanvas.height !== height) {
        fallbackCanvas.width = width;
        fallbackCanvas.height = height;
      }
      const context = fallbackCanvas.getContext("2d");
      if (!context) return;
      context.filter = fallbackFilter(effectRef.current);
      drawCover(context, video, width, height, sourceWidth, sourceHeight);
      context.filter = "none";
    };

    const render = () => {
      const video = sourceVideoRef.current;
      if (video?.readyState && fxCanvas && sourceCanvas) {
        const { width, height, sourceWidth, sourceHeight } = getRenderSize(video);
        const now = performance.now();
        if (faceLandmarker && now - lastFaceDetectionAt >= 83) {
          lastFaceDetectionAt = now;
          try {
            latestFace = faceLandmarker.detectForVideo(video, now).faceLandmarks[0] ?? null;
          } catch {
            latestFace = null;
          }
        }
        if (sourceCanvas.width !== width || sourceCanvas.height !== height) {
          sourceCanvas.width = width;
          sourceCanvas.height = height;
          fxCanvas.width = width;
          fxCanvas.height = height;
          texture = fxCanvas.texture(sourceCanvas);
        }
        const sourceContext = sourceCanvas.getContext("2d");
        if (sourceContext && texture) {
          drawCover(sourceContext, video, width, height, sourceWidth, sourceHeight);
          texture.loadContentsOf(sourceCanvas);
          applyGlfxEffect(
            applyBeauty(
              fxCanvas.draw(texture),
              beautyRef.current,
              latestFace,
              width,
              height,
              sourceWidth,
              sourceHeight,
            ),
            effectRef.current,
          ).update();
        }
      } else {
        drawFallback();
      }
      if (active) animationFrame = requestAnimationFrame(render);
    };

    const loadGlfx = async () => {
      try {
        const imported = (await import("glfx")) as unknown as {
          default?: FxModule;
        } & FxModule;
        if (!active) return;
        const fx = imported.default ?? imported;
        const nextCanvas = fx.canvas();
        nextCanvas.className = "camera-effect-canvas";
        container.replaceChildren(nextCanvas);
        outputCanvasRef.current = nextCanvas;
        fxCanvas = nextCanvas;
        sourceCanvas = document.createElement("canvas");
        texture = null;
        setRendererState("webgl");
      } catch {
        setRendererState("fallback");
      }
    };

    const loadFaceLandmarker = async () => {
      try {
        const vision = (await import("@mediapipe/tasks-vision")) as unknown as {
          FaceLandmarker: {
            createFromOptions: (
              fileset: unknown,
              options: unknown,
            ) => Promise<FaceLandmarkerRunner>;
          };
          FilesetResolver: {
            forVisionTasks: (wasmRoot: string) => Promise<unknown>;
          };
        };
        const fileset = await vision.FilesetResolver.forVisionTasks("/mediapipe/wasm");
        const landmarker = await vision.FaceLandmarker.createFromOptions(fileset, {
          baseOptions: {
            modelAssetPath: "/mediapipe/models/face_landmarker.task",
          },
          runningMode: "VIDEO",
          numFaces: 1,
        });
        if (!active) {
          landmarker.close?.();
          return;
        }
        faceLandmarker = landmarker;
      } catch {
        faceLandmarker = null;
      }
    };

    void loadGlfx();
    void loadFaceLandmarker();
    animationFrame = requestAnimationFrame(render);
    return () => {
      active = false;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      faceLandmarker?.close?.();
      outputCanvasRef.current = null;
      container.replaceChildren();
    };
  }, [enabled, sourceVideoRef]);

  const getRecordingStream = useCallback(() => {
    const sourceStream = sourceStreamRef.current;
    const canvas = outputCanvasRef.current;
    if (!sourceStream || !canvas?.captureStream) return sourceStream;
    const output = canvas.captureStream(30);
    sourceStream.getAudioTracks().forEach((track) => output.addTrack(track));
    return output;
  }, [sourceStreamRef]);

  const resolvedRendererState =
    enabled && rendererState === "idle" ? "loading" : rendererState;

  return {
    containerRef,
    getRecordingStream,
    rendererState: resolvedRendererState,
  };
}
