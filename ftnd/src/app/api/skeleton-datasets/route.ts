import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";

const DATASET_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_BODY_BYTES = 128 * 1024 * 1024;

export async function POST(request: Request) {
  const text = await request.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "数据集超过 128 MB 限制。" }, { status: 413 });
  }

  let dataset: unknown;
  try {
    dataset = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "提交内容不是有效 JSON。" }, { status: 400 });
  }

  if (!isSkeletonDataset(dataset)) {
    return NextResponse.json({ error: "骨架数据集格式不完整。" }, { status: 400 });
  }

  const outputDirectory = resolve(
    process.cwd(),
    "..",
    "data",
    "dances",
    dataset.datasetId,
    "processed",
  );
  const outputFile = resolve(outputDirectory, "skeleton-dataset.json");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputFile, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

  return NextResponse.json({
    ok: true,
    outputFile,
    videoCount: dataset.videos.length,
    frameCount: dataset.summary.totalDetectedFrames,
  });
}

function isSkeletonDataset(
  value: unknown,
): value is {
  schemaVersion: "skeleton-video-dataset-v1";
  datasetId: string;
  videos: unknown[];
  summary: { totalDetectedFrames: number };
} {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const summary = candidate.summary as Record<string, unknown> | undefined;
  return (
    candidate.schemaVersion === "skeleton-video-dataset-v1" &&
    typeof candidate.datasetId === "string" &&
    DATASET_ID_PATTERN.test(candidate.datasetId) &&
    Array.isArray(candidate.videos) &&
    candidate.videos.length > 0 &&
    Boolean(summary) &&
    typeof summary?.totalDetectedFrames === "number"
  );
}
