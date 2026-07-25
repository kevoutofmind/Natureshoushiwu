"use client";

import {
  FilesetResolver,
  HolisticLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import { useState } from "react";

const WASM_ROOT = "/mediapipe/wasm";
const MODEL_URL = "/mediapipe/models/holistic_landmarker.task";
const SAMPLE_FPS = 10;

type Landmark = {
  x: number;
  y: number;
  z: number;
  visibility?: number;
};

type SkeletonFrame = {
  timestampMs: number;
  pose: Landmark[];
  leftHand: Landmark[];
  rightHand: Landmark[];
};

type ExtractedVideo = {
  videoId: string;
  sourceFile: string;
  durationMs: number;
  width: number;
  height: number;
  sampledFrameCount: number;
  detectedFrameCount: number;
  poseCoverage: number;
  handCoverage: number;
  frames: SkeletonFrame[];
};

export default function SkeletonImportPage() {
  const [files, setFiles] = useState<File[]>([]);
  const [status, setStatus] = useState("请选择视频。");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState("");

  async function startImport() {
    if (files.length === 0 || running) return;
    setRunning(true);
    setResult("");

    let landmarker: HolisticLandmarker | undefined;
    try {
      setStatus("正在加载本地 MediaPipe Holistic 模型…");
      const fileset = await FilesetResolver.forVisionTasks(WASM_ROOT);
      try {
        landmarker = await createLandmarker(fileset, "GPU");
      } catch {
        landmarker = await createLandmarker(fileset, "CPU");
      }

      const videos: ExtractedVideo[] = [];
      let inferenceOffsetMs = 0;
      const sources = files.map((file) => ({
        name: file.name,
        url: URL.createObjectURL(file),
        revokeUrl: true,
      }));
      const sortedFiles = [...sources].sort((left, right) =>
        left.name.localeCompare(right.name),
      );

      for (let index = 0; index < sortedFiles.length; index += 1) {
        const source = sortedFiles[index];
        setStatus(`正在识别 ${source.name}（${index + 1}/${sortedFiles.length}）…`);
        const video = await extractVideo(source, landmarker, inferenceOffsetMs);
        inferenceOffsetMs += video.durationMs + 1000;
        videos.push(video);
      }

      const totalSampledFrames = videos.reduce(
        (sum, video) => sum + video.sampledFrameCount,
        0,
      );
      const totalDetectedFrames = videos.reduce(
        (sum, video) => sum + video.detectedFrameCount,
        0,
      );
      const dataset = {
        schemaVersion: "skeleton-video-dataset-v1" as const,
        datasetId: "move-001",
        title: "D:/move 六动作骨架数据集",
        generatedAt: new Date().toISOString(),
        extraction: {
          engine: "mediapipe-holistic-landmarker",
          model: "holistic_landmarker.task",
          sampleFps: SAMPLE_FPS,
          coordinateSystem: "normalized-image-v1",
          mirrored: false,
          poseLandmarkCount: 33,
          handLandmarkCount: 21,
        },
        sourceVideoCount: videos.length,
        videos,
        summary: {
          totalSampledFrames,
          totalDetectedFrames,
          poseCoverage: round(
            totalSampledFrames === 0
              ? 0
              : totalDetectedFrames / totalSampledFrames,
          ),
          averageHandCoverage: round(
            videos.length === 0
              ? 0
              : videos.reduce((sum, video) => sum + video.handCoverage, 0) /
                  videos.length,
          ),
        },
      };

      setStatus("正在写入项目数据目录…");
      const response = await fetch("/api/skeleton-datasets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(dataset),
      });
      const payload = (await response.json()) as {
        ok?: boolean;
        outputFile?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "无法保存骨架数据集。");
      }
      setResult(
        JSON.stringify(
          {
            status: "completed",
            outputFile: payload.outputFile,
            sourceVideoCount: dataset.sourceVideoCount,
            totalSampledFrames,
            totalDetectedFrames,
            poseCoverage: dataset.summary.poseCoverage,
            averageHandCoverage: dataset.summary.averageHandCoverage,
            videos: videos.map((video) => ({
              videoId: video.videoId,
              sourceFile: video.sourceFile,
              durationMs: video.durationMs,
              detectedFrameCount: video.detectedFrameCount,
              poseCoverage: video.poseCoverage,
              handCoverage: video.handCoverage,
            })),
          },
          null,
          2,
        ),
      );
      setStatus("骨架数据已写入项目。");
    } catch (error) {
      setStatus("处理失败。");
      setResult(error instanceof Error ? error.message : String(error));
    } finally {
      landmarker?.close();
      setRunning(false);
    }
  }

  return (
    <main style={{ maxWidth: 920, margin: "40px auto", padding: 24 }}>
      <h1>本地视频骨架数据导入</h1>
      <p>选择多个 MP4 后，以 10 FPS 提取全身姿态和左右手关键点。</p>
      <input
        aria-label="选择视频"
        type="file"
        accept="video/mp4"
        multiple
        disabled={files.length === 0 || running}
        onChange={(event) => {
          setFiles(Array.from(event.target.files ?? []));
          setResult("");
        }}
      />
      <button
        type="button"
        disabled={running}
        onClick={() => void startImport()}
        style={{ display: "block", marginTop: 16 }}
      >
        {running ? "正在处理…" : "开始生成骨架数据"}
      </button>
      <p data-testid="skeleton-import-status">{status}</p>
      {result && (
        <pre data-testid="skeleton-import-result">{result}</pre>
      )}
    </main>
  );
}

