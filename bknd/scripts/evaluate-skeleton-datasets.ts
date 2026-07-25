import 'reflect-metadata';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import type {
  MotionReferenceTemplate,
  MotionTemplatePack,
  RealtimeScoreBreakdown,
  SkeletonFrame,
  SkeletonLandmark,
} from '../src/vlm-core/contracts/realtime-judge.types';
import { SkeletonTemplateMatcherEngine } from '../src/vlm-core/rules/skeleton-template-matcher.engine';
import { TEMPLATE_MATCHER_VERSION } from '../src/vlm-core/rules/template-matcher.config';

interface SkeletonVideo {
  videoId: string;
  sourceFile: string;
  sequence: number;
  durationMs: number;
  sampledFrameCount: number;
  detectedFrameCount: number;
  poseCoverage: number;
  handCoverage: number;
  frames: SkeletonFrame[];
}

interface SkeletonVideoDataset {
  schemaVersion: 'skeleton-video-dataset-v1';
  datasetId: string;
  title: string;
  extraction: {
    sampleFps: number;
    mirrored: boolean;
  };
  videos: SkeletonVideo[];
}

interface DatasetQuality {
  datasetId: string;
  videos: number;
  frames: number;
  durationSeconds: number;
  meanDurationSeconds: number;
  poseCoverage: number;
  leftHandCoverage: number;
  rightHandCoverage: number;
  bothHandsCoverage: number;
}

interface EvaluationCase {
  sampleId: string;
  trueLabel: string;
  predictedLabel: string;
  correct: boolean;
  scores: Record<string, number>;
  genuineScore: number;
  strongestImpostorScore: number;
  margin: number;
  genuineBreakdown: RealtimeScoreBreakdown;
}

interface ThresholdMetrics {
  threshold: number;
  truePositiveRate: number;
  falseNegativeRate: number;
  falsePositiveRate: number;
  trueNegativeRate: number;
  balancedAccuracy: number;
  precision: number;
  positiveAccepted: number;
  positiveTotal: number;
  negativeAccepted: number;
  negativeTotal: number;
}

const dataRoot = resolve(process.cwd(), 'data');
const reportPath = resolve(
  process.cwd(),
  'reports',
  'skeleton-evaluation.json',
);
const matcher = new SkeletonTemplateMatcherEngine();

