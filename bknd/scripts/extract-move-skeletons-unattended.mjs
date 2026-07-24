import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, "..", "..");
const videoRoot = resolve(process.argv[2] || "D:\\move");
const outputRoot = resolve(projectRoot, "bknd", "data");
const transcodeRoot = resolve(outputRoot, ".transcoded-h264");
const ffmpegPath = resolve(projectRoot, "tools", "ffmpeg", "bin", "ffmpeg.exe");
const ffprobePath = resolve(projectRoot, "tools", "ffmpeg", "bin", "ffprobe.exe");
const sampleFps = 10;
const retryCount = 3;
const expectedGroups = ["cat", "cloud", "fade", "fight", "indo", "no"];
const explicitlySkipped = new Map([["cat (4).mp4", "用户指定跳过"]]);
const limitArgument = process.argv.find((value) => value.startsWith("--limit="));
const onlyArgument = process.argv.find((value) => value.startsWith("--only="));
const onlySourceFile = onlyArgument?.slice("--only=".length);
const forceProcessing = process.argv.includes("--force");
const taskLimit = limitArgument
  ? Math.max(1, Number(limitArgument.slice("--limit=".length)))
  : Number.POSITIVE_INFINITY;
const visionBundle = resolve(
  projectRoot,
  "ftnd",
  "vendor",
  "mediapipe",
  "vision_bundle.mjs",
);
const mediaPipeRoot = resolve(projectRoot, "ftnd", "public", "mediapipe");
const modelFile = resolve(mediaPipeRoot, "models", "holistic_landmarker.task");

validateEnvironment();
const chromePath = findBrowser();
const groups = collectGroups(videoRoot);
const videosByGroup = loadExistingOutputs();
const failureReasons = new Map(
  expectedGroups.map((groupName) => [groupName, new Map()]),
);
const allTasks = expectedGroups.flatMap((groupName) =>
  groups.get(groupName)
    .filter(
      (entry) =>
        (!videosByGroup.get(groupName).has(entry.sourceFile) || forceProcessing) &&
        (!onlySourceFile ||
          entry.sourceFile === onlySourceFile ||
          entry.diskFile === onlySourceFile),
    )
    .map((entry) => ({ ...entry, groupName })),
);
const tasks = allTasks.slice(0, taskLimit);
const jobs = new Map();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    console.log(`HTTP method=${request.method} path=${url.pathname}`);
    if (request.method === "GET" && url.pathname === "/") {
      send(response, 200, getWorkerPage(), "text/html; charset=utf-8");
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/job/")) {
      const jobId = basename(url.pathname).replace(/\.json$/i, "");
      const job = jobs.get(jobId);
      if (!job) return send(response, 404, "Unknown job.");
      send(response, 200, JSON.stringify({
        jobId,
        sampleFps,
        task: {
          groupName: job.task.groupName,
          sequence: job.task.sequence,
          sourceFile: job.task.sourceFile,
          videoUrl: `/job-video/${encodeURIComponent(jobId)}`,
        },
      }), "application/json; charset=utf-8");
      return;
    }
    if (request.method === "GET" && url.pathname === "/vision_bundle.mjs") {
      serveFile(request, response, visionBundle, "text/javascript; charset=utf-8");
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/mediapipe/")) {
      const relativePath = decodeURIComponent(url.pathname.slice("/mediapipe/".length));
      const filename = safeChild(mediaPipeRoot, relativePath);
      serveFile(request, response, filename, contentType(filename));
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/video/")) {
      const diskFile = decodeURIComponent(url.pathname.slice("/video/".length));
      serveFile(request, response, safeChild(videoRoot, diskFile), "video/mp4");
      return;
    }
    if (request.method === "GET" && url.pathname.startsWith("/job-video/")) {
      const jobId = basename(url.pathname);
      const job = jobs.get(jobId);
      if (!job?.task?.processingFile) return send(response, 404, "Unknown job video.");
      serveFile(request, response, job.task.processingFile, "video/mp4");
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/result/")) {
      const jobId = basename(url.pathname);
      const job = jobs.get(jobId);
      if (!job) return send(response, 404, "Unknown job.");
      const result = JSON.parse(await readBody(request, 128 * 1024 * 1024));
      job.resolve(result);
      send(response, 200, JSON.stringify({ ok: true }), "application/json");
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/heartbeat/")) {
      const jobId = basename(url.pathname);
      const job = jobs.get(jobId);
      if (!job) return send(response, 404, "Unknown job.");
      const heartbeat = JSON.parse(await readBody(request, 1024 * 1024));
      job.lastHeartbeat = Date.now();
      console.log(
        `HEARTBEAT file=${job.task.sourceFile} stage=${heartbeat.stage || "working"} progress=${heartbeat.progress ?? "-"}`,
      );
      send(response, 200, JSON.stringify({ ok: true }), "application/json");
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/fail/")) {
      const jobId = basename(url.pathname);
      const job = jobs.get(jobId);
      if (!job) return send(response, 404, "Unknown job.");
      const failureText =
        (await readBody(request, 1024 * 1024)).trim() ||
        "MediaPipe 页面报告了未知错误";
      job.reportedFailure = failureText;
      console.error(
        `PAGE_FAIL file=${job.task.sourceFile} reason=${failureText.replace(/\s+/g, " ").slice(0, 4000)}`,
      );
      send(response, 200, JSON.stringify({ ok: true }), "application/json");
      job.reject(new Error(failureText));
      return;
    }
    send(response, 404, "Not found.");
  } catch (error) {
    send(response, 500, error instanceof Error ? error.message : String(error));
  }
});

