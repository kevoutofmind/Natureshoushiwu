import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDir, "..", "..");
const dataRoot = resolve(projectRoot, "bknd", "data");
const viewerFile = resolve(projectRoot, "bknd", "tools", "skeleton-qc-viewer.html");
const videoRoot = resolve(process.argv[2] || "D:\\move");
const requestedPort = Number(process.argv[3] || 4177);
const progressLog = resolve(dataRoot, "extraction-unattended.log");
const watchdogPidFile = resolve(dataRoot, "extraction-watchdog.pid");
const monitoredGroups = ["cat", "cloud", "fade", "fight", "indo", "no"];

if (!existsSync(dataRoot)) throw new Error(`骨架数据目录不存在：${dataRoot}`);
if (!existsSync(viewerFile)) throw new Error(`可视化页面不存在：${viewerFile}`);
if (!existsSync(videoRoot)) throw new Error(`视频目录不存在：${videoRoot}`);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
};

function sendJson(response, statusCode, value) {
  const body = JSON.stringify(value);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function safeFile(root, encodedName) {
  const name = basename(decodeURIComponent(encodedName));
  const fullPath = resolve(root, name);
  return fullPath.startsWith(root) ? fullPath : null;
}

function listDatasets() {
  return readdirSync(dataRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))
    .flatMap((entry) => {
      try {
        const dataset = JSON.parse(readFileSync(resolve(dataRoot, entry.name), "utf8"));
        if (!Array.isArray(dataset.videos)) return [];
        return [{
          file: entry.name,
          datasetId: dataset.datasetId || entry.name.replace(/\.json$/i, ""),
          title: dataset.title || dataset.datasetId || entry.name,
          generatedAt: dataset.generatedAt,
          sourceVideoCount: dataset.sourceVideoCount,
          skippedSourceFiles: dataset.skippedSourceFiles || [],
          summary: dataset.summary || {},
          videos: dataset.videos.map((video) => ({
            sourceFile: video.sourceFile,
            sequence: video.sequence,
            durationMs: video.durationMs,
            width: video.width,
            height: video.height,
            detectedFrameCount: video.detectedFrameCount,
            poseCoverage: video.poseCoverage,
            handCoverage: video.handCoverage,
            available: existsSync(resolve(videoRoot, basename(video.sourceFile))),
          })),
        }];
      } catch (error) {
        return [{
          file: entry.name,
          datasetId: entry.name,
          title: entry.name,
          error: String(error?.message || error),
          videos: [],
        }];
      }
    });
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function extractionProgress() {
  const groups = monitoredGroups.map((groupName) => {
    const filename = resolve(dataRoot, `${groupName}.json`);
    if (!existsSync(filename)) {
      return {
        name: groupName,
        successful: 0,
        failed: 0,
        skipped: 0,
        pending: 10,
        status: "not-started",
      };
    }
    try {
      const dataset = JSON.parse(readFileSync(filename, "utf8"));
      const failureReasons = dataset.processing?.failureReasons || {};
      const skipped = dataset.skippedSourceFiles || [];
      const explicitSkipped = groupName === "cat" && skipped.includes("cat (4).mp4") ? 1 : 0;
      const successful = Array.isArray(dataset.videos) ? dataset.videos.length : 0;
      const failed = Object.keys(failureReasons).length;
      return {
        name: groupName,
        successful,
        failed,
        skipped: explicitSkipped,
        pending: Math.max(0, 10 - successful - failed - explicitSkipped),
        status: dataset.processing?.status || "partial",
      };
    } catch (error) {
      return {
        name: groupName,
        successful: 0,
        failed: 0,
        skipped: 0,
        pending: 10,
        status: "invalid-json",
        error: String(error?.message || error),
      };
    }
  });

  let watchdogPid = null;
  if (existsSync(watchdogPidFile)) {
    watchdogPid = Number(readFileSync(watchdogPidFile, "utf8").trim());
  }
  let logLines = [];
  let updatedAt = null;
  if (existsSync(progressLog)) {
    const stats = statSync(progressLog);
    updatedAt = stats.mtime.toISOString();
    logLines = readFileSync(progressLog, "utf8").split(/\r?\n/).filter(Boolean);
  }
  const recentRelevant = logLines
    .filter((line) =>
      /(?:VIDEO |HEARTBEAT |TRANSCODE|SOURCE_READY|SAVED |GAVE_UP |COMPLETE |WATCHDOG_|RETRY )/.test(line),
    )
    .slice(-12);
  let current = null;
  for (let index = logLines.length - 1; index >= 0; index -= 1) {
    const line = logLines[index];
    const transcode = line.match(/TRANSCODE file=(.*?) progress=(\d+)/);
    if (transcode) {
      current = {
        file: transcode[1],
        stage: "transcoding",
        progress: Number(transcode[2]),
      };
      break;
    }
    const transcodeStart = line.match(/TRANSCODE_START file=(.*?) attempt=/);
    if (transcodeStart) {
      current = { file: transcodeStart[1], stage: "transcoding", progress: 0 };
      break;
    }
    const heartbeat = line.match(
      /HEARTBEAT file=(.*?) stage=([^\s]+) progress=([^\s]+)/,
    );
    if (heartbeat) {
      current = {
        file: heartbeat[1],
        stage: heartbeat[2],
        progress: heartbeat[3] === "-" ? null : Number(heartbeat[3]),
      };
      break;
    }
  }
  const totals = groups.reduce(
    (result, group) => ({
      successful: result.successful + group.successful,
      failed: result.failed + group.failed,
      skipped: result.skipped + group.skipped,
      pending: result.pending + group.pending,
    }),
    { successful: 0, failed: 0, skipped: 0, pending: 0 },
  );
  return {
    running: processExists(watchdogPid),
    watchdogPid,
    updatedAt,
    current,
    totals,
    groups,
    recentLog: recentRelevant,
  };
}

function streamFile(request, response, fullPath) {
  if (!fullPath || !existsSync(fullPath)) {
    sendJson(response, 404, { error: "文件不存在" });
    return;
  }
  const stats = statSync(fullPath);
  const contentType = mimeTypes[extname(fullPath).toLowerCase()] || "application/octet-stream";
  const range = request.headers.range;
  if (!range) {
    response.writeHead(200, {
      "content-type": contentType,
      "content-length": stats.size,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    });
    createReadStream(fullPath).pipe(response);
    return;
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    response.writeHead(416, { "content-range": `bytes */${stats.size}` });
    response.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1;
  if (start > end || start >= stats.size) {
    response.writeHead(416, { "content-range": `bytes */${stats.size}` });
    response.end();
    return;
  }
  response.writeHead(206, {
    "content-type": contentType,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${stats.size}`,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  });
  createReadStream(fullPath, { start, end }).pipe(response);
}

const server = createServer((request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method !== "GET") {
      sendJson(response, 405, { error: "只支持 GET" });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      streamFile(request, response, viewerFile);
      return;
    }
    if (url.pathname === "/api/datasets") {
      sendJson(response, 200, {
        videoRoot,
        dataRoot,
        datasets: listDatasets(),
      });
      return;
    }
    if (url.pathname === "/api/progress") {
      sendJson(response, 200, extractionProgress());
      return;
    }
    if (url.pathname.startsWith("/data/")) {
      streamFile(request, response, safeFile(dataRoot, url.pathname.slice(6)));
      return;
    }
    if (url.pathname.startsWith("/video/")) {
      streamFile(request, response, safeFile(videoRoot, url.pathname.slice(7)));
      return;
    }
    if (url.pathname === "/health") {
      sendJson(response, 200, { ok: true });
      return;
    }
    sendJson(response, 404, { error: "页面不存在" });
  } catch (error) {
    sendJson(response, 500, { error: String(error?.message || error) });
  }
});

server.listen(requestedPort, "127.0.0.1", () => {
  console.log(`MediaPipe 骨架可视化：http://127.0.0.1:${requestedPort}`);
  console.log(`视频目录：${videoRoot}`);
  console.log(`数据目录：${dataRoot}`);
});
