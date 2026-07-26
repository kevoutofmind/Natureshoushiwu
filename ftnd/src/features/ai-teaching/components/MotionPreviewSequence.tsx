"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import { IconButton } from "@mui/material";

interface MotionPreview {
  motionId: string;
  startMs: number;
  label: string;
}

interface MotionPreviewSequenceProps {
  videoUrl: string;
  clipUrls?: string[];
  motions?: MotionPreview[];
  activeMotionIndex?: number | null;
  onSelectMotion?: (motionIndex: number) => void;
  mode: "overlay" | "compact";
  onContinue?: () => void;
}

export default function MotionPreviewSequence({
  videoUrl,
  clipUrls = [],
  motions = [],
  activeMotionIndex = null,
  onSelectMotion,
  mode,
  onContinue,
}: MotionPreviewSequenceProps) {
  const [frames, setFrames] = useState<string[]>([]);
  const previewMotions = useMemo(
    () =>
      (motions.length ? motions : fallbackMotions).slice(0, 4).map((motion, index) => ({
        ...motion,
        label: motion.label || `动作 ${index + 1}`,
      })),
    [motions],
  );

  useEffect(() => {
    if (!videoUrl && clipUrls.length === 0) {
      return;
    }

    let cancelled = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    const loadFrame = async (src: string, timeSeconds: number) => {
      await new Promise<void>((resolve, reject) => {
        video.addEventListener("loadedmetadata", () => resolve(), { once: true });
        video.addEventListener("error", () => reject(), { once: true });
        video.src = src;
        video.load();
      }).catch(() => undefined);
      if (cancelled || !video.videoWidth) return null;

      const frameTime = Math.min(
        Math.max(0, timeSeconds),
        Math.max(0, video.duration - 0.08),
      );
      await new Promise<void>((resolve) => {
        video.currentTime = Number.isFinite(frameTime) ? frameTime : 0;
        video.addEventListener("seeked", () => resolve(), { once: true });
      });
      if (cancelled) return null;
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      context?.drawImage(video, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", 0.82);
    };

    const captureFrames = async () => {
      const captured: string[] = [];
      for (const [index, motion] of previewMotions.entries()) {
        const clipUrl = clipUrls[index];
        const frame = await loadFrame(
          clipUrl ?? videoUrl,
          clipUrl ? 0.18 : motion.startMs / 1000 + 0.18,
        );
        if (cancelled) return;
        if (frame) captured.push(frame);
      }
      if (!cancelled) setFrames(captured);
    };

    void captureFrames();
    return () => {
      cancelled = true;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [clipUrls, previewMotions, videoUrl]);

  const cards = previewMotions.map((motion, index) => (
    <figure
      className="motion-preview-card"
      style={{ "--motion-delay": `${(3 - index) * 150}ms` } as CSSProperties}
      key={motion.motionId}
      role={onSelectMotion ? "button" : undefined}
      tabIndex={onSelectMotion ? 0 : undefined}
      aria-label={onSelectMotion ? `播放第 ${index + 1} 个动作：${motion.label}` : undefined}
      aria-pressed={onSelectMotion ? activeMotionIndex === index : undefined}
      onClick={() => onSelectMotion?.(index)}
      onKeyDown={(event) => {
        if (!onSelectMotion || (event.key !== "Enter" && event.key !== " ")) {
          return;
        }
        event.preventDefault();
        onSelectMotion(index);
      }}
    >
      {videoUrl && frames[index] ? <img src={frames[index]} alt={motion.label} /> : <span />}
      <span className="motion-preview-index" aria-hidden="true">
        {index + 1}
      </span>
      <figcaption>{motion.label}</figcaption>
    </figure>
  ));

  if (mode === "compact") {
    return <div className="motion-preview-strip" aria-label="动作预览">{cards}</div>;
  }

  return (
    <section className="motion-preview-overlay" aria-label="动作预览">
      <div className="motion-preview-heading">
        <span>动作预览</span>
        <strong>先看清四个关键手势</strong>
      </div>
      <div className="motion-preview-grid">{cards}</div>
      <IconButton
        className="motion-preview-next"
        onClick={onContinue}
        aria-label="进入 AI 教学"
      >
        <ArrowForwardRoundedIcon />
      </IconButton>
    </section>
  );
}

const fallbackMotions: MotionPreview[] = [
  { motionId: "preview-1", startMs: 0, label: "准备" },
  { motionId: "preview-2", startMs: 1800, label: "第一拍" },
  { motionId: "preview-3", startMs: 3600, label: "第二拍" },
  { motionId: "preview-4", startMs: 5400, label: "收势" },
];