const port = await listen(server);
console.log(`START pending=${allTasks.length} selected=${tasks.length} sampleFps=${sampleFps}`);

let completedThisRun = 0;
for (let taskIndex = 0; taskIndex < tasks.length; taskIndex += 1) {
  const task = tasks[taskIndex];
  console.log(
    `VIDEO ${taskIndex + 1}/${tasks.length} group=${task.groupName} file=${task.sourceFile}`,
  );
  try {
    const preparedTask = await prepareTask(task);
    const video = await processWithRetries(preparedTask, port);
    videosByGroup.get(task.groupName).set(task.sourceFile, video);
    failureReasons.get(task.groupName).delete(task.sourceFile);
    completedThisRun += 1;
    writeGroup(task.groupName);
    console.log(
      `SAVED group=${task.groupName} file=${task.sourceFile} frames=${video.detectedFrameCount} pose=${video.poseCoverage} hand=${video.handCoverage}`,
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    failureReasons.get(task.groupName).set(task.sourceFile, reason);
    writeGroup(task.groupName);
    console.error(`GAVE_UP group=${task.groupName} file=${task.sourceFile} reason=${reason}`);
  }
}

for (const groupName of expectedGroups) writeGroup(groupName);
server.close();
const remaining = allTasks.length - completedThisRun;
console.log(`COMPLETE processed=${completedThisRun} remaining=${Math.max(0, remaining)}`);

async function prepareTask(task) {
  const sourceFile = resolve(videoRoot, task.diskFile);
  const sourceProbe = await probeVideo(sourceFile);
  const codec = sourceProbe.streams?.[0]?.codec_name;
  const codecTag = sourceProbe.streams?.[0]?.codec_tag_string;
  if (codec === "h264" || codecTag === "avc1") {
    console.log(`SOURCE_READY file=${task.sourceFile} codec=h264`);
    return { ...task, processingFile: sourceFile, processingCodec: "h264" };
  }
  if (codec !== "hevc" && codecTag !== "hvc1" && codecTag !== "hev1") {
    throw new Error(
      `不支持的视频编码：${task.sourceFile} codec=${codec || codecTag || "unknown"}`,
    );
  }

  mkdirSync(transcodeRoot, { recursive: true });
  const cachedFile = resolve(transcodeRoot, task.diskFile);
  if (
    existsSync(cachedFile) &&
    statSync(cachedFile).mtimeMs >= statSync(sourceFile).mtimeMs
  ) {
    try {
      const cachedProbe = await probeVideo(cachedFile);
      if (cachedProbe.streams?.[0]?.codec_name === "h264") {
        console.log(`TRANSCODE_CACHE_HIT file=${task.sourceFile}`);
        return { ...task, processingFile: cachedFile, processingCodec: "h264-cache" };
      }
    } catch {
      // Invalid cache files are replaced below.
    }
  }

  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      console.log(`TRANSCODE_START file=${task.sourceFile} attempt=${attempt}/2`);
      await transcodeToH264(sourceFile, cachedFile, task.sourceFile, sourceProbe);
      const outputProbe = await probeVideo(cachedFile);
      if (
        outputProbe.streams?.[0]?.codec_name !== "h264" ||
        !Number.isFinite(Number(outputProbe.format?.duration)) ||
        Number(outputProbe.format.duration) <= 0
      ) {
        throw new Error("转码文件验证失败");
      }
      console.log(`TRANSCODE_DONE file=${task.sourceFile}`);
      return { ...task, processingFile: cachedFile, processingCodec: "h264-cache" };
    } catch (error) {
      lastError = error;
      console.error(
        `TRANSCODE_RETRY file=${task.sourceFile} attempt=${attempt} reason=${error instanceof Error ? error.message : String(error)}`,
      );
      if (attempt < 2) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 2000));
      }
    }
  }
  throw lastError;
}