async function main(): Promise<void> {
  const datasets = await loadDatasets();
  if (datasets.length < 2) {
    throw new Error(
      `At least two datasets are required below ${dataRoot}; found ${datasets.length}`,
    );
  }

  const labels = datasets.map((dataset) => dataset.datasetId).sort();
  const pointCases = evaluateLeaveOneVideoOut(datasets);
  const relationalCases = evaluateRelationalLeaveOneVideoOut(
    datasets,
    relationalTemplateScore,
    1,
  );
  const temporalRelationalCases = evaluateRelationalLeaveOneVideoOut(
    datasets,
    temporalRelationalTemplateScore,
    3,
  );
  const pointBenchmark = verificationBenchmark(pointCases, labels);
  const relationalBenchmark = verificationBenchmark(relationalCases, labels);
  const temporalRelationalBenchmark = verificationBenchmark(
    temporalRelationalCases,
    labels,
  );
  const trainingDiagnostics = diagnoseTrainingClasses(
    datasets,
    temporalRelationalBenchmark,
    labels,
  );
  const report = {
    schemaVersion: 'skeleton-evaluation-report-v1',
    generatedAt: new Date().toISOString(),
    validation: {
      design:
        'stratified ten-fold leave-one-out; all six classes use nine training videos and one held-out test video in every fold',
      positiveTest:
        'for fold N, hold out sequence N from every class and build every class bank from its other nine videos',
      negativeControl:
        'the five other held-out videos in the same fold are negative controls; no held-out video enters any template bank',
      thresholdSelection:
        'select a separate threshold for each class, maximizing true-positive rate subject to at most 5% cross-class false accepts',
    },
    methods: {
      pointDtw: {
        matcher: TEMPLATE_MATCHER_VERSION,
        normalization:
          'shoulder-centered and shoulder-width-scaled pose; wrist-centered and palm-scaled hands',
        temporalAlignment: 'dynamic time warping over 16 sampled frames',
        scoreComponents: {
          pose: 0.5,
          leftHandWhenAvailable: 0.1,
          rightHandWhenAvailable: 0.1,
          wristTrajectory: 0.1,
        },
        classSpecificProfile: {
          fade: 'body pose ignored; 100% body-relative left/right hand position with index-aligned timing',
        },
      },
      relationalDtw: {
        matcher: 'relational-dtw-v1',
        normalization:
          'shoulder-centered, shoulder-width-scaled, and shoulder-axis-aligned coordinates',
        relations: [
          'upper-body joint angles',
          'normalized inter-joint distances',
          'body-relative arm and wrist directions',
          'finger joint angles and fingertip distances',
        ],
        temporalAlignment: 'dynamic time warping over 24 sampled frames',
      },
      temporalRelationalDtw: {
        matcher: 'temporal-relational-dtw-v2',
        spatialTolerance:
          'Huber-clipped relational distance with a wider acceptance scale',
        temporalAlignment: [
          'Sakoe-Chiba phase window of 12%',
          'penalty for horizontal and vertical time warps',
          'phase-aligned relation-velocity comparison',
          'soft duration-ratio penalty',
        ],
        scoreWeights: {
          spatialRelations: 0.4,
          motionTiming: 0.6,
        },
        templateAggregation:
          'mean of the three closest same-class templates to prevent one accidental match from passing',
      },
    },
    datasetQuality: datasets.map(datasetQuality),
    benchmarks: {
      pointDtw: pointBenchmark,
      relationalDtw: relationalBenchmark,
      temporalRelationalDtw: temporalRelationalBenchmark,
    },
    trainingDiagnostics,
    limitations: [
      'Cross-class videos are proxy negatives, not examples of a learner performing the right gesture incorrectly.',
      'All source videos are reference-quality examples, so this validates discrimination and consistency, not agreement with human quality ratings.',
      'Each class has only ten positive videos; thresholds are exploratory and require confirmation on a separate user test set.',
    ],
  };

  await mkdir(resolve(process.cwd(), 'reports'), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  console.log('Skeleton benchmark: 6 independent classes x 10 videos');
  console.log(
    `production matcher Top-1=${percent(pointBenchmark.top1.accuracy)}, macro AUC=${pointBenchmark.macro.rocAuc.toFixed(3)}, EER=${percent(pointBenchmark.macro.equalErrorRate)}, TPR@FPR<=5%=${percent(pointBenchmark.macro.truePositiveRateAtFivePercentFpr)}`,
  );
  console.log(
    `relational DTW Top-1=${percent(relationalBenchmark.top1.accuracy)}, macro AUC=${relationalBenchmark.macro.rocAuc.toFixed(3)}, EER=${percent(relationalBenchmark.macro.equalErrorRate)}, TPR@FPR<=5%=${percent(relationalBenchmark.macro.truePositiveRateAtFivePercentFpr)}`,
  );
  console.log(
    `temporal-relational DTW Top-1=${percent(temporalRelationalBenchmark.top1.accuracy)}, macro AUC=${temporalRelationalBenchmark.macro.rocAuc.toFixed(3)}, EER=${percent(temporalRelationalBenchmark.macro.equalErrorRate)}, TPR@FPR<=5%=${percent(temporalRelationalBenchmark.macro.truePositiveRateAtFivePercentFpr)}`,
  );
  for (const diagnostic of trainingDiagnostics) {
    console.log(
      `${diagnostic.datasetId}: train-included=${diagnostic.summary.meanTrainIncludedScore.toFixed(3)}, leave-one-out=${diagnostic.summary.meanLeaveOneOutScore.toFixed(3)}, below-threshold=${diagnostic.summary.belowThresholdVideos.length}/10`,
    );
  }
  console.log(`Report written to ${reportPath}`);
}

async function loadDatasets(): Promise<SkeletonVideoDataset[]> {
  const filenames = (await readdir(dataRoot))
    .filter((filename) => filename.endsWith('.json'))
    .sort();
  const datasets: SkeletonVideoDataset[] = [];

  for (const filename of filenames) {
    const path = resolve(dataRoot, filename);
    const dataset = JSON.parse(
      await readFile(path, 'utf8'),
    ) as SkeletonVideoDataset;
    if (dataset.schemaVersion !== 'skeleton-video-dataset-v1') continue;
    if (!dataset.datasetId || dataset.videos.length < 2) {
      throw new Error(
        `${basename(path)} needs a datasetId and at least 2 videos`,
      );
    }
    dataset.videos.sort((left, right) => left.sequence - right.sequence);
    datasets.push(dataset);
  }

  return datasets;
}

function evaluateLeaveOneVideoOut(
  datasets: SkeletonVideoDataset[],
): EvaluationCase[] {
  const cases: EvaluationCase[] = [];
  const foldCount = Math.min(
    ...datasets.map((dataset) => dataset.videos.length),
  );
  for (let fold = 0; fold < foldCount; fold += 1) {
    for (const source of datasets) {
      const heldOut = source.videos[fold];
      const scores: Record<string, number> = {};
      const breakdowns: Record<string, RealtimeScoreBreakdown> = {};

      for (const candidate of datasets) {
        const trainingVideos = candidate.videos.filter(
          (_video, index) => index !== fold,
        );
        const pack = makePack(candidate, trainingVideos);
        const result = matcher.evaluate(pack, {
          schemaVersion: 'realtime-judge-v1',
          sessionId: 'offline-skeleton-evaluation',
          sampleId: heldOut.videoId,
          danceId: 'dataset-benchmark',
          motionId: candidate.datasetId,
          observation: {
            mirrored: source.extraction.mirrored,
            progress: 1,
            frames: heldOut.frames,
          },
        });
        scores[candidate.datasetId] = result.scores.overall;
        breakdowns[candidate.datasetId] = result.scores;
      }

      const predictedLabel = Object.entries(scores).sort(
        ([leftLabel, leftScore], [rightLabel, rightScore]) =>
          rightScore - leftScore || leftLabel.localeCompare(rightLabel),
      )[0][0];
      const genuineScore = scores[source.datasetId];
      const strongestImpostorScore = Math.max(
        ...Object.entries(scores)
          .filter(([label]) => label !== source.datasetId)
          .map(([, score]) => score),
      );

      cases.push({
        sampleId: heldOut.videoId,
        trueLabel: source.datasetId,
        predictedLabel,
        correct: predictedLabel === source.datasetId,
        scores,
        genuineScore,
        strongestImpostorScore,
        margin: round(genuineScore - strongestImpostorScore),
        genuineBreakdown: breakdowns[source.datasetId],
      });
    }
  }
  return cases;
}

function evaluateRelationalLeaveOneVideoOut(
  datasets: SkeletonVideoDataset[],
  scoreTemplate: (
    referenceFrames: SkeletonFrame[],
    observationFrames: SkeletonFrame[],
  ) => {
    overall: number;
    pose: number;
    leftHand: number | undefined;
    rightHand: number | undefined;
  },
  topTemplateCount: number,
): EvaluationCase[] {
  const cases: EvaluationCase[] = [];
  const foldCount = Math.min(
    ...datasets.map((dataset) => dataset.videos.length),
  );
  for (let fold = 0; fold < foldCount; fold += 1) {
    for (const source of datasets) {
      const heldOut = source.videos[fold];
      const scores: Record<string, number> = {};
      const breakdowns: Record<string, RealtimeScoreBreakdown> = {};

      for (const candidate of datasets) {
        const trainingVideos = candidate.videos.filter(
          (_video, index) => index !== fold,
        );
        const templateScores = trainingVideos.map((video) =>
          scoreTemplate(video.frames, heldOut.frames),
        );
        const selected = templateScores
          .sort((left, right) => right.overall - left.overall)
          .slice(0, topTemplateCount);
        const best = {
          overall: average(selected.map((score) => score.overall)),
          pose: average(selected.map((score) => score.pose)),
          leftHand: optionalAverage(selected.map((score) => score.leftHand)),
          rightHand: optionalAverage(selected.map((score) => score.rightHand)),
        };
        scores[candidate.datasetId] = round(best.overall);
        breakdowns[candidate.datasetId] = {
          overall: round(best.overall),
          pose: round(best.pose),
          leftHand:
            best.leftHand === undefined ? undefined : round(best.leftHand),
          rightHand:
            best.rightHand === undefined ? undefined : round(best.rightHand),
          visibility: 1,
        };
      }

      const predictedLabel = Object.entries(scores).sort(
        ([leftLabel, leftScore], [rightLabel, rightScore]) =>
          rightScore - leftScore || leftLabel.localeCompare(rightLabel),
      )[0][0];
      const genuineScore = scores[source.datasetId];
      const strongestImpostorScore = Math.max(
        ...Object.entries(scores)
          .filter(([label]) => label !== source.datasetId)
          .map(([, score]) => score),
      );
      cases.push({
        sampleId: heldOut.videoId,
        trueLabel: source.datasetId,
        predictedLabel,
        correct: predictedLabel === source.datasetId,
        scores,
        genuineScore,
        strongestImpostorScore,
        margin: round(genuineScore - strongestImpostorScore),
        genuineBreakdown: breakdowns[source.datasetId],
      });
    }
  }
  return cases;
}

function relationalTemplateScore(
  referenceFrames: SkeletonFrame[],
  observationFrames: SkeletonFrame[],
) {
  const pose = relationSequenceSimilarity(
    referenceFrames,
    observationFrames,
    poseRelations,
    0.72,
  );
  const leftHand = relationSequenceSimilarity(
    referenceFrames,
    observationFrames,
    (frame) => handRelations(frame.leftHand),
    0.62,
  );
  const rightHand = relationSequenceSimilarity(
    referenceFrames,
    observationFrames,
    (frame) => handRelations(frame.rightHand),
    0.62,
  );
  const components: Array<[number | undefined, number]> = [
    [pose, 0.7],
    [leftHand, 0.15],
    [rightHand, 0.15],
  ];
  const available = components.filter(
    (component): component is [number, number] =>
      component[0] !== undefined && Number.isFinite(component[0]),
  );
  const totalWeight = available.reduce(
    (sum, component) => sum + component[1],
    0,
  );
  const overall =
    totalWeight === 0
      ? 0
      : available.reduce(
          (sum, component) => sum + component[0] * component[1],
          0,
        ) / totalWeight;
  return { overall, pose: pose ?? 0, leftHand, rightHand };
}

function temporalRelationalTemplateScore(
  referenceFrames: SkeletonFrame[],
  observationFrames: SkeletonFrame[],
) {
  const pose = timedRelationSequenceSimilarity(
    referenceFrames,
    observationFrames,
    poseRelations,
    0.92,
  );
  const leftHand = timedRelationSequenceSimilarity(
    referenceFrames,
    observationFrames,
    (frame) => handRelations(frame.leftHand),
    0.8,
  );
  const rightHand = timedRelationSequenceSimilarity(
    referenceFrames,
    observationFrames,
    (frame) => handRelations(frame.rightHand),
    0.8,
  );
  const components: Array<[number | undefined, number]> = [
    [pose, 0.7],
    [leftHand, 0.15],
    [rightHand, 0.15],
  ];
  const available = components.filter(
    (component): component is [number, number] =>
      component[0] !== undefined && Number.isFinite(component[0]),
  );
  const totalWeight = available.reduce(
    (sum, component) => sum + component[1],
    0,
  );
  const overall =
    totalWeight === 0
      ? 0
      : available.reduce(
          (sum, component) => sum + component[0] * component[1],
          0,
        ) / totalWeight;
  return { overall, pose: pose ?? 0, leftHand, rightHand };
}

function timedRelationSequenceSimilarity(
  referenceFrames: SkeletonFrame[],
  observationFrames: SkeletonFrame[],
  describe: (frame: SkeletonFrame) => number[] | undefined,
  spatialDistanceScale: number,
): number | undefined {
  const reference = sampleVectors(
    referenceFrames
      .map(describe)
      .filter((values): values is number[] => Boolean(values)),
    24,
  );
  const observation = sampleVectors(
    observationFrames
      .map(describe)
      .filter((values): values is number[] => Boolean(values)),
    24,
  );
  if (reference.length < 5 || observation.length < 5) return undefined;

  const rows = reference.length + 1;
  const columns = observation.length + 1;
  const phaseWindow = 0.12;
  const warpPenalty = 0.08;
  const costs = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(Number.POSITIVE_INFINITY),
  );
  const geometrySums = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0),
  );
  const phaseSums = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0),
  );
  const warpCounts = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0),
  );
  const pathLengths = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0),
  );
  costs[0][0] = 0;

  for (let row = 1; row < rows; row += 1) {
    const referencePhase = (row - 1) / Math.max(1, reference.length - 1);
    for (let column = 1; column < columns; column += 1) {
      const observationPhase =
        (column - 1) / Math.max(1, observation.length - 1);
      const phaseGap = Math.abs(referencePhase - observationPhase);
      if (phaseGap > phaseWindow) continue;

      const predecessors = [
        { row: row - 1, column, warp: 1 },
        { row, column: column - 1, warp: 1 },
        { row: row - 1, column: column - 1, warp: 0 },
      ]
        .filter((candidate) =>
          Number.isFinite(costs[candidate.row][candidate.column]),
        )
        .sort(
          (left, right) =>
            costs[left.row][left.column] +
            left.warp * warpPenalty -
            (costs[right.row][right.column] + right.warp * warpPenalty),
        );
      const best = predecessors[0];
      if (!best) continue;

      const geometryDistance = numericVectorDistance(
        reference[row - 1],
        observation[column - 1],
      );
      const localCost =
        geometryDistance + phaseGap * 0.75 + best.warp * warpPenalty;
      costs[row][column] = costs[best.row][best.column] + localCost;
      geometrySums[row][column] =
        geometrySums[best.row][best.column] + geometryDistance;
      phaseSums[row][column] = phaseSums[best.row][best.column] + phaseGap;
      warpCounts[row][column] = warpCounts[best.row][best.column] + best.warp;
      pathLengths[row][column] = pathLengths[best.row][best.column] + 1;
    }
  }

  const pathLength = pathLengths.at(-1)?.at(-1) ?? 0;
  if (pathLength === 0) return undefined;
  const meanGeometry =
    (geometrySums.at(-1)?.at(-1) ?? Number.POSITIVE_INFINITY) / pathLength;
  const meanPhaseGap =
    (phaseSums.at(-1)?.at(-1) ?? Number.POSITIVE_INFINITY) / pathLength;
  const warpRatio = (warpCounts.at(-1)?.at(-1) ?? pathLength) / pathLength;
  const spatialScore = Math.exp(-meanGeometry / spatialDistanceScale);

  const referenceVelocity = relationVelocities(reference);
  const observationVelocity = relationVelocities(observation);
  const velocityCount = Math.min(
    referenceVelocity.length,
    observationVelocity.length,
  );
  const velocityDistance =
    velocityCount === 0
      ? Number.POSITIVE_INFINITY
      : referenceVelocity
          .slice(0, velocityCount)
          .reduce(
            (sum, velocity, index) =>
              sum + numericVectorDistance(velocity, observationVelocity[index]),
            0,
          ) / velocityCount;
  const velocityScore = Math.exp(
    -velocityDistance / (spatialDistanceScale * 0.72),
  );
  const pathTimingScore = Math.exp(-meanPhaseGap / 0.08 - warpRatio / 0.3);
  const durationRatio =
    frameDuration(observationFrames) /
    Math.max(1, frameDuration(referenceFrames));
  const durationScore = Math.exp(-Math.abs(Math.log(durationRatio)) / 0.38);
  const timingScore =
    velocityScore * 0.55 + pathTimingScore * 0.3 + durationScore * 0.15;

  return spatialScore * 0.4 + timingScore * 0.6;
}

