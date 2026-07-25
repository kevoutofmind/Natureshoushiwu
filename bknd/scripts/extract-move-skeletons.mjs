import { createServer } from "node:http";
import { spawn } from "node:child_process";
import {
  createReadStream,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..", "..");
const videoRoot = resolve(process.argv[2] || "D:\\move");
const outputRoot = resolve(projectRoot, "bknd", "data");
const sampleFps = 10;
const expectedGroups = ["cat", "cloud", "fade", "fight", "indo", "no"];
const skippedVideos = ["cat (10).mp4"];
const visionBundle = resolve(
  projectRoot,
  "ftnd",
  "vendor",
  "mediapipe",
  "vision_bundle.mjs",
);
const mediaPipeRoot = resolve(projectRoot, "ftnd", "public", "mediapipe");

const groups = collectGroups(videoRoot);
validateGroups(groups);
validateRuntimeFiles();

let chrome;
let server;
let completedSummary;
let fatalError;
let finishRun;
const completion = new Promise((resolveRun) => {
  finishRun = resolveRun;
});

server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      sendText(response, 200, processingPage, "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && url.pathname === "/manifest.json") {
      const manifest = {
        sampleFps,
        skippedVideos,
        groups: Object.fromEntries(
          expectedGroups.map((groupName) => [
            groupName,
            groups.get(groupName).map((entry) => ({
              sequence: entry.sequence,
              sourceFile: entry.sourceFile,
              videoUrl: `/video/${encodeURIComponent(entry.diskFile)}`,
            })),
          ]),
        ),
      };
      sendText(
        response,
        200,
        JSON.stringify(manifest),
        "application/json; charset=utf-8",
      );
      return;
    }
    if (request.method === "GET" && url.pathname === "/vision_bundle.mjs") {
      serveFile(request, response, visionBundle, "text/javascript; charset=utf-8");
      return;
    }
    if (
      request.method === "GET" &&
      url.pathname.startsWith("/mediapipe/")
    ) {
      const relativePath = decodeURIComponent(
        url.pathname.slice("/mediapipe/".length),
      );
      const filename = safeChild(mediaPipeRoot, relativePath);
      serveFile(request, response, filename, contentType(filename));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/video/")) {
      const diskFile = decodeURIComponent(url.pathname.slice("/video/".length));
      const filename = safeChild(videoRoot, diskFile);
      serveFile(request, response, filename, "video/mp4");
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/save/")) {
      const filename = basename(
        decodeURIComponent(url.pathname.slice("/save/".length)),
      );
      const groupName = filename.replace(/\.json$/i, "");
      if (!expectedGroups.includes(groupName) || filename !== `${groupName}.json`) {
        sendText(response, 400, "Invalid output filename.");
        return;
      }
      const body = await readBody(request, 256 * 1024 * 1024);
      const parsed = JSON.parse(body);
      validateDataset(parsed, groupName);
      const outputFile = resolve(outputRoot, filename);
      writeFileSync(outputFile, `${body}\n`, "utf8");
      console.log(
        `SAVED ${filename} videos=${parsed.videos.length} frames=${parsed.summary.totalDetectedFrames} pose=${parsed.summary.poseCoverage}`,
      );
      sendText(response, 200, JSON.stringify({ ok: true }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/progress") {
      const progress = JSON.parse(await readBody(request, 1024 * 1024));
      console.log(
        `${progress.skipped ? "SKIPPED" : "PROGRESS"} group=${progress.group} video=${progress.video}/${progress.total} file=${progress.file}${progress.reason ? ` reason=${progress.reason}` : ""}`,
      );
      sendText(response, 200, JSON.stringify({ ok: true }));
      return;
    }
    if (request.method === "POST" && url.pathname === "/complete") {
      completedSummary = JSON.parse(await readBody(request, 4 * 1024 * 1024));
      sendText(response, 200, JSON.stringify({ ok: true }));
      finishRun();
      return;
    }
    if (request.method === "POST" && url.pathname === "/fail") {
      fatalError = await readBody(request, 1024 * 1024);
      sendText(response, 200, JSON.stringify({ ok: true }));
      finishRun();
      return;
    }
    sendText(response, 404, "Not found.");
  } catch (error) {
    sendText(
      response,
      500,
      error instanceof Error ? error.message : String(error),
    );
  }
});