async function probeVideo(filename) {
  const result = await runCapturedProcess(
    ffprobePath,
    [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,codec_tag_string,pix_fmt,width,height",
      "-show_entries", "format=duration",
      "-of", "json",
      filename,
    ],
    45 * 1000,
  );
  return JSON.parse(result.stdout);
}

async function transcodeToH264(sourceFile, targetFile, sourceName, sourceProbe) {
  const temporaryFile = `${targetFile}.part.mp4`;
  rmSync(temporaryFile, { force: true });
  const durationSeconds = Number(sourceProbe.format?.duration) || 0;
  let child;
  let inactivityTimer;
  let totalTimer;
  let lastActivity = Date.now();
  let stdoutBuffer = "";
  let stderrText = "";
  let lastReportedProgress = -5;
  try {
    await new Promise((resolveTranscode, rejectTranscode) => {
      child = spawn(
        ffmpegPath,
        [
          "-y",
          "-hide_banner",
          "-loglevel", "error",
          "-i", sourceFile,
          "-map", "0:v:0",
          "-an",
          "-c:v", "libx264",
          "-preset", "veryfast",
          "-crf", "20",
          "-pix_fmt", "yuv420p",
          "-movflags", "+faststart",
          "-progress", "pipe:1",
          "-nostats",
          temporaryFile,
        ],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      child.stdout.on("data", (chunk) => {
        lastActivity = Date.now();
        stdoutBuffer += chunk.toString("utf8");
        const lines = stdoutBuffer.split(/\r?\n/);
        stdoutBuffer = lines.pop() || "";
        for (const line of lines) {
          const match = /^out_time_us=(\d+)$/.exec(line);
          if (!match || !durationSeconds) continue;
          const progress = Math.min(
            99,
            Math.max(0, Math.round(Number(match[1]) / (durationSeconds * 1_000_000) * 100)),
          );
          if (progress >= lastReportedProgress + 5) {
            lastReportedProgress = progress;
            console.log(`TRANSCODE file=${sourceName} progress=${progress}`);
          }
        }
      });
      child.stderr.on("data", (chunk) => {
        lastActivity = Date.now();
        stderrText = `${stderrText}${chunk.toString("utf8")}`.slice(-16000);
      });
      inactivityTimer = setInterval(async () => {
        if (Date.now() - lastActivity <= 120 * 1000) return;
        await terminateProcessTree(child);
        rejectTranscode(new Error("FFmpeg 连续120秒无进度，已终止"));
      }, 5000);
      totalTimer = setTimeout(async () => {
        await terminateProcessTree(child);
        rejectTranscode(new Error("单个视频转码超过20分钟，已终止"));
      }, 20 * 60 * 1000);
      child.once("error", rejectTranscode);
      child.once("exit", (code) => {
        if (code === 0) resolveTranscode();
        else rejectTranscode(new Error(`FFmpeg 退出 code=${code}: ${stderrText.trim()}`));
      });
    });
    rmSync(targetFile, { force: true });
    renameSync(temporaryFile, targetFile);
  } catch (error) {
    rmSync(temporaryFile, { force: true });
    throw error;
  } finally {
    clearInterval(inactivityTimer);
    clearTimeout(totalTimer);
  }
}

function runCapturedProcess(command, args, timeoutMs) {
  return new Promise((resolveProcess, rejectProcess) => {
    const child = spawn(command, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(async () => {
      await terminateProcessTree(child);
      rejectProcess(new Error(`${basename(command)} 运行超时`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-16000);
    });
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectProcess(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolveProcess({ stdout, stderr });
      else rejectProcess(new Error(`${basename(command)} 退出 code=${code}: ${stderr.trim()}`));
    });
  });
}

async function processWithRetries(task, serverPort) {
  let lastError;
  for (let attempt = 1; attempt <= retryCount; attempt += 1) {
    try {
      console.log(`ATTEMPT ${attempt}/${retryCount} file=${task.sourceFile}`);
      return await processOneVideo(task, serverPort);
    } catch (error) {
      lastError = error;
      console.error(
        `RETRY file=${task.sourceFile} attempt=${attempt} reason=${error instanceof Error ? error.message : String(error)}`,
      );
      if (attempt < retryCount) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, attempt * 1500));
      }
    }
  }
  throw lastError;
}

