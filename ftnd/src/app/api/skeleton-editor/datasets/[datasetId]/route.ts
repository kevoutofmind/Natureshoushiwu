import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATA_ROOT = path.resolve(process.cwd(), "..", "bknd", "data");
const BACKUP_ROOT = path.join(DATA_ROOT, ".backups");
const ALLOWED_DATASETS = new Set([
  "cat",
  "cloud",
  "fade",
  "fight",
  "indo",
  "no",
]);

type RouteContext = { params: Promise<{ datasetId: string }> };

function resolveDatasetFile(datasetId: string) {
  if (!ALLOWED_DATASETS.has(datasetId)) {
    throw new Error("不支持的数据集。");
  }
  return path.join(DATA_ROOT, `${datasetId}.json`);
}

function validateDataset(
  body: unknown,
  expectedDatasetId: string,
): asserts body is {
  schemaVersion: "skeleton-video-dataset-v1";
  datasetId: string;
  videos: Array<{ frames: unknown[] }>;
} {
  if (!body || typeof body !== "object") {
    throw new Error("数据集必须是 JSON 对象。");
  }
  const dataset = body as {
    schemaVersion?: unknown;
    datasetId?: unknown;
    videos?: unknown;
  };
  if (dataset.schemaVersion !== "skeleton-video-dataset-v1") {
    throw new Error("骨架数据 schemaVersion 不正确。");
  }
  if (dataset.datasetId !== expectedDatasetId) {
    throw new Error("请求路径与数据集 datasetId 不一致。");
  }
  if (
    !Array.isArray(dataset.videos) ||
    dataset.videos.length !== 10 ||
    dataset.videos.some(
      (video) =>
        !video ||
        typeof video !== "object" ||
        !Array.isArray((video as { frames?: unknown }).frames),
    )
  ) {
    throw new Error("每一类必须保留各自的 10 个视频及其帧数据。");
  }
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { datasetId } = await context.params;
    const raw = await readFile(resolveDatasetFile(datasetId), "utf8");
    return new NextResponse(raw, {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "读取失败。" },
      { status: 404 },
    );
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { datasetId } = await context.params;
    const file = resolveDatasetFile(datasetId);
    const raw = await request.text();
    if (raw.length > 32 * 1024 * 1024) {
      return NextResponse.json(
        { error: "数据集超过 32 MB，已拒绝保存。" },
        { status: 413 },
      );
    }
    const dataset: unknown = JSON.parse(raw);
    validateDataset(dataset, datasetId);

    const currentDataset = JSON.parse(await readFile(file, "utf8")) as {
      processing?: { bodyNormalization?: { appliedAt?: string } };
    };
    const currentFadeRevision =
      currentDataset.processing?.bodyNormalization?.appliedAt;
    const incomingFadeRevision = (
      dataset as {
        processing?: { bodyNormalization?: { appliedAt?: string } };
      }
    ).processing?.bodyNormalization?.appliedAt;
    if (
      datasetId === "fade" &&
      currentFadeRevision &&
      incomingFadeRevision !== currentFadeRevision
    ) {
      return NextResponse.json(
        {
          error:
            "fade 数据已完成批量身体对齐。请刷新页面后再继续编辑，旧页面不会覆盖新数据。",
        },
        { status: 409 },
      );
    }

    await mkdir(BACKUP_ROOT, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupName = `${datasetId}-${timestamp}.json`;
    await copyFile(file, path.join(BACKUP_ROOT, backupName));
    await writeFile(file, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

    return NextResponse.json({
      saved: true,
      datasetId,
      backupFile: `.backups/${backupName}`,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存失败。" },
      { status: 400 },
    );
  }
}