server.listen(0, "127.0.0.1", async () => {
  const address = server.address();
  if (!address || typeof address === "string") {
    fatalError = "Unable to allocate a local port.";
    finishRun();
    return;
  }
  const chromePath = findChrome();
  const profile = await mkdtemp(join(tmpdir(), "move-skeleton-"));
  chrome = spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-sync",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${profile}`,
      `http://127.0.0.1:${address.port}/`,
    ],
    { stdio: "ignore", windowsHide: true },
  );
  chrome.once("exit", (code) => {
    if (!completedSummary && !fatalError) {
      fatalError = `Headless Chrome exited before completion (code ${code}).`;
      finishRun();
    }
  });
  completion.finally(async () => {
    chrome?.kill();
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }).catch(() => {});
});

function collectGroups(root) {
  const result = new Map(expectedGroups.map((name) => [name, []]));
  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".mp4")
    .map((entry) => entry.name)
    .filter((filename) => !skippedVideos.includes(filename))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

  for (const diskFile of files) {
    const match = /^(.+?)\s*\((\d+)\)\.mp4$/i.exec(diskFile);
    if (!match) throw new Error(`Unexpected video filename: ${diskFile}`);
    let groupName = match[1].trim().toLowerCase();
    let sequence = Number(match[2]);
    let sourceFile = diskFile;
    if (groupName === "fade" && sequence === 11) {
      groupName = "fight";
      sequence = 1;
      sourceFile = "fight (1).mp4";
    }
    if (!result.has(groupName)) {
      throw new Error(`Unexpected group name: ${groupName}`);
    }
    result.get(groupName).push({ diskFile, sourceFile, sequence });
  }

  for (const entries of result.values()) {
    entries.sort((left, right) => left.sequence - right.sequence);
  }
  return result;
}

function validateGroups(groupMap) {
  const total = [...groupMap.values()].reduce(
    (sum, entries) => sum + entries.length,
    0,
  );
  if (total !== 59) throw new Error(`Expected 59 videos after skips, found ${total}.`);
  for (const groupName of expectedGroups) {
    const entries = groupMap.get(groupName);
    const sequences = entries.map((entry) => entry.sequence).join(",");
    const expectedCount = groupName === "cat" ? 9 : 10;
    const expectedSequences =
      groupName === "cat" ? "1,2,3,5,6,7,8,9,10" : "1,2,3,4,5,6,7,8,9,10";
    if (entries.length !== expectedCount || sequences !== expectedSequences) {
      throw new Error(
        `Invalid group ${groupName}: count=${entries.length}, sequences=${sequences}`,
      );
    }
  }
}

function validateRuntimeFiles() {
  const required = [
    visionBundle,
    resolve(mediaPipeRoot, "models", "holistic_landmarker.task"),
    resolve(mediaPipeRoot, "wasm", "vision_wasm_internal.js"),
    resolve(mediaPipeRoot, "wasm", "vision_wasm_internal.wasm"),
    resolve(mediaPipeRoot, "wasm", "vision_wasm_module_internal.js"),
    resolve(mediaPipeRoot, "wasm", "vision_wasm_module_internal.wasm"),
    resolve(mediaPipeRoot, "wasm", "vision_wasm_nosimd_internal.js"),
    resolve(mediaPipeRoot, "wasm", "vision_wasm_nosimd_internal.wasm"),
  ];
  for (const filename of required) {
    if (!existsSync(filename)) throw new Error(`Missing runtime file: ${filename}`);
  }
  if (!existsSync(outputRoot)) throw new Error(`Missing output directory: ${outputRoot}`);
}

function validateDataset(dataset, expectedName) {
  const expectedOriginalCount = 10;
  if (
    dataset?.schemaVersion !== "skeleton-video-dataset-v1" ||
    dataset?.datasetId !== expectedName ||
    !Array.isArray(dataset?.videos) ||
    dataset.videos.length === 0 ||
    dataset?.sourceVideoCount !== dataset.videos.length ||
    !Array.isArray(dataset?.skippedSourceFiles) ||
    dataset.videos.length + dataset.skippedSourceFiles.length !==
      expectedOriginalCount
  ) {
    throw new Error(`Invalid generated dataset for ${expectedName}.`);
  }
  for (const video of dataset.videos) {
    if (!Array.isArray(video.frames) || video.frames.length === 0) {
      throw new Error(`No skeleton frames for ${video.sourceFile}.`);
    }
    if (video.frames.some((frame) => frame.pose?.length !== 33)) {
      throw new Error(`Incomplete pose frame in ${video.sourceFile}.`);
    }
  }
}