async function processOneVideo(task, serverPort) {
  const jobId = randomUUID();
  const profile = await mkdtemp(join(tmpdir(), "mediapipe-batch-"));
  let browserProcess;
  let debugPort;
  let timeout;
  let inactivityWatchdog;
  try {
    const resultPromise = new Promise((resolveJob, rejectJob) => {
      timeout = setTimeout(
        () => rejectJob(new Error("单个视频总处理时间超过8分钟")),
        8 * 60 * 1000,
      );
      jobs.set(jobId, {
        task,
        lastHeartbeat: Date.now(),
        reportedFailure: null,
        resolve: (value) => {
          clearTimeout(timeout);
          resolveJob(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          rejectJob(error);
        },
      });
      inactivityWatchdog = setInterval(() => {
        const job = jobs.get(jobId);
        if (job && Date.now() - job.lastHeartbeat > 90 * 1000) {
          job.reject(new Error("连续90秒没有处理进度，已判定为卡死"));
        }
      }, 5000);
    });
    debugPort = await reserveTcpPort();
    browserProcess = spawn(
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
        "--autoplay-policy=no-user-gesture-required",
        `--remote-debugging-port=${debugPort}`,
        `--user-data-dir=${profile}`,
        `http://127.0.0.1:${serverPort}/?job=${encodeURIComponent(jobId)}`,
      ],
      { stdio: ["ignore", "ignore", "pipe"], windowsHide: true },
    );
    browserProcess.stderr.on("data", (chunk) => {
      const line = chunk.toString("utf8").trim();
      if (line) console.error(`BROWSER ${line.slice(0, 1000)}`);
    });
    browserProcess.once("exit", (code) => {
      // On Windows, msedge.exe may hand the page to a child process and let the
      // launcher exit with code 0. The page heartbeat/timeout is authoritative.
      console.log(`BROWSER_LAUNCHER_EXIT file=${task.sourceFile} code=${code}`);
    });
    const result = await resultPromise;
    validateVideoResult(task, result);
    return result;
  } finally {
    clearTimeout(timeout);
    clearInterval(inactivityWatchdog);
    jobs.delete(jobId);
    await closeBrowserViaDevTools(debugPort);
    await terminateProcessTree(browserProcess);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 700));
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
}

