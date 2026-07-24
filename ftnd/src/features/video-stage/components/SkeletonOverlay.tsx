"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type RefObject,
} from "react";
import { HolisticLandmarker } from "@mediapipe/tasks-vision";
import type { SkeletonSnapshot, VisionLandmark } from "../vision-types";

interface Projection {
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
}

function coverProjection(
  canvasWidth: number,
  canvasHeight: number,
  videoWidth: number,
  videoHeight: number,
): Projection {
  if (videoWidth <= 0 || videoHeight <= 0) {
    return { offsetX: 0, offsetY: 0, width: canvasWidth, height: canvasHeight };
  }

  const scale = Math.max(canvasWidth / videoWidth, canvasHeight / videoHeight);
  const width = videoWidth * scale;
  const height = videoHeight * scale;
  return {
    offsetX: (canvasWidth - width) / 2,
    offsetY: (canvasHeight - height) / 2,
    width,
    height,
  };
}

function draw(
  context: CanvasRenderingContext2D,
  points: VisionLandmark[],
  connections: Array<{ start: number; end: number }>,
  color: string,
  projection: Projection,
) {
  const project = (point: VisionLandmark) => ({
    x: projection.offsetX + point.x * projection.width,
    y: projection.offsetY + point.y * projection.height,
  });

  context.strokeStyle = color;
  context.fillStyle = color;
  context.lineWidth = 2;
  for (const { start, end } of connections) {
    const startPoint = points[start];
    const endPoint = points[end];
    if (!startPoint || !endPoint) continue;
    const a = project(startPoint);
    const b = project(endPoint);
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
  }

  for (const point of points) {
    const projected = project(point);
    context.beginPath();
    context.arc(projected.x, projected.y, 2.5, 0, Math.PI * 2);
    context.fill();
  }
}

export function SkeletonOverlay({
  snapshot,
  videoRef,
  mirrored = false,
}: {
  snapshot: SkeletonSnapshot | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  mirrored?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const snapshotRef = useRef(snapshot);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const pixelRatio = window.devicePixelRatio || 1;
    const targetWidth = Math.round(width * pixelRatio);
    const targetHeight = Math.round(height * pixelRatio);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    const currentSnapshot = snapshotRef.current;
    if (!currentSnapshot) return;

    const projection = coverProjection(
      width,
      height,
      video?.videoWidth ?? 0,
      video?.videoHeight ?? 0,
    );
    context.save();
    if (mirrored) {
      context.translate(width, 0);
      context.scale(-1, 1);
    }
    draw(
      context,
      currentSnapshot.pose,
      HolisticLandmarker.POSE_CONNECTIONS,
      "#25f4ee",
      projection,
    );
    draw(
      context,
      currentSnapshot.leftHand,
      HolisticLandmarker.HAND_CONNECTIONS,
      "#fe2c55",
      projection,
    );
    draw(
      context,
      currentSnapshot.rightHand,
      HolisticLandmarker.HAND_CONNECTIONS,
      "#ffffff",
      projection,
    );
    context.restore();
  }, [mirrored, videoRef]);

  useEffect(() => {
    snapshotRef.current = snapshot;
    redraw();
  }, [redraw, snapshot]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver(redraw);
    observer.observe(canvas);
    video?.addEventListener("loadedmetadata", redraw);
    return () => {
      observer.disconnect();
      video?.removeEventListener("loadedmetadata", redraw);
    };
  }, [redraw, videoRef]);

  return (
    <canvas
      ref={canvasRef}
      className="skeleton-overlay"
      aria-label="实时人体骨骼"
    />
  );
}
