import 'reflect-metadata';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ReferenceDanceDataset } from '../src/vlm-core/contracts/reference-dataset.types';
import type {
  MotionReferenceTemplate,
  MotionTemplatePack,
  RequiredSkeletonPart,
  RealtimeJudgeResult,
} from '../src/vlm-core/contracts/realtime-judge.types';
import { SkeletonTemplateMatcherEngine } from '../src/vlm-core/rules/skeleton-template-matcher.engine';

interface CliOptions {
  apply: boolean;
  allowUnreliable: boolean;
  dataRoot: string;
  reportFile: string;
  targetFalseAcceptRate: number;
  targetRecall: number;
}

interface CandidateResult {
  requiredParts: RequiredSkeletonPart[];
  positiveCases: number;
  negativeCases: number;
  visiblePositiveCases: number;
  visibleNegativeCases: number;
  threshold: number;
  recall: number;
  falseAcceptRate: number;
  precision: number;
  meanPositiveScore: number;
  minimumPositiveScore: number;
  maximumNegativeScore: number;
  reliable: boolean;
}

interface PackCalibration {
  danceId: string;
  motionId: string;
  selected: CandidateResult;
  candidates: CandidateResult[];
}

const options = parseOptions(process.argv.slice(2));
const matcher = new SkeletonTemplateMatcherEngine();
void main();

async function main(): Promise<void> {
  const datasets = await loadGeneratedDatasets(options.dataRoot);
  if (datasets.length < 2) {
    throw new Error(
      `At least two generated datasets are required for cross-action calibration below ${options.dataRoot}.`,
    );
  }

  const packs = datasets.flatMap((dataset) => dataset.templatePacks);
  const calibrations = packs.map((pack) => calibratePack(pack, packs, options));
  const unreliable = calibrations.filter(
    (calibration) => !calibration.selected.reliable,
  );
  const report = {
    schemaVersion: 'reference-dataset-calibration-report-v1',
    generatedAt: new Date().toISOString(),
    dataRoot: options.dataRoot,
    datasetCount: datasets.length,
    motionCount: packs.length,
    targetRecall: options.targetRecall,
    targetFalseAcceptRate: options.targetFalseAcceptRate,
    reliable: unreliable.length === 0,
    calibrations,
  };

  await writeJsonAtomic(options.reportFile, report, true);
  printReport(calibrations);
  console.log(`\nCalibration report: ${options.reportFile}`);

  if (options.apply) {
    if (unreliable.length > 0 && !options.allowUnreliable) {
      throw new Error(
        `${unreliable.length} motion(s) did not meet calibration safety targets. No thresholds were changed. Use the report to improve/correct templates; --allow-unreliable is intentionally required to override this guard.`,
      );
    }
    await applyCalibrations(datasets, calibrations, options);
    console.log(`Applied calibration to ${datasets.length} dataset(s).`);
  }

  if (unreliable.length > 0) process.exitCode = 2;
}

function calibratePack(
  pack: MotionTemplatePack,
  allPacks: MotionTemplatePack[],
  settings: CliOptions,
): PackCalibration {
  const candidates: RequiredSkeletonPart[][] = [
    ['pose'],
    ['pose', 'left_hand'],
    ['pose', 'right_hand'],
    ['pose', 'left_hand', 'right_hand'],
  ];
  const results = candidates.map((requiredParts) =>
    evaluateCandidate(pack, allPacks, requiredParts, settings),
  );
  results.sort(compareCandidates);
  return {
    danceId: pack.danceId,
    motionId: pack.motionId,
    selected: results[0],
    candidates: results,
  };
}