async function reserveTcpPort() {
  const portServer = createServer();
  await new Promise((resolveListen, rejectListen) => {
    portServer.once("error", rejectListen);
    portServer.listen(0, "127.0.0.1", resolveListen);
  });
  const address = portServer.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolveClose) => portServer.close(resolveClose));
  if (!port) throw new Error("无法分配浏览器调试端口");
  return port;
}

async function closeBrowserViaDevTools(debugPort) {
  if (!debugPort) return;
  let webSocketUrl;
  for (let attempt = 0; attempt < 10 && !webSocketUrl; attempt += 1) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${debugPort}/json/version`,
        { signal: AbortSignal.timeout(700) },
      );
      if (response.ok) {
        const version = await response.json();
        webSocketUrl = version.webSocketDebuggerUrl;
      }
    } catch {
      // The actual browser may still be starting after its launcher exits.
    }
    if (!webSocketUrl) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
    }
  }
  if (!webSocketUrl) return;
  await new Promise((resolveClose) => {
    const socket = new WebSocket(webSocketUrl);
    const finish = () => {
      clearTimeout(closeTimer);
      resolveClose();
    };
    const closeTimer = setTimeout(finish, 3000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method: "Browser.close" }));
    });
    socket.addEventListener("message", finish, { once: true });
    socket.addEventListener("close", finish, { once: true });
    socket.addEventListener("error", finish, { once: true });
  });
}

function terminateProcessTree(child) {
  if (!child?.pid) return Promise.resolve();
  if (process.platform !== "win32") {
    child.kill("SIGKILL");
    return Promise.resolve();
  }
  return new Promise((resolveTermination) => {
    const killer = spawn(
      "taskkill",
      ["/PID", String(child.pid), "/T", "/F"],
      { stdio: "ignore", windowsHide: true },
    );
    killer.once("exit", resolveTermination);
    killer.once("error", () => {
      child.kill();
      resolveTermination();
    });
    setTimeout(resolveTermination, 5000);
  });
}

function writeGroup(groupName) {
  const videos = [...videosByGroup.get(groupName).values()]
    .sort((left, right) => left.sequence - right.sequence);
  const sourceEntries = groups.get(groupName);
  const pendingSourceFiles = sourceEntries
    .map((entry) => entry.sourceFile)
    .filter(
      (sourceFile) =>
        !videosByGroup.get(groupName).has(sourceFile) &&
        !failureReasons.get(groupName).has(sourceFile),
    );
  const skippedSourceFiles = [
    ...[...explicitlySkipped.keys()].filter((name) =>
      name.toLowerCase().startsWith(`${groupName} (`) &&
      !videosByGroup.get(groupName).has(name),
    ),
    ...failureReasons.get(groupName).keys(),
  ];
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
      sampleFps,
      coordinateSystem: "normalized-image-v1",
      mirrored: false,
      poseLandmarkCount: 33,
      handLandmarkCount: 21,
    },
    processing: {
      status: pendingSourceFiles.length
        ? "in-progress"
        : failureReasons.get(groupName).size
          ? "completed-with-errors"
          : "complete",
      expectedSourceVideoCount: 10,
      successfulSourceVideoCount: videos.length,
      pendingSourceFiles,
      failureReasons: Object.fromEntries(failureReasons.get(groupName)),
    },
    sourceVideoCount: videos.length,
    skippedSourceFiles,
    videos,
    summary: {
      totalSampledFrames,
      totalDetectedFrames,
      poseCoverage: round(
        totalSampledFrames ? totalDetectedFrames / totalSampledFrames : 0,
      ),
      averageHandCoverage: round(
        videos.length
          ? videos.reduce((sum, video) => sum + video.handCoverage, 0) / videos.length
          : 0,
      ),
    },
  };
  atomicWriteJson(resolve(outputRoot, `${groupName}.json`), dataset);
}

function atomicWriteJson(filename, value) {
  const temporary = `${filename}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, "utf8");
  try {
    renameSync(temporary, filename);
  } catch {
    copyFileSync(temporary, filename);
    rmSync(temporary, { force: true });
  }
}

