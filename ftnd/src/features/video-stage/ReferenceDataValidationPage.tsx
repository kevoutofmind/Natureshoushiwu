"use client";

import { useEffect, useRef, useState } from "react";
import {
  buildReferenceDataset,
  loadReferenceManifest,
} from "./reference-template-builder";
import type {
  DatasetBuildProgress,
  ReferenceDanceDataset,
} from "./reference-dataset.types";

interface ValidationSummary {
  status: "passed" | "failed";
  danceId: string;
  sourceVideoCount: number;
  detectedFrameCount: number;
  poseFrameCount: number;
  completePoseFrameCount: number;
  poseCoverage: number;
  handCoverage: number;
  motionCount: number;
  templatesPerMotion: number[];
  framesPerTemplate: number[];
  errors: string[];
}

export default function ReferenceDataValidationPage({
  danceId,
}: {
  danceId: string;
}) {
  const started = useRef(false);
  const [progress, setProgress] = useState<DatasetBuildProgress | null>(null);
  const [summary, setSummary] = useState<ValidationSummary | null>(null);
  const [fatalError, setFatalError] = useState("");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const manifest = await loadReferenceManifest(danceId);
        const dataset = await buildReferenceDataset(manifest, setProgress);
        setSummary(summarize(dataset, manifest.references.length));
      } catch (error: unknown) {
        setFatalError(error instanceof Error ? error.message : String(error));
      }
    })();
  }, [danceId]);

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 24 }}>
      <h1>MediaPipe 范本数据验证</h1>
      <p>
        此页面会重新读取全部实例 MP4，并在浏览器中运行 MediaPipe Holistic。
      </p>
      {progress && (
        <p data-testid="validation-progress">
          {progress.message}（{progress.completedVideos}/{progress.totalVideos}）
        </p>
      )}
      {fatalError && (
        <pre data-testid="validation-error">{fatalError}</pre>
      )}
      {summary && (
        <pre data-testid="validation-result">
          {JSON.stringify(summary, null, 2)}
        </pre>
      )}
    </main>
  );
}

function summarize(
  dataset: ReferenceDanceDataset,
  expectedVideoCount: number,
): ValidationSummary {
  const frames = dataset.templatePacks.flatMap((pack) =>
    pack.templates.flatMap((template) => template.frames),
  );
  const completePoseFrameCount = frames.filter(
    (frame) => frame.pose.length >= 33,
  ).length;
  const errors: string[] = [];
  const templatesPerMotion = dataset.templatePacks.map(
    (pack) => pack.templates.length,
  );
  const framesPerTemplate = dataset.templatePacks.flatMap((pack) =>
    pack.templates.map((template) => template.frames.length),
  );
  const poseCoverage =
    frames.length === 0 ? 0 : completePoseFrameCount / frames.length;

  if (dataset.sourceVideoCount !== expectedVideoCount) {
    errors.push(
      `只处理了 ${dataset.sourceVideoCount}/${expectedVideoCount} 个实例视频`,
    );
  }
  if (dataset.extraction.detectedFrameCount < expectedVideoCount * 20) {
    errors.push("MediaPipe 成功识别的源视频帧过少");
  }
  if (poseCoverage < 0.98) {
    errors.push(`完整姿态点覆盖率过低：${(poseCoverage * 100).toFixed(1)}%`);
  }
  if (templatesPerMotion.some((count) => count < 2)) {
    errors.push("至少一个动作缺少两个独立实例范本");
  }
  if (framesPerTemplate.some((count) => count < 5)) {
    errors.push("至少一个动作范本少于 5 帧");
  }

  return {
    status: errors.length === 0 ? "passed" : "failed",
    danceId: dataset.danceId,
    sourceVideoCount: dataset.sourceVideoCount,
    detectedFrameCount: dataset.extraction.detectedFrameCount,
    poseFrameCount: frames.length,
    completePoseFrameCount,
    poseCoverage: Number(poseCoverage.toFixed(3)),
    handCoverage: dataset.extraction.handCoverage,
    motionCount: dataset.templatePacks.length,
    templatesPerMotion,
    framesPerTemplate,
    errors,
  };
}