async function createLandmarker(
  fileset: Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>,
  delegate: "GPU" | "CPU",
) {
  return HolisticLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    minPoseDetectionConfidence: 0.45,
    minPosePresenceConfidence: 0.45,
    minHandLandmarksConfidence: 0.4,
  });
}

async function extractVideo(
  source: { name: string; url: string; revokeUrl: boolean },
  landmarker: HolisticLandmarker,
  inferenceOffsetMs: number,
): Promise<ExtractedVideo> {
  const video = await loadVideo(source.url);
  const durationMs = Math.round(video.duration * 1000);
  const width = video.videoWidth;
  const height = video.videoHeight;
  const sampleIntervalMs = Math.max(80, Math.round(1000 / SAMPLE_FPS));
  const sampledFrameCount = Math.floor(durationMs / sampleIntervalMs) + 1;
  const frames: SkeletonFrame[] = [];

  try {
    for (let videoMs = 0; videoMs <= durationMs; videoMs += sampleIntervalMs) {
      await seekVideo(video, Math.min(video.duration, videoMs / 1000));
      const detection = landmarker.detectForVideo(
        video,
        inferenceOffsetMs + videoMs,
      );
      const pose = detection.poseLandmarks[0];
      if (!pose?.length) continue;
      frames.push({
        timestampMs: videoMs,
        pose: copyLandmarks(pose),
        leftHand: copyLandmarks(detection.leftHandLandmarks[0]),
        rightHand: copyLandmarks(detection.rightHandLandmarks[0]),
      });
    }
  } finally {
    video.removeAttribute("src");
    video.load();
    if (source.revokeUrl) URL.revokeObjectURL(source.url);
  }

  const handFrames = frames.filter(
    (frame) => frame.leftHand.length >= 21 || frame.rightHand.length >= 21,
  ).length;
  return {
    videoId: source.name.replace(/\.[^.]+$/, "").toLowerCase(),
    sourceFile: source.name,
    durationMs,
    width,
    height,
    sampledFrameCount,
    detectedFrameCount: frames.length,
    poseCoverage: round(
      sampledFrameCount === 0 ? 0 : frames.length / sampledFrameCount,
    ),
    handCoverage: round(frames.length === 0 ? 0 : handFrames / frames.length),
    frames,
  };
}

function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("无法读取所选视频。"));
    video.src = url;
    video.load();
  });
}

function seekVideo(video: HTMLVideoElement, seconds: number): Promise<void> {
  if (Math.abs(video.currentTime - seconds) < 0.005) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("视频定位帧超时。")),
      5000,
    );
    video.onseeked = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.currentTime = seconds;
  });
}

function copyLandmarks(
  landmarks: NormalizedLandmark[] | undefined,
): Landmark[] {
  return (landmarks ?? []).map(({ x, y, z, visibility }) => ({
    x: round(x),
    y: round(y),
    z: round(z),
    visibility:
      typeof visibility === "number" ? round(visibility) : undefined,
  }));
}

function round(value: number) {
  return Number(value.toFixed(6));
}