function relationVelocities(vectors: number[][]): number[][] {
  return vectors
    .slice(1)
    .map((vector, index) =>
      vector.map(
        (value, dimension) => value - (vectors[index][dimension] ?? 0),
      ),
    );
}

function frameDuration(frames: SkeletonFrame[]): number {
  return frames.length < 2
    ? 0
    : frames[frames.length - 1].timestampMs - frames[0].timestampMs;
}

function relationSequenceSimilarity(
  referenceFrames: SkeletonFrame[],
  observationFrames: SkeletonFrame[],
  describe: (frame: SkeletonFrame) => number[] | undefined,
  distanceScale: number,
): number | undefined {
  const reference = sampleVectors(
    referenceFrames
      .map(describe)
      .filter((values): values is number[] => Boolean(values)),
    24,
  );
  const observation = sampleVectors(
    observationFrames
      .map(describe)
      .filter((values): values is number[] => Boolean(values)),
    24,
  );
  if (reference.length < 5 || observation.length < 5) return undefined;

  const rows = reference.length + 1;
  const columns = observation.length + 1;
  const costs = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(Number.POSITIVE_INFINITY),
  );
  const lengths = Array.from({ length: rows }, () =>
    Array<number>(columns).fill(0),
  );
  costs[0][0] = 0;
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const predecessors = [
        [costs[row - 1][column], lengths[row - 1][column]],
        [costs[row][column - 1], lengths[row][column - 1]],
        [costs[row - 1][column - 1], lengths[row - 1][column - 1]],
      ].sort((left, right) => left[0] - right[0]);
      costs[row][column] =
        predecessors[0][0] +
        numericVectorDistance(reference[row - 1], observation[column - 1]);
      lengths[row][column] = predecessors[0][1] + 1;
    }
  }
  const pathLength = lengths.at(-1)?.at(-1) ?? 0;
  if (pathLength === 0) return undefined;
  const meanDistance = (costs.at(-1)?.at(-1) ?? 0) / pathLength;
  return Math.exp(-meanDistance / distanceScale);
}

