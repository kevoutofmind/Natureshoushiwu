"use client";

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import LumiWebGLParticleField from "./LumiWebGLParticleField";

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

const MOTION_CLIPS: Record<string, string[]> = {
  "dance-001": ["cat1.mp4", "cat2.mp4", "cat3.mp4", "cat4.mp4"],
  "dance-002": ["cloud1.mp4", "cloud2.mp4", "cloud3.mp4", "cloud4.mp4"],
  "dance-003": ["fade1.mp4", "fade2.mp4", "fade3.mp4", "fade4.mp4"],
  "dance-004": ["fightt1.mp4", "fightt2.mp4", "fightt3.mp4", "fighttt4.mp4"],
  "dance-005": ["indoo1.mp4", "indoo2.mp4", "indoo3.mp4", "indoo4.mp4"],
  "dance-006": ["noo1.mp4", "noo2.mp4", "noo3.mp4", "noo4.mp4"],
};

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
  const resolvedDanceId = danceId in MOTION_CLIPS ? danceId : "dance-001";
  const clips = MOTION_CLIPS[resolvedDanceId];
  const cards = useMemo(
    () =>
      clips.map((fileName, index) => ({
        id: `${resolvedDanceId}-${index}`,
        label: motions[index]?.label || `动作 ${index + 1}`,
        src: `/lumi-motions/${resolvedDanceId}/${fileName}`,
      })),
    [clips, motions, resolvedDanceId],
  );

  useEffect(() => {
    // Fade in, then leave the greeting in the center for a full four seconds.
    const timer = window.setTimeout(() => setPhase("showcase"), 4600);
    return () => window.clearTimeout(timer);
  }, []);

  const completeCurrentClip = () => {
    if (isTransitioning) return;

    setIsTransitioning(true);
    setCompletedIndices((current) =>
      current.includes(currentIndex) ? current : [...current, currentIndex],
    );

    if (currentIndex >= cards.length - 1) {
      window.setTimeout(() => {
        setIsTransitioning(false);
        setPhase("ready");
      }, 1450);
      return;
    }

    window.setTimeout(() => {
      setCurrentIndex((current) => current + 1);
      setIsTransitioning(false);
    }, 1450);
  };

  const markClipLoaded = (index: number) => {
    setLoadedClipIndices((current) =>
      current.includes(index) ? current : [...current, index],
    );
  };

  return (
    <section className={`lumi-motion-intro is-${phase}`} aria-label="Lumi 动作引导">
      <LumiWebGLParticleField />
      <h1 className="lumi-motion-greeting">
        Hi, I&apos;m Lum<span className="lumi-neon-i">i</span>
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
          className={`lumi-motion-stage${isTransitioning ? " is-holding" : ""}`}
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
        <button type="button" className="lumi-motion-start" onClick={onStart}>
          开始教学 <span aria-hidden="true">→</span>
        </button>
      )}
    </section>
  );
}
