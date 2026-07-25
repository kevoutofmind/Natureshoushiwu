import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const { Pool } = pg;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDirectory, "..");
const repositoryRoot = resolve(backendRoot, "..");

await loadEnvironmentFile(join(backendRoot, ".env"));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required. Copy bknd/.env.example to bknd/.env first.",
  );
}

const inputPaths = process.argv.slice(2);
const datasetFiles =
  inputPaths.length > 0
    ? await resolveInputFiles(inputPaths)
    : await discoverDatasets(join(repositoryRoot, "data", "dances"));

if (datasetFiles.length === 0) {
  throw new Error("No processed dataset.json files were found.");
}

const pool = new Pool({ connectionString });
try {
  await pool.query("BEGIN");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reference_datasets (
      dance_id VARCHAR(64) PRIMARY KEY,
      schema_version VARCHAR(64) NOT NULL,
      title VARCHAR(255) NOT NULL,
      source_video_count INTEGER NOT NULL CHECK (source_video_count > 0),
      motion_count INTEGER NOT NULL CHECK (motion_count > 0),
      generated_at TIMESTAMPTZ,
      dataset JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS reference_datasets_dataset_gin
      ON reference_datasets USING GIN (dataset);
  `);

  for (const datasetFile of datasetFiles) {
    const dataset = JSON.parse(await readFile(datasetFile, "utf8"));
    validateDataset(dataset, datasetFile);
    const motionCount = dataset.templatePacks.length;

    await pool.query(
      `
        INSERT INTO reference_datasets (
          dance_id,
          schema_version,
          title,
          source_video_count,
          motion_count,
          generated_at,
          dataset
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        ON CONFLICT (dance_id) DO UPDATE SET
          schema_version = EXCLUDED.schema_version,
          title = EXCLUDED.title,
          source_video_count = EXCLUDED.source_video_count,
          motion_count = EXCLUDED.motion_count,
          generated_at = EXCLUDED.generated_at,
          dataset = EXCLUDED.dataset,
          updated_at = NOW()
      `,
      [
        dataset.danceId,
        dataset.schemaVersion,
        dataset.title,
        dataset.sourceVideoCount,
        motionCount,
        dataset.generatedAt || null,
        JSON.stringify(dataset),
      ],
    );

    console.log(
      `Imported ${dataset.danceId}: ${motionCount} motions, ${dataset.sourceVideoCount} references.`,
    );
  }

  await pool.query("COMMIT");
  console.log(`Import complete: ${datasetFiles.length} dataset(s).`);
} catch (error) {
  await pool.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await pool.end();
}

async function loadEnvironmentFile(file) {
  let contents;
  try {
    contents = await readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed
      .slice(separator + 1)
      .trim()
      .replace(/^(['"])(.*)\1$/, "$2");
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

async function resolveInputFiles(paths) {
  const files = [];
  for (const path of paths) {
    const absolutePath = resolve(process.cwd(), path);
    const entry = await stat(absolutePath);
    if (entry.isDirectory()) {
      files.push(...(await discoverDatasets(absolutePath)));
    } else {
      files.push(absolutePath);
    }
  }
  return [...new Set(files)].sort();
}

async function discoverDatasets(dataRoot) {
  let danceEntries;
  try {
    danceEntries = await readdir(dataRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of danceEntries) {
    if (!entry.isDirectory()) continue;
    const datasetFile = join(dataRoot, entry.name, "processed", "dataset.json");
    try {
      if ((await stat(datasetFile)).isFile()) files.push(datasetFile);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return files.sort();
}

function validateDataset(dataset, source) {
  if (dataset?.schemaVersion !== "reference-dance-dataset-v1") {
    throw new Error(`${source}: invalid schemaVersion.`);
  }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(dataset.danceId ?? "")) {
    throw new Error(`${source}: invalid danceId.`);
  }
  if (!dataset.title?.trim()) {
    throw new Error(`${source}: title is required.`);
  }
  if (!Number.isInteger(dataset.sourceVideoCount) || dataset.sourceVideoCount < 1) {
    throw new Error(`${source}: sourceVideoCount must be a positive integer.`);
  }
  if (!Array.isArray(dataset.templatePacks) || dataset.templatePacks.length < 1) {
    throw new Error(`${source}: templatePacks must not be empty.`);
  }
  if (dataset.lesson?.danceId !== dataset.danceId) {
    throw new Error(`${source}: lesson.danceId must match danceId.`);
  }
}