function evaluateCandidate(
  pack: MotionTemplatePack,
  allPacks: MotionTemplatePack[],
  requiredParts: RequiredSkeletonPart[],
  settings: CliOptions,
): CandidateResult {
  const positiveOutcomes = pack.templates.map((heldOut) =>
    evaluate(
      {
        ...pack,
        requiredParts,
        templates: pack.templates.filter(
          (template) => template.templateId !== heldOut.templateId,
        ),
      },
      heldOut,
    ),
  );
  const negativeOutcomes = allPacks
    .filter((other) => other.motionId !== pack.motionId)
    .flatMap((other) =>
      other.templates.map((template) =>
        evaluate({ ...pack, requiredParts }, template),
      ),
    );
  const positiveScores = scores(positiveOutcomes);
  const negativeScores = scores(negativeOutcomes);
  const thresholds = Array.from({ length: 96 }, (_, index) =>
    Number((index / 100).toFixed(2)),
  );
  const choices = thresholds.map((threshold) => {
    const truePositives = positiveScores.filter(
      (score) => score >= threshold,
    ).length;
    const falsePositives = negativeScores.filter(
      (score) => score >= threshold,
    ).length;
    const recall =
      positiveScores.length === 0 ? 0 : truePositives / positiveScores.length;
    const falseAcceptRate =
      negativeScores.length === 0 ? 0 : falsePositives / negativeScores.length;
    const precision =
      truePositives + falsePositives === 0
        ? 0
        : truePositives / (truePositives + falsePositives);
    return { threshold, recall, falseAcceptRate, precision };
  });
  const safeChoices = choices.filter(
    (choice) =>
      choice.recall >= settings.targetRecall &&
      choice.falseAcceptRate <= settings.targetFalseAcceptRate,
  );
  const selected =
    safeChoices.sort(
      (left, right) =>
        right.recall - left.recall ||
        left.falseAcceptRate - right.falseAcceptRate ||
        right.threshold - left.threshold,
    )[0] ??
    choices.sort(
      (left, right) =>
        right.recall -
          right.falseAcceptRate * 3 -
          (left.recall - left.falseAcceptRate * 3) ||
        right.precision - left.precision ||
        right.threshold - left.threshold,
    )[0];
  return {
    requiredParts,
    positiveCases: positiveScores.length,
    negativeCases: negativeScores.length,
    visiblePositiveCases: positiveOutcomes.filter(
      (outcome) => outcome.decision !== 'NOT_VISIBLE',
    ).length,
    visibleNegativeCases: negativeOutcomes.filter(
      (outcome) => outcome.decision !== 'NOT_VISIBLE',
    ).length,
    threshold: selected.threshold,
    recall: selected.recall,
    falseAcceptRate: selected.falseAcceptRate,
    precision: selected.precision,
    meanPositiveScore: average(positiveScores),
    minimumPositiveScore:
      positiveScores.length === 0 ? 0 : Math.min(...positiveScores),
    maximumNegativeScore:
      negativeScores.length === 0 ? 0 : Math.max(...negativeScores),
    reliable:
      selected.recall >= settings.targetRecall &&
      selected.falseAcceptRate <= settings.targetFalseAcceptRate,
  };
}

function evaluate(
  pack: MotionTemplatePack,
  observation: MotionReferenceTemplate,
): RealtimeJudgeResult {
  return matcher.evaluate(
    {
      ...pack,
      evaluationPolicy: {
        acceptThreshold: 0,
        acceptWithHintThreshold: 0,
        minimumCompletionProgress: 0,
        minimumObservationMs: 100,
      },
    },
    {
      schemaVersion: 'realtime-judge-v1',
      sessionId: 'reference-calibration',
      sampleId: observation.templateId,
      danceId: pack.danceId,
      motionId: pack.motionId,
      observation: {
        mirrored: observation.mirrored,
        progress: 1,
        frames: observation.frames,
      },
    },
  );
}

function scores(outcomes: RealtimeJudgeResult[]): number[] {
  return outcomes.map((outcome) =>
    outcome.decision === 'NOT_VISIBLE' ? 0 : outcome.scores.overall,
  );
}

function compareCandidates(left: CandidateResult, right: CandidateResult) {
  return (
    Number(right.reliable) - Number(left.reliable) ||
    right.recall - left.recall ||
    left.falseAcceptRate - right.falseAcceptRate ||
    right.precision - left.precision ||
    right.requiredParts.length - left.requiredParts.length
  );
}