function poseRelations(frame: SkeletonFrame): number[] | undefined {
  const indices = [0, 11, 12, 13, 14, 15, 16, 23, 24];
  const landmarks = indices.map((index) => frame.pose[index]);
  if (landmarks.some((landmark) => !landmark)) return undefined;
  const points = normalizeBodyPoints(landmarks as SkeletonLandmark[]);
  if (!points) return undefined;
  const [
    nose,
    leftShoulder,
    rightShoulder,
    leftElbow,
    rightElbow,
    leftWrist,
    rightWrist,
    leftHip,
    rightHip,
  ] = points;
  const bodyPoints = points.slice(1);
  const pairwiseDistances = bodyPoints.flatMap((left, leftIndex) =>
    bodyPoints.slice(leftIndex + 1).map((right) => pointDistance(left, right)),
  );
  const hipCenter = midpoint(leftHip, rightHip);
  const relations: number[] = [
    ...pairwiseDistances,
    jointCosine(leftShoulder, leftElbow, leftWrist),
    jointCosine(rightShoulder, rightElbow, rightWrist),
    jointCosine(leftHip, leftShoulder, leftElbow),
    jointCosine(rightHip, rightShoulder, rightElbow),
    ...unitVector(leftShoulder, leftElbow),
    ...unitVector(leftElbow, leftWrist),
    ...unitVector(rightShoulder, rightElbow),
    ...unitVector(rightElbow, rightWrist),
    leftWrist.x,
    leftWrist.y,
    leftWrist.z ?? 0,
    rightWrist.x,
    rightWrist.y,
    rightWrist.z ?? 0,
    nose.x,
    nose.y,
    ...unitVector(hipCenter, midpoint(leftShoulder, rightShoulder)),
  ];
  return relations;
}

