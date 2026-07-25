import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const backendRoot = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(backendRoot, '..');

await loadEnvironmentFile(join(backendRoot, '.env'));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is required. Copy bknd/.env.example to bknd/.env first.');
}

const catalogPath = join(repositoryRoot, 'data', 'dances', 'catalog.json');
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
if (!Array.isArray(catalog.categories) || catalog.categories.length === 0) {
  throw new Error('data/dances/catalog.json must contain at least one category.');
}

const pool = new Pool({ connectionString });
try {
  await pool.query('BEGIN');
  for (const category of catalog.categories) {
    await pool.query(
      `INSERT INTO dance_categories (
        dance_id, title, source_file_name, reference_video_url,
        reference_skeleton_path, duration_seconds, sort_order,
        variant_capacity, analysis_status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (dance_id) DO UPDATE SET
        title = EXCLUDED.title,
        source_file_name = EXCLUDED.source_file_name,
        reference_video_url = EXCLUDED.reference_video_url,
        reference_skeleton_path = EXCLUDED.reference_skeleton_path,
        duration_seconds = EXCLUDED.duration_seconds,
        sort_order = EXCLUDED.sort_order,
        variant_capacity = EXCLUDED.variant_capacity,
        analysis_status = EXCLUDED.analysis_status,
        updated_at = NOW()`,
      [
        category.danceId,
        category.title,
        category.sourceFileName,
        category.referenceVideoUrl,
        category.referenceSkeletonPath,
        category.durationSeconds,
        category.sortOrder,
        category.variantCapacity,
        category.analysisStatus,
      ],
    );
  }
  await pool.query('COMMIT');
  console.log(`Imported ${catalog.categories.length} dance categories.`);
} catch (error) {
  await pool.query('ROLLBACK');
  throw error;
} finally {
  await pool.end();
}

async function loadEnvironmentFile(filename) {
  try {
    const content = await readFile(filename, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