function findChrome() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const match = candidates.find(existsSync);
  if (!match) throw new Error("Chrome or Edge was not found.");
  return match;
}

function safeChild(root, relativePath) {
  const filename = resolve(root, relativePath);
  const normalizedRoot = `${resolve(root)}\\`;
  if (!filename.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
    throw new Error("Invalid local file path.");
  }
  return filename;
}

function serveFile(request, response, filename, type) {
  const stat = statSync(filename);
  const range = request.headers.range;
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", type);
  response.setHeader("Cache-Control", "no-store");
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match) {
      response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      response.end();
      return;
    }
    const start = match[1] ? Number(match[1]) : 0;
    const end = match[2] ? Number(match[2]) : stat.size - 1;
    if (start > end || end >= stat.size) {
      response.writeHead(416, { "Content-Range": `bytes */${stat.size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${stat.size}`,
      "Content-Length": end - start + 1,
    });
    createReadStream(filename, { start, end }).pipe(response);
    return;
  }
  response.writeHead(200, { "Content-Length": stat.size });
  createReadStream(filename).pipe(response);
}

function contentType(filename) {
  const extension = extname(filename).toLowerCase();
  if (extension === ".js" || extension === ".mjs") {
    return "text/javascript; charset=utf-8";
  }
  if (extension === ".wasm") return "application/wasm";
  if (extension === ".task") return "application/octet-stream";
  return "application/octet-stream";
}

function sendText(response, status, body, type = "text/plain; charset=utf-8") {
  response.writeHead(status, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readBody(request, maxBytes) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        rejectBody(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () =>
      resolveBody(Buffer.concat(chunks).toString("utf8")),
    );
    request.on("error", rejectBody);
  });
}