function handRelations(
  landmarks: SkeletonLandmark[] | undefined,
): number[] | undefined {
  if (!landmarks || landmarks.length < 21) return undefined;
  const hand = normalizeHandPoints(landmarks);
  if (!hand) return undefined;
  const fingertips = [4, 8, 12, 16, 20].map((index) => hand[index]);
  const fingerChains = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11, 12],
    [13, 14, 15, 16],
    [17, 18, 19, 20],
  ];
  return [
    ...fingerChains.flatMap((chain) => [
      jointCosine(hand[chain[0]], hand[chain[1]], hand[chain[2]]),
      jointCosine(hand[chain[1]], hand[chain[2]], hand[chain[3]]),
    ]),
    ...fingertips.flatMap((left, leftIndex) =>
      fingertips
        .slice(leftIndex + 1)
        .map((right) => pointDistance(left, right)),
    ),
    ...fingertips.map((tip) => pointDistance(hand[0], tip)),
    ...fingertips.flatMap((tip) => unitVector(hand[0], tip)),
  ];
}

function normalizeBodyPoints(
  points: SkeletonLandmark[],
): SkeletonLandmark[] | undefined {
  const leftShoulder = points[1];
  const rightShoulder = points[2];
  const center = midpoint(leftShoulder, rightShoulder);
  const scale = pointDistance(leftShoulder, rightShoulder);
  if (scale < 0.01) return undefined;
  const angle = Math.atan2(
    rightShoulder.y - leftShoulder.y,
    rightShoulder.x - leftShoulder.x,
  );
  return points.map((point) => rotateAndScale(point, center, angle, scale));
}

function normalizeHandPoints(
  points: SkeletonLandmark[],
): SkeletonLandmark[] | undefined {
  const wrist = points[0];
  const middleMcp = points[9];
  const scale = pointDistance(wrist, middleMcp);
  if (scale < 0.005) return undefined;
  const angle = Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x);
  return points
    .slice(0, 21)
    .map((point) => rotateAndScale(point, wrist, angle, scale));
}

function rotateAndScale(
  point: SkeletonLandmark,
  origin: SkeletonLandmark,
  angle: number,
  scale: number,
): SkeletonLandmark {
  const deltaX = point.x - origin.x;
  const deltaY = point.y - origin.y;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return {
    x: (deltaX * cosine + deltaY * sine) / scale,
    y: (-deltaX * sine + deltaY * cosine) / scale,
    z: ((point.z ?? 0) - (origin.z ?? 0)) / scale,
  };
}

