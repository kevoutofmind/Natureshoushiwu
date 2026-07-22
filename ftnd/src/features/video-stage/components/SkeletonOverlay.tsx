'use client';
import { useEffect, useRef } from 'react';
import { HolisticLandmarker } from '@mediapipe/tasks-vision';
import type { SkeletonSnapshot, VisionLandmark } from '../vision-types';
function draw(ctx: CanvasRenderingContext2D, points: VisionLandmark[], connections: Array<{ start: number; end: number }>, color: string) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
  for (const { start, end } of connections) { const a = points[start]; const b = points[end]; if (!a || !b) continue; ctx.beginPath(); ctx.moveTo(a.x * ctx.canvas.width, a.y * ctx.canvas.height); ctx.lineTo(b.x * ctx.canvas.width, b.y * ctx.canvas.height); ctx.stroke(); }
  for (const p of points) { ctx.beginPath(); ctx.arc(p.x * ctx.canvas.width, p.y * ctx.canvas.height, 2.5, 0, Math.PI * 2); ctx.fill(); }
}
export function SkeletonOverlay({ snapshot, mirrored = true }: { snapshot: SkeletonSnapshot | null; mirrored?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => { const canvas = ref.current; const ctx = canvas?.getContext('2d'); if (!canvas || !ctx) return; ctx.clearRect(0, 0, canvas.width, canvas.height); if (!snapshot) return; ctx.save(); if (mirrored) { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); } draw(ctx, snapshot.pose, HolisticLandmarker.POSE_CONNECTIONS, '#25f4ee'); draw(ctx, snapshot.leftHand, HolisticLandmarker.HAND_CONNECTIONS, '#fe2c55'); draw(ctx, snapshot.rightHand, HolisticLandmarker.HAND_CONNECTIONS, '#ffffff'); ctx.restore(); }, [snapshot, mirrored]);
  return <canvas ref={ref} width={360} height={640} className="skeleton-overlay" aria-label="实时人体骨骼" />;
}