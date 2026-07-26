"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import LumiWebGLParticleField from "./LumiWebGLParticleField";
import {
  lumiMotionClipUrls,
  resolveLumiDanceId,
} from "../lumi-motion-catalog";

interface MotionLabel {
  motionId: string;
  label: string;
}

interface LumiMotionIntroProps {
  danceId: string;
  motions?: MotionLabel[];
  onStart: () => void;
}

type IntroPhase = "greeting" | "showcase" | "ready";

export default function LumiMotionIntro({
  danceId,
  motions = [],
  onStart,
}: LumiMotionIntroProps) {
  const [phase, setPhase] = useState<IntroPhase>("greeting");
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completedIndices, setCompletedIndices] = useState<number[]>([]);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [loadedClipIndices, setLoadedClipIndices] = useState<number[]>([]);
  const transitionLock = useRef(false);
  const greetingTimer = useRef<number | null>(null);
  const transitionTimer = useRef<number | null>(null);
  const resolvedDanceId = resolveLumiDanceId(danceId);
  const clips = lumiMotionClipUrls(resolvedDanceId);
  const cards = useMemo(
    () =>
      clips.map((src, index) => ({
        id: `${resolvedDanceId}-${index}`,
        label: motions[index]?.label || `动作 ${index + 1}`,
        src,
      })),
    [clips, motions, resolvedDanceId],
  );

  useEffect(() => {
    greetingTimer.current = window.setTimeout(() => setPhase("showcase"), 2500);

    return () => {
      if (greetingTimer.current !== null) window.clearTimeout(greetingTimer.current);
      if (transitionTimer.current !== null) window.clearTimeout(transitionTimer.current);
    };
  }, []);

  const completeCurrentClip = () => {
    if (phase !== "showcase" || transitionLock.current) return;

    transitionLock.current = true;
    setIsTransitioning(true);
    setCompletedIndices((current) =>
      current.includes(currentIndex) ? current : [...current, currentIndex],
    );

    if (currentIndex >= cards.length - 1) {
      setPhase("ready");
      transitionTimer.current = window.setTimeout(() => {
        setIsTransitioning(false);
        transitionLock.current = false;
      }, 1450);
      return;
    }

    // The completed clip moves left while the next clip fades into the center.
    setCurrentIndex((current) => current + 1);
    transitionTimer.current = window.setTimeout(() => {
      setIsTransitioning(false);
      transitionLock.current = false;
    }, 1450);
  };

  const handleIntroClick = () => {
    if (phase === "greeting") {
      if (greetingTimer.current !== null) window.clearTimeout(greetingTimer.current);
      setPhase("showcase");
      return;
    }

    completeCurrentClip();
  };

  const handleIntroPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    if (
      event.target instanceof Element &&
      event.target.closest(".lumi-motion-start")
    ) {
      return;
    }

    handleIntroClick();
  };

  const markClipLoaded = (index: number) => {
    setLoadedClipIndices((current) =>
      current.includes(index) ? current : [...current, index],
    );
  };

  return (
    <section
      className={`lumi-motion-intro is-${phase}`}
      aria-label="Lumi 动作引导"
      onPointerDownCapture={handleIntroPointerDown}
    >
      <LumiWebGLParticleField />
      <h1 className="lumi-motion-greeting">
        Hi, I&apos;m Lum<span className="lumi-neon-i" aria-label="i">ı</span>
      </h1>
      <div className="lumi-motion-preload" aria-hidden="true">
        {cards.map((card, index) => (
          <video
            src={card.src}
            muted
            playsInline
            preload="auto"
            onCanPlayThrough={() => markClipLoaded(index)}
            key={card.id}
          />
        ))}
      </div>

      <div className="lumi-motion-left motion-preview-strip" aria-label="已播放动作">
        {completedIndices.map((index) => {
          const card = cards[index];
          const column = index % 2;
          const row = Math.floor(index / 2);

          return (
            <figure
              className={`lumi-motion-completed-card${
                loadedClipIndices.includes(index) ? " is-video-ready" : ""
              }`}
              style={
                {
                  "--settle-x": column === 0
                    ? "calc(50vw - var(--lumi-preview-left) - 104px)"
                    : "calc(50vw - var(--lumi-preview-left) - 336px)",
                  "--settle-y": row === 0 ? "149px" : "-149px",
                } as CSSProperties
              }
              key={card.id}
            >
              <video
                src={card.src}
                muted
                autoPlay
                loop
                playsInline
                preload="auto"
                onCanPlayThrough={() => markClipLoaded(index)}
              />
              <span className="lumi-motion-index" aria-hidden="true">
                {index + 1}
              </span>
              <figcaption>{card.label}</figcaption>
            </figure>
          );
        })}
      </div>

      {phase === "showcase" && (
        <figure
          className={`lumi-motion-stage${isTransitioning ? " is-transitioning" : ""}`}
          key={cards[currentIndex].id}
        >
          <video
            src={cards[currentIndex].src}
            muted
            autoPlay
            playsInline
            preload="auto"
            onCanPlayThrough={() => markClipLoaded(currentIndex)}
            onEnded={completeCurrentClip}
            onError={completeCurrentClip}
          />
          <span className="lumi-motion-index" aria-hidden="true">
            {currentIndex + 1}
          </span>
          <figcaption>{cards[currentIndex].label}</figcaption>
        </figure>
      )}

      {phase === "ready" && (
        <button
          type="button"
          className="lumi-motion-start"
          onClick={(event) => {
            event.stopPropagation();
            onStart();
          }}
        >
          开始教学 <span aria-hidden="true">→</span>
        </button>
      )}
    </section>
  );
}
