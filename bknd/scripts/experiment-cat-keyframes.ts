import 'reflect-metadata';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { ReferenceDanceDataset } from '../src/vlm-core/contracts/reference-dataset.types';
import type {
  MotionReferenceTemplate,
  MotionTemplatePack,
} from '../src/vlm-core/contracts/realtime-judge.types';
import { SkeletonTemplateMatcherEngine } from '../src/vlm-core/rules/skeleton-template-matcher.engine';

interface ScoredCase {
  sampleId: string;
  score: number;
  keyframeTrajectory?: number;
  visible: boolean;
}

const targetRecall = 0.8;
const dataRoot = resolve(
  process.argv[2] ?? resolve(process.cwd(), '..', 'data', 'dances'),
);
const reportFile = resolve(
  process.argv[3] ??
    resolve(
      process.cwd(),
      '..',
      'data',
      'reports',
      'cat-keyframe-experiment.json',
    ),
);
const matcher = new SkeletonTemplateMatcherEngine();

void main();

async function main() {
  const catFile = join(dataRoot, 'cat', 'processed', 'dataset.json');
  const cat = JSON.parse(
    await readFile(catFile, 'utf8'),
  ) as ReferenceDanceDataset;
  const catPack = cat.templatePacks.find(
    (pack) => pack.motionId === 'cat-main',
  );
  if (!catPack) {
    throw new Error('cat-main template pack not found');
  }
  if (!catPack.keyframes?.length) {
    throw new Error(
      'cat-main has no keyframe annotations; rebuild the cat dataset first',
    );
  }

  const baseline = evaluatePositiveOnly(withoutKeyframes(catPack));
  const keyframe = evaluatePositiveOnly(catPack);
  const report = {
    schemaVersion: 'cat-keyframe-positive-only-experiment-v1',
    generatedAt: new Date().toISOString(),
    dataRoot,
    trainingMode: 'single-category-positive-only',
    danceId: cat.danceId,
    referenceCount: catPack.templates.length,
    targetRecall,
    keyframes: catPack.keyframes,
    baseline,
    keyframe,
    delta: {
      meanScore: round(keyframe.summary.meanScore - baseline.summary.meanScore),
      recallAtConfiguredThreshold: round(
        keyframe.configuredPolicy.recall - baseline.configuredPolicy.recall,
      ),
    },
    limitations: [
      'Only cat references participate in training and validation.',
      'Positive cases use leave-one-reference-out validation, not independent users.',
      'Without negative samples this report cannot estimate false-accept rate or precision.',
      'The eight cat progress anchors were visually annotated from the current choreography.',
    ],
  };

  await writeJsonAtomic(reportFile, report);
  printSummary('baseline', baseline);
  printSummary('keyframe', keyframe);
  console.log(`Report: ${reportFile}`);
}

function evaluatePositiveOnly(pack: MotionTemplatePack) {
  const cases = pack.templates.map((heldOut) =>
    score(
      {
        ...pack,
        templates: pack.templates.filter(
          (template) => template.templateId !== heldOut.templateId,
        ),
      },
      heldOut,
    ),
  );
  const configuredThreshold =
    pack.evaluationPolicy?.acceptWithHintThreshold ?? 0.55;
  return {
    summary: summarize(cases),
    configuredPolicy: recallAt(configuredThreshold, cases),
    recommendedPolicy: selectPositiveThreshold(cases),
    cases,
  };
}

function withoutKeyframes(pack: MotionTemplatePack): MotionTemplatePack {
  const { keyframes: _keyframes, ...withoutAnnotations } = pack;
  const { keyframeTrajectoryWeight: _keyframeTrajectoryWeight, ...policy } =
    pack.evaluationPolicy ?? {};
  return {
    ...withoutAnnotations,
    evaluationPolicy: policy,
  };
}

function score(
  pack: MotionTemplatePack,
  observation: MotionReferenceTemplate,
): ScoredCase {
  const result = matcher.evaluate(
    {
      ...pack,
      evaluationPolicy: {
        ...pack.evaluationPolicy,
        acceptThreshold: 0,
        acceptWithHintThreshold: 0,
        minimumCompletionProgress: 0,
        minimumObservationMs: 0,
      },
    },
    {
      schemaVersion: 'realtime-judge-v1',
      sessionId: 'cat-keyframe-positive-only',
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
  return {
    sampleId: observation.templateId,
    score: result.decision === 'NOT_VISIBLE' ? 0 : result.scores.overall,
    keyframeTrajectory: result.scores.keyframeTrajectory,
    visible: result.decision !== 'NOT_VISIBLE',
  };
}

function selectPositiveThreshold(cases: ScoredCase[]) {
  const candidates = Array.from({ length: 96 }, (_, index) =>
    recallAt(index / 100, cases),
  );
  return (
    candidates
      .filter((candidate) => candidate.recall >= targetRecall)
      .sort((left, right) => right.threshold - left.threshold)[0] ??
    recallAt(0, cases)
  );
}

function recallAt(threshold: number, cases: ScoredCase[]) {
  const accepted = cases.filter((item) => item.score >= threshold).length;
  const recall = accepted / cases.length;
  return {
    threshold: round(threshold),
    accepted,
    total: cases.length,
    recall: round(recall),
    meetsTargetRecall: recall >= targetRecall,
  };
}

function summarize(cases: ScoredCase[]) {
  const scores = cases.map((item) => item.score);
  return {
    count: cases.length,
    visibleCount: cases.filter((item) => item.visible).length,
    meanScore: round(average(scores)),
    minimumScore: round(Math.min(...scores)),
    maximumScore: round(Math.max(...scores)),
  };
}

async function writeJsonAtomic(filename: string, value: unknown) {
  await mkdir(dirname(filename), { recursive: true });
  const temporary = `${filename}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, filename);
}

function printSummary(
  label: string,
  result: ReturnType<typeof evaluatePositiveOnly>,
) {
  console.log(
    [
      label,
      `mean=${result.summary.meanScore.toFixed(3)}`,
      `configuredThreshold=${result.configuredPolicy.threshold.toFixed(2)}`,
      `configuredRecall=${percent(result.configuredPolicy.recall)}`,
      `recommendedThreshold=${result.recommendedPolicy.threshold.toFixed(2)}`,
      `recommendedRecall=${percent(result.recommendedPolicy.recall)}`,
    ].join(' '),
  );
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function round(value: number) {
  return Number(value.toFixed(4));
}

function percent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}
