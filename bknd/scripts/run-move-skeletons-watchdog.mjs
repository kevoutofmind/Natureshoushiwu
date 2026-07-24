import { spawn } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const extractor = resolve(scriptDirectory, "extract-move-skeletons-unattended.mjs");
const projectRoot = resolve(scriptDirectory, "..", "..");
const dataRoot = resolve(projectRoot, "bknd", "data");
const videoRoot = resolve(process.argv[2] || "D:\\move");
const logFile = resolve(dataRoot, "extraction-unattended.log");
const pidFile = resolve(dataRoot, "extraction-watchdog.pid");
const maxRestarts = 8;
const inactivityLimitMs = 4 * 60 * 1000;
let activeChild = null;
let stopping = false;

if (!existsSync(extractor)) throw new Error(`Extractor not found: ${extractor}`);
writeFileSync(pidFile, String(process.pid), "utf8");
log(`WATCHDOG_START pid=${process.pid}`);
process.on("SIGINT", stopGracefully);
process.on("SIGTERM", stopGracefully);

let restartNumber = 0;
while (restartNumber <= maxRestarts) {
  const outcome = await runExtractor();
  if (outcome.completed) {
    log(`WATCHDOG_COMPLETE restarts=${restartNumber}`);
    process.exit(0);
  }
  restartNumber += 1;
  if (restartNumber > maxRestarts) {
    log(`WATCHDOG_GAVE_UP reason=${outcome.reason}`);
    process.exit(1);
  }
  log(`WATCHDOG_RESTART number=${restartNumber} reason=${outcome.reason}`);
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 5000));
}

function runExtractor() {
  return new Promise((resolveRun) => {
    let lastActivity = Date.now();
    let completed = false;
    let settled = false;
    const child = spawn(
      process.execPath,
      [extractor, videoRoot],
      {
        cwd: projectRoot,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    activeChild = child;
    log(`EXTRACTOR_START pid=${child.pid}`);
    const consume = (chunk) => {
      lastActivity = Date.now();
      const text = chunk.toString("utf8");
      if (text.includes("COMPLETE ")) completed = true;
      process.stdout.write(text);
      appendFileSync(logFile, text, "utf8");
    };
    child.stdout.on("data", consume);
    child.stderr.on("data", consume);
    const watchdog = setInterval(async () => {
      if (Date.now() - lastActivity <= inactivityLimitMs || settled) return;
      settled = true;
      clearInterval(watchdog);
      await terminateProcessTree(child);
      resolveRun({ completed: false, reason: "主提取脚本连续4分钟无日志" });
    }, 10000);
    child.once("exit", (code) => {
      activeChild = null;
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      resolveRun({
        completed: completed && code === 0,
        reason: `提取脚本退出 code=${code}`,
      });
    });
    child.once("error", (error) => {
      activeChild = null;
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      resolveRun({ completed: false, reason: error.message });
    });
  });
}

async function stopGracefully() {
  if (stopping) return;
  stopping = true;
  log("WATCHDOG_STOP requested-by-user");
  await terminateProcessTree(activeChild);
  process.exit(130);
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
      { windowsHide: true, stdio: "ignore" },
    );
    killer.once("exit", resolveTermination);
    killer.once("error", () => {
      child.kill();
      resolveTermination();
    });
    setTimeout(resolveTermination, 5000);
  });
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
  appendFileSync(
    logFile,
    `[${new Date().toISOString()}] ${message}\n`,
    "utf8",
  );
}
