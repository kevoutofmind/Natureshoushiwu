import type { GeometryMeasurement, SkeletonSnapshot, VisionLandmark } from './vision-types';

const P = { ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24 } as const;
const mid = (a: VisionLandmark, b: VisionLandmark): VisionLandmark => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const distance = (a: VisionLandmark, b: VisionLandmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const confidence = (points: VisionLandmark[]) => points.reduce((sum, p) => sum + (p.visibility ?? p.presence ?? 1), 0) / points.length;
function angle(a: VisionLandmark, b: VisionLandmark, c: VisionLandmark) {
  const u = [a.x - b.x, a.y - b.y, a.z - b.z];
  const v = [c.x - b.x, c.y - b.y, c.z - b.z];
  const divisor = Math.hypot(...u) * Math.hypot(...v);
  const cosine = divisor ? Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / divisor)) : 1;
  return Math.acos(cosine) * 180 / Math.PI;
}
function extract(s: SkeletonSnapshot) {
  const p = s.pose;
  if (p.length < 25) return null;
  const shoulder = mid(p[P.ls], p[P.rs]);
  const hip = mid(p[P.lh], p[P.rh]);
  const scale = Math.max(distance(p[P.ls], p[P.rs]), 0.0001);
  return {
    leftElbow: angle(p[P.ls], p[P.le], p[P.lw]), rightElbow: angle(p[P.rs], p[P.re], p[P.rw]),
    leftWrist: (shoulder.y - p[P.lw].y) / scale, rightWrist: (shoulder.y - p[P.rw].y) / scale,
    torso: Math.atan2(hip.x - shoulder.x, hip.y - shoulder.y) * 180 / Math.PI,
    quality: confidence([p[P.ls], p[P.rs], p[P.le], p[P.re], p[P.lw], p[P.rw], p[P.lh], p[P.rh]]),
  };
}
export function compareGeometry(reference: SkeletonSnapshot, practice: SkeletonSnapshot): GeometryMeasurement[] {
  const a = extract(reference); const b = extract(practice); if (!a || !b) return [];
  const q = Math.min(a.quality, b.quality);
  const rows: Array<[string, 'degree' | 'shoulder_width', number, number]> = [
    ['left_elbow_angle', 'degree', a.leftElbow, b.leftElbow], ['right_elbow_angle', 'degree', a.rightElbow, b.rightElbow],
    ['left_wrist_height', 'shoulder_width', a.leftWrist, b.leftWrist], ['right_wrist_height', 'shoulder_width', a.rightWrist, b.rightWrist],
    ['torso_lean', 'degree', a.torso, b.torso],
  ];
  return rows.map(([name, unit, referenceValue, practiceValue]) => ({ name, unit, referenceValue: +referenceValue.toFixed(3), practiceValue: +practiceValue.toFixed(3), delta: +(practiceValue - referenceValue).toFixed(3), reliability: +q.toFixed(3) }));
}
export const averageVisibility = (points: VisionLandmark[]) => points.length ? +(confidence(points).toFixed(3)) : 0;
const LEFT_RIGHT_POSE_PAIRS = [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26], [27, 28], [29, 30], [31, 32]] as const;
const flip = (points: VisionLandmark[]) => points.map((point) => ({ ...point, x: 1 - point.x }));
export function mirrorSkeleton(snapshot: SkeletonSnapshot): SkeletonSnapshot {
  const pose = flip(snapshot.pose);
  for (const [left, right] of LEFT_RIGHT_POSE_PAIRS) {
    if (pose[left] && pose[right]) [pose[left], pose[right]] = [pose[right], pose[left]];
  }
  return { ...snapshot, pose, leftHand: flip(snapshot.rightHand), rightHand: flip(snapshot.leftHand) };
}