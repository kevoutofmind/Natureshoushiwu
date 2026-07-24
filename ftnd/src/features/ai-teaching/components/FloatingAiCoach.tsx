"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import LiquidGlass from "liquid-glass-react";
import type { MotionSemanticBreakdown } from "@/features/video-stage/reference-dataset.types";
import LumiWebGLParticleField from "./LumiWebGLParticleField";

interface FloatingAiCoachProps {
  introOpen: boolean;
  danceTitle: string;
  motions: Array<{
    motionId: string;
    instruction: string;
    semantic?: MotionSemanticBreakdown;
  }>;
  phaseLabel: string;
  speech: string;
  review?: { headline: string; detail: string } | null;
  onFinishIntro: () => void;
  children?: ReactNode;
}

interface CoachPosition {
  left: number;
  top: number;
}

interface DragState {
  pointerId: number;
  offsetX: number;
  offsetY: number;
}

export default function FloatingAiCoach({
  introOpen,
  danceTitle,
  motions,
  phaseLabel,
  speech,
  review,
  onFinishIntro,
  children,
}: FloatingAiCoachProps) {
  const coachRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [position, setPosition] = useState<CoachPosition | null>(null);
  const [dragging, setDragging] = useState(false);
  const introLines = useMemo(
    () => [
      `今天我们学习《${danceTitle}》。`,
      `这支舞由 ${motions.length || 4} 个短动作组成。`,
      "先看清手的位置，再慢慢把节奏连起来。",
      "不用着急，我会一直在旁边。",
    ],
    [danceTitle, motions.length],
  );
  const [introLineIndex, setIntroLineIndex] = useState(0);
  const [introLineVisible, setIntroLineVisible] = useState(true);

  useEffect(() => {
    if (!introOpen) return;
    let nextLineTimer = 0;
    const fadeTimer = window.setInterval(() => {
      setIntroLineVisible(false);
      nextLineTimer = window.setTimeout(() => {
        setIntroLineIndex((current) => (current + 1) % introLines.length);
        setIntroLineVisible(true);
      }, 460);
    }, 3000);
    return () => {
      window.clearInterval(fadeTimer);
      window.clearTimeout(nextLineTimer);
    };
  }, [introLines.length, introOpen]);

  useEffect(() => {
    if (!position) return;
    const clampToViewport = () => {
      const coach = coachRef.current;
      if (!coach) return;
      const rect = coach.getBoundingClientRect();
      setPosition((current) =>
        current
          ? clampPosition(current.left, current.top, rect.width, rect.height)
          : current,
      );
    };
    window.addEventListener("resize", clampToViewport);
    return () => window.removeEventListener("resize", clampToViewport);
  }, [position]);

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (introOpen || event.button !== 0) return;
    if ((event.target as HTMLElement).closest("button")) return;
    const coach = coachRef.current;
    if (!coach) return;
    const rect = coach.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
    };
    setPosition({ left: rect.left, top: rect.top });
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const coach = coachRef.current;
    if (!drag || !coach || drag.pointerId !== event.pointerId) return;
    const rect = coach.getBoundingClientRect();
    setPosition(
      clampPosition(
        event.clientX - drag.offsetX,
        event.clientY - drag.offsetY,
        rect.width,
        rect.height,
      ),
    );
  };

  const stopDragging = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  if (introOpen) {
    return (
      <div className="lumi-intro" aria-label="Lumi 手势舞教练">
        <LumiWebGLParticleField />
        <div className="lumi-intro-copy">
          <h1>Hi，我是 Lumi</h1>
          <p
            className={[
              "lumi-intro-line",
              introLineVisible ? "is-visible" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            aria-live="polite"
          >
            {introLines[introLineIndex]}
          </p>
          <button
            type="button"
            className="lumi-intro-action"
            onClick={onFinishIntro}
          >
            开始
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      </div>
    );
  }

  const floatingStyle: CSSProperties = position
    ? { left: position.left, top: position.top }
    : { right: 20, top: 84 };
  const hostClassName = [
    "lumi-glass-host",
    review ? "has-review" : "",
    children ? "has-actions" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const glassVariant = `${review ? "review" : "plain"}-${
    children ? "actions" : "idle"
  }`;

  return (
    <div
      ref={coachRef}
      className={[
        "lumi-coach",
        dragging ? "is-dragging" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={floatingStyle}
      aria-label="Lumi 手势舞教练"
    >
      <div className={hostClassName}>
        <LiquidGlass
          key={glassVariant}
          displacementScale={86}
          blurAmount={0.035}
          saturation={180}
          aberrationIntensity={2.8}
          elasticity={0.34}
          cornerRadius={30}
          padding="0"
          mouseContainer={coachRef}
          mode="prominent"
          className="lumi-liquid-glass"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
          }}
        >
          <div
            className="lumi-glass-card"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={stopDragging}
            onPointerCancel={stopDragging}
          >
            <header className="lumi-glass-header">
              <span className="lumi-status-dot" aria-hidden="true" />
              <strong>Lumi</strong>
              <small>{phaseLabel}</small>
            </header>

            <p className="lumi-current-line" aria-live="polite">
              {speech}
            </p>

            {review && (
              <div className="lumi-review">
                <strong>{review.headline}</strong>
                <p>{review.detail}</p>
              </div>
            )}

            {children && <div className="lumi-actions">{children}</div>}
          </div>
        </LiquidGlass>
      </div>
    </div>
  );
}

function clampPosition(
  left: number,
  top: number,
  width: number,
  height: number,
): CoachPosition {
  const margin = 12;
  return {
    left: Math.min(
      Math.max(margin, left),
      Math.max(margin, window.innerWidth - width - margin),
    ),
    top: Math.min(
      Math.max(margin, top),
      Math.max(margin, window.innerHeight - height - margin),
    ),
  };
}