function loadExistingOutputs() {
  const result = new Map(expectedGroups.map((groupName) => [groupName, new Map()]));
  for (const groupName of expectedGroups) {
    const filename = resolve(outputRoot, `${groupName}.json`);
    if (!existsSync(filename)) continue;
    try {
      const dataset = JSON.parse(readFileSync(filename, "utf8"));
      for (const video of dataset.videos || []) {
        if (
          typeof video.sourceFile === "string" &&
          Array.isArray(video.frames) &&
          video.frames.length > 0 &&
          video.frames.every((frame) => frame.pose?.length === 33)
        ) {
          result.get(groupName).set(video.sourceFile, video);
        }
      }
    } catch (error) {
      console.error(`IGNORED invalid existing output ${groupName}.json: ${error.message}`);
    }
  }
  return result;
}

function collectGroups(root) {
  const result = new Map(expectedGroups.map((name) => [name, []]));
  const files = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".mp4")
    .map((entry) => entry.name)
    .filter(
      (filename) =>
        !explicitlySkipped.has(filename) ||
        filename === onlySourceFile,
    )
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
    if (!result.has(groupName)) throw new Error(`Unexpected group: ${groupName}`);
    result.get(groupName).push({ diskFile, sourceFile, sequence });
  }
  for (const entries of result.values()) {
    entries.sort((left, right) => left.sequence - right.sequence);
  }
  const count = [...result.values()].reduce((sum, entries) => sum + entries.length, 0);
  const expectedCount =
    onlySourceFile && explicitlySkipped.has(onlySourceFile) ? 60 : 59;
  if (count !== expectedCount) {
    throw new Error(`Expected ${expectedCount} videos after skip, found ${count}`);
  }
  return result;
}

function validateVideoResult(task, video) {
  if (
    video?.sourceFile !== task.sourceFile ||
    video?.sequence !== task.sequence ||
    !Number.isFinite(video?.durationMs) ||
    video.durationMs <= 0 ||
    !Array.isArray(video?.frames) ||
    video.frames.length === 0 ||
    video.frames.some((frame) => frame.pose?.length !== 33)
  ) {
    throw new Error(`无效骨架结果：${task.sourceFile}`);
  }
}

function validateEnvironment() {
  if (!existsSync(videoRoot)) throw new Error(`Missing video directory: ${videoRoot}`);
  mkdirSync(outputRoot, { recursive: true });
  mkdirSync(transcodeRoot, { recursive: true });
  const required = [
    ffmpegPath,
    ffprobePath,
    visionBundle,
    modelFile,
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
}

function findBrowser() {
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ];
  const match = candidates.find(existsSync);
  if (!match) throw new Error("Edge or Chrome was not found.");
  return match;
}

function safeChild(root, relativePath) {
  const filename = resolve(root, relativePath);
  const normalizedRoot = `${resolve(root)}\\`;
  if (!filename.toLowerCase().startsWith(normalizedRoot.toLowerCase())) {
    throw new Error("Invalid local path.");
  }
  return filename;
}

function serveFile(request, response, filename, type) {
  const stats = statSync(filename);
  const range = request.headers.range;
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Content-Type", type);
  response.setHeader("Cache-Control", "no-store");
  if (!range) {
    response.writeHead(200, { "Content-Length": stats.size });
    createReadStream(filename).pipe(response);
    return;
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match) {
    response.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
    response.end();
    return;
  }
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Math.min(Number(match[2]), stats.size - 1) : stats.size - 1;
  if (start > end || start >= stats.size) {
    response.writeHead(416, { "Content-Range": `bytes */${stats.size}` });
    response.end();
    return;
  }
  response.writeHead(206, {
    "Content-Range": `bytes ${start}-${end}/${stats.size}`,
    "Content-Length": end - start + 1,
  });
  createReadStream(filename, { start, end }).pipe(response);
}