function sampleVectors(vectors: number[][], count: number): number[][] {
  if (vectors.length <= count) return vectors;
  return Array.from({ length: count }, (_, index) => {
    const position = (index * (vectors.length - 1)) / (count - 1);
    return vectors[Math.round(position)];
  });
}

function numericVectorDistance(left: number[], right: number[]): number {
  const count = Math.min(left.length, right.length);
  if (count === 0) return Number.POSITIVE_INFINITY;
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const difference = Math.max(-4, Math.min(4, left[index] - right[index]));
    total += difference * difference;
  }
  return Math.sqrt(total / count);
}

function pointDistance(
  left: Pick<SkeletonLandmark, 'x' | 'y' | 'z'>,
  right: Pick<SkeletonLandmark, 'x' | 'y' | 'z'>,
): number {
  return Math.sqrt(
    (left.x - right.x) ** 2 +
      (left.y - right.y) ** 2 +
      ((left.z ?? 0) - (right.z ?? 0)) ** 2,
  );
}

function midpoint(
  left: Pick<SkeletonLandmark, 'x' | 'y' | 'z'>,
  right: Pick<SkeletonLandmark, 'x' | 'y' | 'z'>,
): SkeletonLandmark {
  return {
    x: (left.x + right.x) / 2,
    y: (left.y + right.y) / 2,
    z: ((left.z ?? 0) + (right.z ?? 0)) / 2,
  };
}

function unitVector(
  start: Pick<SkeletonLandmark, 'x' | 'y' | 'z'>,
  end: Pick<SkeletonLandmark, 'x' | 'y' | 'z'>,
): [number, number, number] {
  const length = pointDistance(start, end);
  if (length < 1e-6) return [0, 0, 0];
  return [
    (end.x - start.x) / length,
    (end.y - start.y) / length,
    ((end.z ?? 0) - (start.z ?? 0)) / length,
  ];
}

function jointCosine(
  start: Pick<SkeletonLandmark, 'x' | 'y' | 'z'>,
  vertex: Pick<SkeletonLandmark, 'x' | 'y' | 'z'>,
  end: Pick<SkeletonLandmark, 'x' | 'y' | 'z'>,
): number {
  const left = unitVector(vertex, start);
  const right = unitVector(vertex, end);
  return Math.min(
    1,
    Math.max(-1, left[0] * right[0] + left[1] * right[1] + left[2] * right[2]),
  );
}

function verificationBenchmark(cases: EvaluationCase[], labels: string[]) {
  const byClass = labels.map((label) => {
    const positiveScores = cases
      .filter((item) => item.trueLabel === label)
      .map((item) => item.scores[label]);
    const negativeScores = cases
      .filter((item) => item.trueLabel !== label)
      .map((item) => item.scores[label]);
    return {
      datasetId: label,
      referenceVideos: 10,
      positiveTrials: positiveScores.length,
      negativeControlTrials: negativeScores.length,
      rocAuc: round(auc(positiveScores, negativeScores)),
      equalErrorRate: round(equalErrorRate(positiveScores, negativeScores)),
      recommendedThreshold: recommendThreshold(
        positiveScores,
        negativeScores,
        0.05,
      ),
      positiveScore: distribution(positiveScores),
      negativeScore: distribution(negativeScores),
      positiveScores,
      negativeScores,
    };
  });
  return {
    top1: classificationMetrics(cases, labels),
    macro: {
      rocAuc: average(byClass.map((item) => item.rocAuc)),
      equalErrorRate: average(byClass.map((item) => item.equalErrorRate)),
      truePositiveRateAtFivePercentFpr: average(
        byClass.map((item) => item.recommendedThreshold.truePositiveRate),
      ),
      observedFalsePositiveRate: average(
        byClass.map((item) => item.recommendedThreshold.falsePositiveRate),
      ),
    },
    perClass: byClass,
  };
}

function classificationMetrics(cases: EvaluationCase[], labels: string[]) {
  const confusionMatrix = Object.fromEntries(
    labels.map((trueLabel) => [
      trueLabel,
      Object.fromEntries(labels.map((predictedLabel) => [predictedLabel, 0])),
    ]),
  ) as Record<string, Record<string, number>>;
  for (const item of cases) {
    confusionMatrix[item.trueLabel][item.predictedLabel] += 1;
  }
  const perClass = labels.map((datasetId) => {
    const classCases = cases.filter((item) => item.trueLabel === datasetId);
    const correct = classCases.filter((item) => item.correct).length;
    return {
      datasetId,
      correct,
      total: classCases.length,
      accuracy: ratio(correct, classCases.length),
      errors: classCases
        .filter((item) => !item.correct)
        .map((item) => ({
          sampleId: item.sampleId,
          predictedLabel: item.predictedLabel,
          genuineScore: item.genuineScore,
          strongestImpostorScore: item.strongestImpostorScore,
          margin: item.margin,
        })),
    };
  });
  const correct = cases.filter((item) => item.correct).length;
  return {
    correct,
    total: cases.length,
    accuracy: ratio(correct, cases.length),
    perClass,
    confusionMatrix,
  };
}

