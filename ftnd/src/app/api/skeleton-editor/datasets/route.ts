import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_ROOT = path.resolve(process.cwd(), "..", "bknd", "data");
const ALLOWED_DATASETS = new Set([
  "cat",
  "cloud",
  "fade",
  "fight",
  "indo",
  "no",
]);

interface DatasetSummary {
  datasetId: string;
  title: string;
  videoCount: number;
  primaryVideo: {
    videoId: string;
    durationMs: number;
    width: number;
    height: number;
    frameCount: number;
  };
}

export async function GET() {
  try {
    const files = (await readdir(DATA_ROOT))
      .filter((file) => file.endsWith(".json"))
      .filter((file) => ALLOWED_DATASETS.has(path.basename(file, ".json")))
      .sort();

    const datasets = await Promise.all(
      files.map(async (file): Promise<DatasetSummary> => {
        const raw = await readFile(path.join(DATA_ROOT, file), "utf8");
        const dataset = JSON.parse(raw) as {
          datasetId: string;
          title?: string;
          videos?: Array<{
            videoId: string;
            sequence?: number;
            durationMs: number;
            width: number;
            height: number;
            frames?: unknown[];
          }>;
        };
        const primary =
          dataset.videos?.find((video) => video.sequence === 1) ??
          dataset.videos?.[0];
        if (!primary) {
          throw new Error(`${dataset.datasetId} 没有可编辑的视频。`);
        }
        return {
          datasetId: dataset.datasetId,
          title: dataset.title ?? dataset.datasetId,
          videoCount: dataset.videos?.length ?? 0,
          primaryVideo: {
            videoId: primary.videoId,
            durationMs: primary.durationMs,
            width: primary.width,
            height: primary.height,
            frameCount: primary.frames?.length ?? 0,
          },
        };
      }),
    );

    return NextResponse.json({ datasets });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "无法读取骨架数据目录。",
      },
      { status: 500 },
    );
  }
}