function contentType(filename) {
  const extension = extname(filename).toLowerCase();
  if (extension === ".js" || extension === ".mjs") return "text/javascript";
  if (extension === ".wasm") return "application/wasm";
  return "application/octet-stream";
}

function send(response, statusCode, body, type = "text/plain; charset=utf-8") {
  response.writeHead(statusCode, {
    "Content-Type": type,
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readBody(request, maxBytes) {
  return new Promise((resolveBody, rejectBody) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        rejectBody(new Error("Request body too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", rejectBody);
  });
}

function listen(httpServer) {
  return new Promise((resolvePort, rejectPort) => {
    httpServer.once("error", rejectPort);
    httpServer.listen(0, "127.0.0.1", () => {
      const address = httpServer.address();
      if (!address || typeof address === "string") {
        rejectPort(new Error("Unable to allocate local port."));
        return;
      }
      resolvePort(address.port);
    });
  });
}

function round(value) {
  return Number(value.toFixed(6));
}

function getWorkerPage() {
  return String.raw`<!doctype html>
<html><meta charset="utf-8"><title>MediaPipe Worker</title>
<pre id="status">starting</pre>
<script>
(() => {
  const id = new URL(location.href).searchParams.get("job");
  const post = (path, body, type) =>
    fetch(path + encodeURIComponent(id), {
      method: "POST",
      headers: { "content-type": type },
      body,
    }).catch(() => {});
  post(
    "/heartbeat/",
    JSON.stringify({ stage: "html-loaded", progress: 0 }),
    "application/json",
  );
  addEventListener("error", (event) => {
    post(
      "/fail/",
      "Worker page error: " + (event.message || "unknown"),
      "text/plain; charset=utf-8",
    );
  });
  addEventListener("unhandledrejection", (event) => {
    post(
      "/fail/",
      "Worker rejection: " + String(event.reason?.stack || event.reason),
      "text/plain; charset=utf-8",
    );
  });
})();
</script>
<script type="module">
const status = document.querySelector("#status");
const jobId = new URL(location.href).searchParams.get("job");
const heartbeat = (stage, progress) =>
  fetch("/heartbeat/" + encodeURIComponent(jobId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stage, progress }),
  }).catch(() => {});
const round = (value) => Number(value.toFixed(6));
const copyLandmarks = (landmarks) =>
  (landmarks || []).map(({ x, y, z, visibility, presence }) => ({
    x: round(x), y: round(y), z: round(z),
    ...(typeof visibility === "number" ? { visibility: round(visibility) } : {}),
    ...(typeof presence === "number" ? { presence: round(presence) } : {}),
  }));
let landmarker;
let video;
try {
  await heartbeat("page-start", 0);
  const { FilesetResolver, HolisticLandmarker } = await import("/vision_bundle.mjs");
  await heartbeat("module-loaded", 0);
  const job = await fetch("/job/" + encodeURIComponent(jobId) + ".json").then((r) => r.json());
  status.textContent = "loading " + job.task.sourceFile;
  await heartbeat("model-loading", 0);
  const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
  landmarker = await HolisticLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: "/mediapipe/models/holistic_landmarker.task",
      delegate: "CPU",
    },
    runningMode: "VIDEO",
    minPoseDetectionConfidence: 0.45,
    minPosePresenceConfidence: 0.45,
    minHandLandmarksConfidence: 0.4,
  });
  await heartbeat("video-loading", 0);
  video = await loadVideo(job.task.videoUrl);
  await heartbeat("extracting", 0);
  const result = await extractVideo(job.task, video, landmarker, job.sampleFps);
  status.textContent = "uploading";
  await heartbeat("saving", 100);
  const response = await fetch("/result/" + encodeURIComponent(jobId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(result),
  });
  if (!response.ok) throw new Error(await response.text());
  status.textContent = "complete";
} catch (error) {
  status.textContent = "failed";
  await fetch("/fail/" + encodeURIComponent(jobId), {
    method: "POST",
    headers: { "content-type": "text/plain; charset=utf-8" },
    body: error instanceof Error ? error.stack || error.message : String(error),
  }).catch(() => {});
} finally {
  landmarker?.close();
  if (video) {
    video.pause();
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}

async function loadVideo(url) {
  const element = document.createElement("video");
  element.preload = "auto";
  element.muted = true;
  element.playsInline = true;
  element.style.cssText = "position:fixed;width:2px;height:2px;opacity:.01";
  document.body.append(element);
  await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(
      () => rejectReady(new Error("视频加载超时")),
      30000,
    );
    const check = () => {
      if (
        element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA &&
        element.videoWidth > 0 &&
        element.videoHeight > 0 &&
        Number.isFinite(element.duration) &&
        element.duration > 0
      ) {
        clearTimeout(timeout);
        resolveReady();
      }
    };
    element.addEventListener("loadeddata", check);
    element.addEventListener("canplay", check);
    element.addEventListener("resize", check);
    element.addEventListener("error", () => {
      clearTimeout(timeout);
      rejectReady(new Error("浏览器无法解码视频"));
    });
    element.src = url;
    element.load();
    const poll = setInterval(() => {
      check();
      if (element.videoWidth > 0) clearInterval(poll);
    }, 100);
    setTimeout(() => clearInterval(poll), 31000);
  });
  return element;
}

async function extractVideo(task, element, detector, framesPerSecond) {
  const durationMs = Math.round(element.duration * 1000);
  const width = element.videoWidth;
  const height = element.videoHeight;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("无法创建视频画布");
  const intervalMs = Math.max(50, Math.round(1000 / framesPerSecond));
  const sampledFrameCount = Math.ceil(durationMs / intervalMs);
  const frames = [];
  for (let timestampMs = 0; timestampMs < durationMs; timestampMs += intervalMs) {
    status.textContent = task.sourceFile + " " + Math.round(timestampMs / durationMs * 100) + "%";
    if (Math.round(timestampMs / intervalMs) % 10 === 0) {
      await heartbeat("extracting", Math.round(timestampMs / durationMs * 100));
    }
    await seekVideo(element, timestampMs / 1000);
    context.drawImage(element, 0, 0, width, height);
    const detection = detector.detectForVideo(canvas, timestampMs);
    const pose = detection.poseLandmarks[0];
    if (!pose || pose.length !== 33) continue;
    frames.push({
      timestampMs,
      pose: copyLandmarks(pose),
      leftHand: copyLandmarks(detection.leftHandLandmarks[0]),
      rightHand: copyLandmarks(detection.rightHandLandmarks[0]),
    });
  }
  const handFrames = frames.filter(
    (frame) => frame.leftHand.length === 21 || frame.rightHand.length === 21,
  ).length;
  return {
    videoId: task.sourceFile.replace(/\.[^.]+$/, "").toLowerCase(),
    sourceFile: task.sourceFile,
    sequence: task.sequence,
    durationMs,
    width,
    height,
    sampledFrameCount,
    detectedFrameCount: frames.length,
    poseCoverage: round(sampledFrameCount ? frames.length / sampledFrameCount : 0),
    handCoverage: round(frames.length ? handFrames / frames.length : 0),
    frames,
  };
}

function seekVideo(element, seconds) {
  if (Math.abs(element.currentTime - seconds) < 0.005 && element.readyState >= 2) {
    return Promise.resolve();
  }
  return new Promise((resolveSeek, rejectSeek) => {
    const timeout = setTimeout(() => rejectSeek(new Error("视频跳帧超时")), 10000);
    element.addEventListener("seeked", () => {
      clearTimeout(timeout);
      resolveSeek();
    }, { once: true });
    element.currentTime = Math.min(seconds, Math.max(0, element.duration - 0.001));
  });
}
</script></html>`;
}