function diagnoseTrainingClasses(
  datasets: SkeletonVideoDataset[],
  benchmark: ReturnType<typeof verificationBenchmark>,
  targetIds: string[],
) {
  return targetIds.map((datasetId) => {
    const dataset = datasets.find((item) => item.datasetId === datasetId);
    if (!dataset) throw new Error(`Missing diagnostic dataset: ${datasetId}`);
    const classMetrics = benchmark.perClass.find(
      (item) => item.datasetId === datasetId,
    );
    if (!classMetrics) {
      throw new Error(`Missing benchmark metrics: ${datasetId}`);
    }
    const threshold = classMetrics.recommendedThreshold.threshold;
    const videos = dataset.videos
      .map((video) => {
        const otherVideos = dataset.videos.filter(
          (candidate) => candidate.videoId !== video.videoId,
        );
        const neighborScores = otherVideos
          .map((candidate) => ({
            videoId: candidate.videoId,
            score: round(
              temporalRelationalTemplateScore(candidate.frames, video.frames)
                .overall,
            ),
          }))
          .sort((left, right) => right.score - left.score);
        const trainIncludedScore = aggregateTemporalTemplateScore(
          dataset.videos,
          video.frames,
        );
        const leaveOneOutScore = aggregateTemporalTemplateScore(
          otherVideos,
          video.frames,
        );
        return {
          videoId: video.videoId,
          durationSeconds: round(video.durationMs / 1000),
          frames: video.frames.length,
          poseCoverage: framePartCoverage(video.frames, 'pose'),
          leftHandCoverage: framePartCoverage(video.frames, 'leftHand'),
          rightHandCoverage: framePartCoverage(video.frames, 'rightHand'),
          bothHandsCoverage: framePartCoverage(video.frames, 'bothHands'),
          directSelfScore: round(
            temporalRelationalTemplateScore(video.frames, video.frames).overall,
          ),
          trainIncludedScore,
          leaveOneOutScore,
          selfInclusionGap: round(trainIncludedScore - leaveOneOutScore),
          passesLeaveOneOutThreshold: leaveOneOutScore >= threshold,
          threeClosestOtherVideos: neighborScores.slice(0, 3),
        };
      })
      .sort((left, right) => left.leaveOneOutScore - right.leaveOneOutScore);

    const hardestNegativeControls = datasets
      .filter((item) => item.datasetId !== datasetId)
      .flatMap((negativeDataset) =>
        negativeDataset.videos.map((video) => ({
          datasetId: negativeDataset.datasetId,
          videoId: video.videoId,
          score: aggregateTemporalTemplateScore(dataset.videos, video.frames),
          durationSeconds: round(video.durationMs / 1000),
        })),
      )
      .sort((left, right) => right.score - left.score)
      .slice(0, 8);
    const durations = videos.map((video) => video.durationSeconds);
    const includedScores = videos.map((video) => video.trainIncludedScore);
    const leaveOneOutScores = videos.map((video) => video.leaveOneOutScore);

    return {
      datasetId,
      threshold,
      summary: {
        meanTrainIncludedScore: average(includedScores),
        meanLeaveOneOutScore: average(leaveOneOutScores),
        meanSelfInclusionGap: average(
          videos.map((video) => video.selfInclusionGap),
        ),
        durationSeconds: distribution(durations),
        belowThresholdVideos: videos
          .filter((video) => !video.passesLeaveOneOutThreshold)
          .map((video) => video.videoId),
      },
      videos,
      hardestNegativeControls,
    };
  });
}

function aggregateTemporalTemplateScore(
  templates: SkeletonVideo[],
  observationFrames: SkeletonFrame[],
): number {
  const scores = templates
    .map(
      (template) =>
        temporalRelationalTemplateScore(template.frames, observationFrames)
          .overall,
    )
    .sort((left, right) => right - left)
    .slice(0, 3);
  return average(scores);
}

function framePartCoverage(
  frames: SkeletonFrame[],
  part: 'pose' | 'leftHand' | 'rightHand' | 'bothHands',
): number {
  const detected = frames.filter((frame) => {
    if (part === 'pose') return frame.pose.length >= 33;
    if (part === 'leftHand') return (frame.leftHand?.length ?? 0) >= 21;
    if (part === 'rightHand') return (frame.rightHand?.length ?? 0) >= 21;
    return (
      (frame.leftHand?.length ?? 0) >= 21 &&
      (frame.rightHand?.length ?? 0) >= 21
    );
  }).length;
  return ratio(detected, frames.length);
}

function makePack(
  dataset: SkeletonVideoDataset,
  videos: SkeletonVideo[],
): MotionTemplatePack {
  const templates: MotionReferenceTemplate[] = videos.map((video) => ({
    templateId: `${dataset.datasetId}:${video.videoId}`,
    sourceVideoId: video.sourceFile,
    mirrored: dataset.extraction.mirrored,
    referenceRole: video.sequence === 1 ? 'primary' : 'generalization',
    frames: video.frames,
  }));
  const expectedDurationMs =
    videos.reduce((sum, video) => sum + video.durationMs, 0) /
    Math.max(1, videos.length);
  return {
    schemaVersion: 'motion-template-pack-v1',
    danceId: 'dataset-benchmark',
    motionId: dataset.datasetId,
    motionName: dataset.title,
    instruction: `Perform ${dataset.title}`,
    expectedDurationMs,
    requiredParts:
      dataset.datasetId === 'fade' ? ['left_hand', 'right_hand'] : ['pose'],
    evaluationPolicy: {
      primaryTemplateWeight: 0.7,
      generalizationTemplateCount: 3,
      scoringProfile:
        dataset.datasetId === 'fade' ? 'hands-position-temporal' : 'balanced',
    },
    templates,
  };
}