async function applyCalibrations(
  sourceDatasets: ReferenceDanceDataset[],
  sourceCalibrations: PackCalibration[],
  settings: CliOptions,
) {
  const byMotion = new Map(
    sourceCalibrations.map((calibration) => [
      `${calibration.danceId}:${calibration.motionId}`,
      calibration,
    ]),
  );
  for (const dataset of sourceDatasets) {
    for (const pack of dataset.templatePacks) {
      const calibration = byMotion.get(`${pack.danceId}:${pack.motionId}`);
      if (!calibration) continue;
      const hintThreshold = Math.max(0.05, calibration.selected.threshold);
      const acceptThreshold = Math.min(
        0.95,
        Math.max(hintThreshold + 0.12, hintThreshold),
      );
      pack.requiredParts = calibration.selected.requiredParts;
      pack.evaluationPolicy = {
        ...pack.evaluationPolicy,
        acceptThreshold: round(acceptThreshold, 2),
        acceptWithHintThreshold: round(hintThreshold, 2),
      };
      const metadata = dataset as ReferenceDanceDataset & {
        buildMetadata?: Record<string, unknown>;
      };
      metadata.buildMetadata = {
        ...(metadata.buildMetadata ?? {}),
        calibration: {
          calibratedAt: new Date().toISOString(),
          targetRecall: settings.targetRecall,
          targetFalseAcceptRate: settings.targetFalseAcceptRate,
          selected: calibration.selected,
        },
      };
    }
    const output = join(
      settings.dataRoot,
      dataset.danceId,
      'processed',
      'dataset.json',
    );
    await writeJsonAtomic(output, dataset, false);
  }
}

async function loadGeneratedDatasets(
  dataRoot: string,
): Promise<ReferenceDanceDataset[]> {
  const entries = await readdir(dataRoot, { withFileTypes: true });
  const datasets: ReferenceDanceDataset[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filename = join(dataRoot, entry.name, 'processed', 'dataset.json');
    try {
      const dataset = JSON.parse(
        await readFile(filename, 'utf8'),
      ) as ReferenceDanceDataset & {
        buildMetadata?: { schemaVersion?: string };
      };
      if (
        dataset.schemaVersion === 'reference-dance-dataset-v1' &&
        dataset.buildMetadata?.schemaVersion ===
          'reference-dataset-build-metadata-v1'
      ) {
        datasets.push(dataset);
      }
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return datasets.sort((left, right) =>
    left.danceId.localeCompare(right.danceId),
  );
}

function printReport(calibrations: PackCalibration[]) {
  for (const calibration of calibrations) {
    const selected = calibration.selected;
    console.log(
      [
        `${calibration.danceId}/${calibration.motionId}`,
        `parts=${selected.requiredParts.join('+')}`,
        `threshold=${selected.threshold.toFixed(2)}`,
        `recall=${percent(selected.recall)}`,
        `falseAccept=${percent(selected.falseAcceptRate)}`,
        `precision=${percent(selected.precision)}`,
        `positiveMean=${selected.meanPositiveScore.toFixed(3)}`,
        `negativeMax=${selected.maximumNegativeScore.toFixed(3)}`,
        `reliable=${selected.reliable}`,
      ].join(' '),
    );
  }
}

function parseOptions(argv: string[]): CliOptions {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith('--')) continue;
    const key = argument
      .slice(2)
      .replace(/-([a-z])/g, (_, character: string) => character.toUpperCase());
    if (['apply', 'allowUnreliable'].includes(key)) {
      parsed[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new Error(`Missing value for ${argument}`);
    }
    parsed[key] = value;
    index += 1;
  }
  const dataRoot = resolve(
    String(parsed.dataRoot ?? resolve(process.cwd(), '..', 'data', 'dances')),
  );
  return {
    apply: Boolean(parsed.apply),
    allowUnreliable: Boolean(parsed.allowUnreliable),
    dataRoot,
    reportFile: resolve(
      String(
        parsed.report ??
          join(
            dirname(dataRoot),
            'reports',
            'reference-dataset-calibration.json',
          ),
      ),
    ),
    targetRecall: unitInterval(parsed.targetRecall, 0.8),
    targetFalseAcceptRate: unitInterval(parsed.targetFalseAcceptRate, 0.05),
  };
}

async function writeJsonAtomic(
  filename: string,
  value: unknown,
  pretty: boolean,
) {
  await mkdir(dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(
    temporary,
    `${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`,
    'utf8',
  );
  await rename(temporary, filename);
}

function unitInterval(value: string | boolean | undefined, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1
    ? number
    : fallback;
}

function average(values: number[]) {
  return values.length === 0
    ? 0
    : values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number, digits: number) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
