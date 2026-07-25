import 'reflect-metadata';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ReferenceDanceDataset } from '../src/vlm-core/contracts/reference-dataset.types';
import type {
  MotionReferenceTemplate,
  RealtimeJudgeResult,
} from '../src/vlm-core/contracts/realtime-judge.types';
import { SkeletonTemplateMatcherEngine } from '../src/vlm-core/rules/skeleton-template-matcher.engine';

interface ValidationResult {
  dataset: string;
  frames: number;
  poseCoverage: number;
  handCoverage: number;
  crossValidation: {
    cases: number;
    passed: number;
    passRate: number;
    meanScore: number;
    minimumScore: number;
    decisions: Record<string, number>;
  };
  crossMotionRejection: {
    cases: number;
    rejected: number;
    rejectionRate: number;
    falseAccepts: number;
  };
  errors: string[];
}

const dataRoot = resolve(process.cwd(), '..', 'data', 'dances');
const matcher = new SkeletonTemplateMatcherEngine();

async function main(): Promise<void> {
  const danceIds = await readdir(dataRoot);
  const results: ValidationResult[] = [];
  for (const danceId of danceIds) {
    const filename = resolve(dataRoot, danceId, 'processed', 'dataset.json');
    try {
      const dataset = JSON.parse(
        await readFile(filename, 'utf8'),
      ) as ReferenceDanceDataset;
      results.push(validateDataset(dataset, filename));
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  if (results.length === 0) {
    throw new Error(`No processed datasets found below ${dataRoot}`);
  }

  let failed = false;
  for (const result of results) {
    console.log(`\n[${result.dataset}]`);
    console.log(
      `frames=${result.frames}, poseCoverage=${percent(result.poseCoverage)}, handCoverage=${percent(result.handCoverage)}`,
    );
    console.log(
      `leave-one-reference-out: ${result.crossValidation.passed}/${result.crossValidation.cases} passed (${percent(result.crossValidation.passRate)}), mean=${result.crossValidation.meanScore.toFixed(3)}, min=${result.crossValidation.minimumScore.toFixed(3)}`,
    );
    console.log(
      `decisions=${JSON.stringify(result.crossValidation.decisions)}`,
    );
    console.log(
      `cross-motion rejection: ${result.crossMotionRejection.rejected}/${result.crossMotionRejection.cases} rejected (${percent(result.crossMotionRejection.rejectionRate)}), false accepts=${result.crossMotionRejection.falseAccepts}`,
    );
    for (const error of result.errors) console.error(`ERROR: ${error}`);
    failed ||= result.errors.length > 0;
  }

  if (failed) {
    process.exitCode = 1;
    console.error('\nReference dataset validation FAILED.');
  } else {
    console.log('\nReference dataset validation PASSED.');
  }
}

function validateDataset(
  dataset: ReferenceDanceDataset,
  filename: string,
): ValidationResult {
  const errors: string[] = [];
  const frames = dataset.templatePacks.flatMap((pack) =>
    pack.templates.flatMap((template) => template.frames),
  );
  const poseFrameCount = frames.filter(
    (frame) => frame.pose.length >= 33,
  ).length;
  const handCount = frames.reduce(
    (count, frame) =>
      count +
      Number((frame.leftHand?.length ?? 0) >= 21) +
      Number((frame.rightHand?.length ?? 0) >= 21),
    0,
  );
  const poseCoverage = frames.length === 0 ? 0 : poseFrameCount / frames.length;
  const handCoverage =
    frames.length === 0 ? 0 : handCount / (frames.length * 2);

  if (dataset.schemaVersion !== 'reference-dance-dataset-v1') {
    errors.push(`unsupported schemaVersion: ${dataset.schemaVersion}`);
  }
  if (dataset.sourceVideoCount < 2) {
    errors.push('at least two independent reference videos are required');
  }
  if (dataset.templatePacks.length === 0) {
    errors.push('no motion template packs');
  }
  if (poseCoverage < 0.98) {
    errors.push(`pose landmark coverage is too low: ${percent(poseCoverage)}`);
  }
  if (dataset.extraction.detectedFrameCount < dataset.sourceVideoCount * 20) {
    errors.push(
      `too few detected source frames: ${dataset.extraction.detectedFrameCount}`,
    );
  }

  for (const pack of dataset.templatePacks) {
    if (pack.templates.length < 2) {
      errors.push(`${pack.motionId} has fewer than two templates`);
    }
    for (const template of pack.templates) {
      if (template.frames.length < 5) {
        errors.push(`${template.templateId} has fewer than five frames`);
      }
      if (!timestampsIncrease(template)) {
        errors.push(`${template.templateId} has non-increasing timestamps`);
      }
    }
  }

  const outcomes: RealtimeJudgeResult[] = [];
  const crossMotionOutcomes: RealtimeJudgeResult[] = [];
  for (const pack of dataset.templatePacks) {
    for (const heldOut of pack.templates) {
      const trainingTemplates = pack.templates.filter(
        (template) => template.templateId !== heldOut.templateId,
      );
      if (trainingTemplates.length === 0) continue;
      outcomes.push(
        matcher.evaluate(
          { ...pack, templates: trainingTemplates },
          {
            schemaVersion: 'realtime-judge-v1',
            sessionId: 'dataset-validation',
            sampleId: `held-out-${heldOut.templateId}`,
            danceId: dataset.danceId,
            motionId: pack.motionId,
            observation: {
              mirrored: heldOut.mirrored,
              progress: 1,
              frames: heldOut.frames,
            },
          },
        ),
      );
      for (const wrongPack of dataset.templatePacks) {
        if (wrongPack.motionId === pack.motionId) continue;
        crossMotionOutcomes.push(
          matcher.evaluate(wrongPack, {
            schemaVersion: 'realtime-judge-v1',
            sessionId: 'dataset-validation',
            sampleId: `wrong-motion-${heldOut.templateId}-${wrongPack.motionId}`,
            danceId: dataset.danceId,
            motionId: wrongPack.motionId,
            observation: {
              mirrored: heldOut.mirrored,
              progress: 1,
              frames: heldOut.frames,
            },
          }),
        );
      }
    }
  }

  const passed = outcomes.filter((outcome) =>
    ['ACCEPT', 'ACCEPT_HINT'].includes(outcome.decision),
  ).length;
  const passRate = outcomes.length === 0 ? 0 : passed / outcomes.length;
  const scores = outcomes.map((outcome) => outcome.scores.overall);
  const meanScore =
    scores.length === 0
      ? 0
      : scores.reduce((total, score) => total + score, 0) / scores.length;
  const minimumScore = scores.length === 0 ? 0 : Math.min(...scores);
  const decisions = outcomes.reduce<Record<string, number>>(
    (counts, outcome) => {
      counts[outcome.decision] = (counts[outcome.decision] ?? 0) + 1;
      return counts;
    },
    {},
  );

  if (outcomes.length === 0) {
    errors.push('leave-one-reference-out validation produced no cases');
  } else if (passRate < 0.8) {
    errors.push(
      `leave-one-reference-out pass rate is below 80%: ${percent(passRate)}`,
    );
  }
  const falseAccepts = crossMotionOutcomes.filter((outcome) =>
    ['ACCEPT', 'ACCEPT_HINT'].includes(outcome.decision),
  ).length;
  const rejected = crossMotionOutcomes.length - falseAccepts;
  const rejectionRate =
    crossMotionOutcomes.length === 0
      ? 0
      : rejected / crossMotionOutcomes.length;
  if (crossMotionOutcomes.length === 0) {
    errors.push('cross-motion rejection validation produced no cases');
  } else if (rejectionRate < 0.95) {
    errors.push(
      `cross-motion rejection rate is below 95%: ${percent(rejectionRate)}`,
    );
  }

  return {
    dataset: `${dataset.danceId} (${filename})`,
    frames: frames.length,
    poseCoverage,
    handCoverage,
    crossValidation: {
      cases: outcomes.length,
      passed,
      passRate,
      meanScore,
      minimumScore,
      decisions,
    },
    crossMotionRejection: {
      cases: crossMotionOutcomes.length,
      rejected,
      rejectionRate,
      falseAccepts,
    },
    errors,
  };
}

function timestampsIncrease(template: MotionReferenceTemplate): boolean {
  return template.frames.every(
    (frame, index) =>
      index === 0 || frame.timestampMs > template.frames[index - 1].timestampMs,
  );
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

void main();