function datasetQuality(dataset: SkeletonVideoDataset): DatasetQuality {
  const frames = dataset.videos.flatMap((video) => video.frames);
  const frameCount = frames.length;
  const durationMs = dataset.videos.reduce(
    (sum, video) => sum + video.durationMs,
    0,
  );
  return {
    datasetId: dataset.datasetId,
    videos: dataset.videos.length,
    frames: frameCount,
    durationSeconds: round(durationMs / 1000),
    meanDurationSeconds: round(durationMs / dataset.videos.length / 1000),
    poseCoverage: ratio(
      frames.filter((frame) => frame.pose.length >= 33).length,
      frameCount,
    ),
    leftHandCoverage: ratio(
      frames.filter((frame) => (frame.leftHand?.length ?? 0) >= 21).length,
      frameCount,
    ),
    rightHandCoverage: ratio(
      frames.filter((frame) => (frame.rightHand?.length ?? 0) >= 21).length,
      frameCount,
    ),
    bothHandsCoverage: ratio(
      frames.filter(
        (frame) =>
          (frame.leftHand?.length ?? 0) >= 21 &&
          (frame.rightHand?.length ?? 0) >= 21,
      ).length,
      frameCount,
    ),
  };
}

function recommendThreshold(
  positives: number[],
  negatives: number[],
  maximumFalsePositiveRate: number,
): ThresholdMetrics {
  const candidates = thresholdCandidates(positives, negatives)
    .map((threshold) => thresholdMetrics(positives, negatives, threshold))
    .filter((metrics) => metrics.falsePositiveRate <= maximumFalsePositiveRate)
    .sort(
      (left, right) =>
        right.truePositiveRate - left.truePositiveRate ||
        right.balancedAccuracy - left.balancedAccuracy ||
        left.threshold - right.threshold,
    );
  return (
    candidates[0] ??
    thresholdMetrics(positives, negatives, Math.max(...negatives) + 0.001)
  );
}

function thresholdCandidates(
  positives: number[],
  negatives: number[],
): number[] {
  const values = [...new Set([...positives, ...negatives])].sort(
    (left, right) => left - right,
  );
  return [
    0,
    ...values,
    ...values
      .slice(0, -1)
      .map((value, index) => round((value + values[index + 1]) / 2, 6)),
    1.001,
  ];
}

function thresholdMetrics(
  positives: number[],
  negatives: number[],
  threshold: number,
): ThresholdMetrics {
  const positiveAccepted = positives.filter(
    (score) => score >= threshold,
  ).length;
  const negativeAccepted = negatives.filter(
    (score) => score >= threshold,
  ).length;
  const truePositiveRate = ratio(positiveAccepted, positives.length);
  const falsePositiveRate = ratio(negativeAccepted, negatives.length);
  const precision = ratio(
    positiveAccepted,
    positiveAccepted + negativeAccepted,
  );
  return {
    threshold: round(threshold),
    truePositiveRate,
    falseNegativeRate: round(1 - truePositiveRate),
    falsePositiveRate,
    trueNegativeRate: round(1 - falsePositiveRate),
    balancedAccuracy: round((truePositiveRate + (1 - falsePositiveRate)) / 2),
    precision,
    positiveAccepted,
    positiveTotal: positives.length,
    negativeAccepted,
    negativeTotal: negatives.length,
  };
}

function equalErrorRate(positives: number[], negatives: number[]): number {
  return thresholdCandidates(positives, negatives)
    .map((threshold) => thresholdMetrics(positives, negatives, threshold))
    .sort(
      (left, right) =>
        Math.abs(left.falseNegativeRate - left.falsePositiveRate) -
        Math.abs(right.falseNegativeRate - right.falsePositiveRate),
    )
    .map(
      (metrics) => (metrics.falseNegativeRate + metrics.falsePositiveRate) / 2,
    )[0];
}

function auc(positives: number[], negatives: number[]): number {
  let wins = 0;
  for (const positive of positives) {
    for (const negative of negatives) {
      if (positive > negative) wins += 1;
      else if (positive === negative) wins += 0.5;
    }
  }
  return wins / Math.max(1, positives.length * negatives.length);
}

function distribution(values: number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    count: sorted.length,
    min: round(sorted[0] ?? 0),
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    mean: average(sorted),
    p75: quantile(sorted, 0.75),
    max: round(sorted.at(-1) ?? 0),
  };
}

function quantile(sorted: number[], probability: number): number {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * probability;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return round(
    sorted[lower] +
      (sorted[Math.min(lower + 1, sorted.length - 1)] - sorted[lower]) *
        fraction,
  );
}

function average(values: number[]): number {
  return values.length === 0
    ? 0
    : round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function optionalAverage(
  values: Array<number | undefined>,
): number | undefined {
  const available = values.filter(
    (value): value is number => value !== undefined,
  );
  return available.length === 0 ? undefined : average(available);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : round(numerator / denominator);
}

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

void main();