const processingPage = String.raw`<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8">
<title>Local MediaPipe Batch Extractor</title>
<pre id="status">starting</pre>
<script type="module">
import {
  FilesetResolver,
  HolisticLandmarker
} from "/vision_bundle.mjs";

const status = document.querySelector("#status");
const round = (value) => Number(value.toFixed(6));
const copyLandmarks = (landmarks) =>
  (landmarks || []).map(({ x, y, z, visibility }) => ({
    x: round(x),
    y: round(y),
    z: round(z),
    ...(typeof visibility === "number"
      ? { visibility: round(visibility) }
      : {}),
  }));

try {
  const manifest = await fetch("/manifest.json").then((response) => response.json());
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  let inferenceOffsetMs = 0;
  const summaries = [];

  for (const [groupName, entries] of Object.entries(manifest.groups)) {
    const videos = [];
    const skippedSourceFiles =
      groupName === "cat" ? [...manifest.skippedVideos] : [];
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      status.textContent =
        groupName + " " + (index + 1) + "/" + entries.length + " " + entry.sourceFile;
      await fetch("/progress", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          group: groupName,
          video: index + 1,
          total: entries.length,
          file: entry.sourceFile,
        }),
      });
      const landmarker = await HolisticLandmarker.createFromOptions(fileset, {
        baseOptions: {
          modelAssetPath: "/mediapipe/models/holistic_landmarker.task",
          delegate: "CPU",
        },
        runningMode: "VIDEO",
        minPoseDetectionConfidence: 0.45,
        minPosePresenceConfidence: 0.45,
        minHandLandmarksConfidence: 0.4,
      });
      let extracted;
      try {
        extracted = await extractVideo(
          entry,
          landmarker,
          manifest.sampleFps,
          inferenceOffsetMs,
        );
      } catch (error) {
        skippedSourceFiles.push(entry.sourceFile);
        await fetch("/progress", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            group: groupName,
            video: index + 1,
            total: entries.length,
            file: entry.sourceFile,
            skipped: true,
            reason: String(error?.message || error),
          }),
        });
        inferenceOffsetMs += 1000;
        continue;
      } finally {
        landmarker.close();
      }
      inferenceOffsetMs += extracted.durationMs + 1000;
      videos.push(extracted);
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
      schemaVersion: "skeleton-video-dataset-v1",
      datasetId: groupName,
      title: groupName,
      generatedAt: new Date().toISOString(),
      extraction: {
        engine: "mediapipe-holistic-landmarker",
        model: "holistic_landmarker.task",
        sampleFps: manifest.sampleFps,
        coordinateSystem: "normalized-image-v1",
        mirrored: false,
        poseLandmarkCount: 33,
        handLandmarkCount: 21,
      },
      sourceVideoCount: videos.length,
      skippedSourceFiles,
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
          videos.reduce((sum, video) => sum + video.handCoverage, 0) /
            videos.length,
        ),
      },
    };

    const saveResponse = await fetch("/save/" + groupName + ".json", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(dataset),
    });
    if (!saveResponse.ok) {
      throw new Error(await saveResponse.text());
    }
    summaries.push({
      name: groupName,
      videos: videos.length,
      frames: totalDetectedFrames,
      poseCoverage: dataset.summary.poseCoverage,
      handCoverage: dataset.summary.averageHandCoverage,
    });
  }

  status.textContent = "complete";
  await fetch("/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ groups: summaries }),
  });
} catch (error) {
  status.textContent = "failed";
  await fetch("/fail", {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: error instanceof Error ? error.stack || error.message : String(error),
  });
}

async function extractVideo(
  entry,
  landmarker,
  framesPerSecond,
  inferenceOffsetMs,
) {
  const video = await loadVideo(entry.videoUrl);
  const durationMs = Math.round(video.duration * 1000);
  const width = video.videoWidth;
  const height = video.videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context || width <= 0 || height <= 0) {
    throw new Error("Invalid video dimensions: " + entry.sourceFile);
  }
  const sampleIntervalMs = Math.max(80, Math.round(1000 / framesPerSecond));
  const sampledFrameCount = Math.ceil(durationMs / sampleIntervalMs);
  const frames = [];

  for (let videoMs = 0; videoMs < durationMs; videoMs += sampleIntervalMs) {
    await seekVideo(video, videoMs / 1000);
    context.drawImage(video, 0, 0, width, height);
    const detection = landmarker.detectForVideo(
      canvas,
      inferenceOffsetMs + videoMs,
    );
    const pose = detection.poseLandmarks[0];
    if (!pose || pose.length < 33) continue;
    frames.push({
      timestampMs: videoMs,
      pose: copyLandmarks(pose),
      leftHand: copyLandmarks(detection.leftHandLandmarks[0]),
      rightHand: copyLandmarks(detection.rightHandLandmarks[0]),
    });
  }

  video.removeAttribute("src");
  video.load();
  const handFrames = frames.filter(
    (frame) => frame.leftHand.length >= 21 || frame.rightHand.length >= 21,
  ).length;
  return {
    videoId: entry.sourceFile.replace(/\.[^.]+$/, "").toLowerCase(),
    sourceFile: entry.sourceFile,
    sequence: entry.sequence,
    durationMs,
    width,
    height,
    sampledFrameCount,
    detectedFrameCount: frames.length,
    poseCoverage: round(
      sampledFrameCount === 0 ? 0 : frames.length / sampledFrameCount,
    ),
    handCoverage: round(
      frames.length === 0 ? 0 : handFrames / frames.length,
    ),
    frames,
  };
}

function loadVideo(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => resolve(video);
    video.onerror = () => reject(new Error("Unable to read video: " + url));
    video.src = url;
    video.load();
  });
}

function seekVideo(video, seconds) {
  if (Math.abs(video.currentTime - seconds) < 0.005) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(
      () => reject(new Error("Video seek timed out.")),
      5000,
    );
    video.onseeked = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    video.currentTime = seconds;
  });
}
</script>
</html>`;

const timeout = setTimeout(() => {
  fatalError = "Processing timed out after 45 minutes.";
  finishRun();
}, 45 * 60 * 1000);

await completion;
clearTimeout(timeout);
await new Promise((resolveClose) => server.close(resolveClose));

if (fatalError) {
  console.error(`FAILED ${fatalError}`);
  process.exitCode = 1;
} else {
  console.log(`COMPLETE ${JSON.stringify(completedSummary)}`);
}
