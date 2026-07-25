"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import styles from "./SkeletonEditor.module.css";

interface Landmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

type JointPart = "pose" | "leftHand" | "rightHand";

interface SkeletonFrame {
  timestampMs: number;
  pose: Landmark[];
  leftHand?: Landmark[];
  rightHand?: Landmark[];
}

interface SkeletonVideo {
  videoId: string;
  sourceFile: string;
  sequence: number;
  durationMs: number;
  width: number;
  height: number;
  frames: SkeletonFrame[];
  [key: string]: unknown;
}

interface SkeletonDataset {
  schemaVersion: "skeleton-video-dataset-v1";
  datasetId: string;
  title: string;
  videos: SkeletonVideo[];
  [key: string]: unknown;
}

interface DatasetSummary {
  datasetId: string;
  title: string;
  videoCount: number;
  primaryVideo: {
    videoId: string;
    durationMs: number;
    width: number;
    height: number;
    frameCount: number;
  };
}

interface SelectedJoint {
  part: JointPart;
  index: number;
}

interface PointChange {
  frameIndex: number;
  part: JointPart;
  jointIndex: number;
  point: Landmark;
}

interface EditAction {
  label: string;
  before: PointChange[];
  after: PointChange[];
}

interface DragState {
  part: JointPart;
  jointIndex: number;
  jointCount: number;
  keyFrameIndex: number;
  keyStart: Landmark;
  before: PointChange[];
  after: PointChange[];
  moved: boolean;
}

const DATASET_VIDEO: Record<string, string> = {
  cat: "/dances/dance-001/reference.mp4",
  cloud: "/dances/dance-002/reference.mp4",
  fade: "/dances/dance-003/reference.mp4",
  fight: "/dances/dance-004/reference.mp4",
  indo: "/dances/dance-005/reference.mp4",
  no: "/dances/dance-006/reference.mp4",
};

const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 7],
  [0, 4],
  [4, 5],
  [5, 6],
  [6, 8],
  [9, 10],
  [11, 12],
  [11, 13],
  [13, 15],
  [15, 17],
  [15, 19],
  [15, 21],
  [17, 19],
  [12, 14],
  [14, 16],
  [16, 18],
  [16, 20],
  [16, 22],
  [18, 20],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [24, 26],
  [25, 27],
  [26, 28],
  [27, 29],
  [28, 30],
  [29, 31],
  [30, 32],
  [27, 31],
  [28, 32],
];

const HAND_CONNECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

const PART_STYLE: Record<
  JointPart,
  {
    color: string;
    label: string;
    connections: ReadonlyArray<readonly [number, number]>;
  }
> = {
  pose: { color: "#35e6ff", label: "身体", connections: POSE_CONNECTIONS },
  leftHand: { color: "#ff4d85", label: "左手", connections: HAND_CONNECTIONS },
  rightHand: { color: "#ffe066", label: "右手", connections: HAND_CONNECTIONS },
};

const POSE_NAMES = [
  "鼻子",
  "左眼内侧",
  "左眼",
  "左眼外侧",
  "右眼内侧",
  "右眼",
  "右眼外侧",
  "左耳",
  "右耳",
  "嘴左侧",
  "嘴右侧",
  "左肩",
  "右肩",
  "左肘",
  "右肘",
  "左腕",
  "右腕",
  "左小指",
  "右小指",
  "左食指",
  "右食指",
  "左拇指",
  "右拇指",
  "左髋",
  "右髋",
  "左膝",
  "右膝",
  "左踝",
  "右踝",
  "左脚跟",
  "右脚跟",
  "左脚尖",
  "右脚尖",
];

function clonePoint(point: Landmark): Landmark {
  return { ...point };
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function getPart(frame: SkeletonFrame, part: JointPart): Landmark[] {
  return frame[part] ?? [];
}

function closestFrameIndex(frames: SkeletonFrame[], timestampMs: number) {
  if (frames.length === 0) return 0;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (frames[middle].timestampMs < timestampMs) low = middle + 1;
    else high = middle;
  }
  if (
    low > 0 &&
    Math.abs(frames[low - 1].timestampMs - timestampMs) <
      Math.abs(frames[low].timestampMs - timestampMs)
  ) {
    return low - 1;
  }
  return low;
}

function jointLabel(joint: SelectedJoint | null) {
  if (!joint) return "尚未选择关节";
  if (joint.part === "pose") {
    return `${PART_STYLE.pose.label} · ${POSE_NAMES[joint.index] ?? `节点 ${joint.index}`}`;
  }
  return `${PART_STYLE[joint.part].label} · 节点 ${joint.index}`;
}

function sameJoint(left: SelectedJoint, right: SelectedJoint) {
  return left.part === right.part && left.index === right.index;
}

export function SkeletonEditor() {
  const [summaries, setSummaries] = useState<DatasetSummary[]>([]);
  const [datasetId, setDatasetId] = useState("cat");
  const [dataset, setDataset] = useState<SkeletonDataset | null>(null);
  const [savedDataset, setSavedDataset] = useState<SkeletonDataset | null>(
    null,
  );
  const [frameIndex, setFrameIndex] = useState(0);
  const [selectedJoints, setSelectedJoints] = useState<SelectedJoint[]>([]);
  const [radius, setRadius] = useState(8);
  const [strength, setStrength] = useState(0.65);
  const [history, setHistory] = useState<EditAction[]>([]);
  const [redoHistory, setRedoHistory] = useState<EditAction[]>([]);
  const [dirty, setDirty] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [status, setStatus] = useState("正在读取数据集…");
  const [saving, setSaving] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const datasetRef = useRef<SkeletonDataset | null>(null);
  const dragRef = useRef<DragState | null>(null);

  const primaryVideo = useMemo(
    () =>
      dataset?.videos.find((video) => video.sequence === 1) ??
      dataset?.videos[0] ??
      null,
    [dataset],
  );
  const frame = primaryVideo?.frames[frameIndex] ?? null;

  useEffect(() => {
    datasetRef.current = dataset;
  }, [dataset]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/skeleton-editor/datasets", { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json()) as {
          datasets?: DatasetSummary[];
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "读取数据集列表失败。");
        if (!cancelled) setSummaries(body.datasets ?? []);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus(
            error instanceof Error ? error.message : "读取数据集列表失败。",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch(
      `/api/skeleton-editor/datasets/${encodeURIComponent(datasetId)}`,
      {
        cache: "no-store",
      },
    )
      .then(async (response) => {
        const body = (await response.json()) as SkeletonDataset & {
          error?: string;
        };
        if (!response.ok) throw new Error(body.error ?? "读取数据集失败。");
        if (cancelled) return;
        setDataset(body);
        setSavedDataset(structuredClone(body));
        setFrameIndex(0);
        setStatus("拖动骨架节点即可修正；松开鼠标后会生成一条可撤销操作。");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setStatus(
            error instanceof Error ? error.message : "读取数据集失败。",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [datasetId]);

  const changeDataset = (nextDatasetId: string) => {
    setStatus(`正在加载 ${nextDatasetId} 的第 1 个示例素材…`);
    setDataset(null);
    setSelectedJoints([]);
    setHistory([]);
    setRedoHistory([]);
    setDirty(false);
    setPlaying(false);
    videoRef.current?.pause();
    setDatasetId(nextDatasetId);
  };

  const applyChanges = useCallback((changes: PointChange[]) => {
    if (changes.length === 0) return;
    setDataset((current) => {
      if (!current) return current;
      const videoIndex = current.videos.findIndex(
        (video) => video.sequence === 1,
      );
      if (videoIndex < 0) return current;
      const videos = [...current.videos];
      const video = {
        ...videos[videoIndex],
        frames: [...videos[videoIndex].frames],
      };
      videos[videoIndex] = video;

      const byFrame = new Map<number, PointChange[]>();
      for (const change of changes) {
        const list = byFrame.get(change.frameIndex) ?? [];
        list.push(change);
        byFrame.set(change.frameIndex, list);
      }
      for (const [changedFrameIndex, frameChanges] of byFrame) {
        const oldFrame = video.frames[changedFrameIndex];
        if (!oldFrame) continue;
        const nextFrame: SkeletonFrame = { ...oldFrame };
        for (const [part, partChanges] of Object.entries(
          Object.groupBy(frameChanges, (change) => change.part),
        ) as Array<[JointPart, PointChange[]]>) {
          if (!partChanges) continue;
          const points = [...getPart(nextFrame, part)];
          for (const change of partChanges) {
            points[change.jointIndex] = clonePoint(change.point);
          }
          nextFrame[part] = points;
        }
        video.frames[changedFrameIndex] = nextFrame;
      }
      return { ...current, videos };
    });
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const rect = canvas.getBoundingClientRect();
    const pixelRatio = window.devicePixelRatio || 1;
    const targetWidth = Math.max(1, Math.round(rect.width * pixelRatio));
    const targetHeight = Math.max(1, Math.round(rect.height * pixelRatio));
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    if (!frame) return;

    for (const part of ["pose", "leftHand", "rightHand"] as JointPart[]) {
      const points = getPart(frame, part);
      const partStyle = PART_STYLE[part];
      context.strokeStyle = partStyle.color;
      context.fillStyle = partStyle.color;
      context.lineWidth = part === "pose" ? 2.2 : 1.6;
      context.globalAlpha = part === "pose" ? 0.95 : 0.9;
      for (const [start, end] of partStyle.connections) {
        const a = points[start];
        const b = points[end];
        if (!a || !b) continue;
        context.beginPath();
        context.moveTo(a.x * rect.width, a.y * rect.height);
        context.lineTo(b.x * rect.width, b.y * rect.height);
        context.stroke();
      }
      for (let index = 0; index < points.length; index += 1) {
        const point = points[index];
        const selected = selectedJoints.some(
          (joint) => joint.part === part && joint.index === index,
        );
        context.beginPath();
        context.arc(
          point.x * rect.width,
          point.y * rect.height,
          selected ? 7 : part === "pose" ? 4 : 3,
          0,
          Math.PI * 2,
        );
        context.fill();
        if (selected) {
          context.strokeStyle = "#ffffff";
          context.lineWidth = 2;
          context.stroke();
        }
      }
    }
    context.globalAlpha = 1;
  }, [frame, selectedJoints]);

  useEffect(() => {
    draw();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [draw]);

  const syncFromVideo = useCallback(() => {
    const video = videoRef.current;
    if (!video || !primaryVideo) return;
    setFrameIndex(
      closestFrameIndex(
        primaryVideo.frames,
        Math.round(video.currentTime * 1000),
      ),
    );
  }, [primaryVideo]);

  const seekFrame = useCallback(
    (nextIndex: number) => {
      if (!primaryVideo) return;
      const safeIndex = Math.min(
        primaryVideo.frames.length - 1,
        Math.max(0, nextIndex),
      );
      setFrameIndex(safeIndex);
      if (videoRef.current) {
        videoRef.current.currentTime =
          primaryVideo.frames[safeIndex].timestampMs / 1000;
      }
    },
    [primaryVideo],
  );

  const pointerPosition = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      normalizedX: clamp((event.clientX - rect.left) / rect.width),
      normalizedY: clamp((event.clientY - rect.top) / rect.height),
      pixelX: event.clientX - rect.left,
      pixelY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!frame || !primaryVideo) return;
    const position = pointerPosition(event);
    let nearest:
      { part: JointPart; index: number; distance: number } | undefined;
    for (const part of ["pose", "leftHand", "rightHand"] as JointPart[]) {
      getPart(frame, part).forEach((point, index) => {
        const distance = Math.hypot(
          point.x * position.width - position.pixelX,
          point.y * position.height - position.pixelY,
        );
        if (!nearest || distance < nearest.distance) {
          nearest = { part, index, distance };
        }
      });
    }
    if (!nearest || nearest.distance > 22) {
      if (!event.shiftKey) setSelectedJoints([]);
      return;
    }

    const joint = nearest as {
      part: JointPart;
      index: number;
      distance: number;
    };
    const clickedJoint = { part: joint.part, index: joint.index };
    const alreadySelected = selectedJoints.some((selected) =>
      sameJoint(selected, clickedJoint),
    );
    if (event.shiftKey) {
      const nextSelection = alreadySelected
        ? selectedJoints.filter(
            (selected) => !sameJoint(selected, clickedJoint),
          )
        : [...selectedJoints, clickedJoint];
      setSelectedJoints(nextSelection);
      setStatus(
        nextSelection.length === 0
          ? "已清空节点选择。"
          : `已选择 ${nextSelection.length} 个节点；拖动其中任意节点可整组移动。`,
      );
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const dragJoints = alreadySelected ? selectedJoints : [clickedJoint];
    if (!alreadySelected) setSelectedJoints(dragJoints);
    const before: PointChange[] = [];
    const from = Math.max(0, frameIndex - radius);
    const to = Math.min(primaryVideo.frames.length - 1, frameIndex + radius);
    for (const selected of dragJoints) {
      for (let index = from; index <= to; index += 1) {
        const point = getPart(primaryVideo.frames[index], selected.part)[
          selected.index
        ];
        if (point) {
          before.push({
            frameIndex: index,
            part: selected.part,
            jointIndex: selected.index,
            point: clonePoint(point),
          });
        }
      }
    }
    const keyStart = getPart(frame, joint.part)[joint.index];
    dragRef.current = {
      part: joint.part,
      jointIndex: joint.index,
      jointCount: dragJoints.length,
      keyFrameIndex: frameIndex,
      keyStart: clonePoint(keyStart),
      before,
      after: before,
      moved: false,
    };
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const position = pointerPosition(event);
    const deltaX = position.normalizedX - drag.keyStart.x;
    const deltaY = position.normalizedY - drag.keyStart.y;
    const after = drag.before.map((change) => {
      const distance = Math.abs(change.frameIndex - drag.keyFrameIndex);
      const falloff =
        distance === 0
          ? 1
          : strength *
            0.5 *
            (1 + Math.cos((Math.PI * distance) / (radius + 1)));
      return {
        ...change,
        point: {
          ...change.point,
          x: clamp(change.point.x + deltaX * falloff),
          y: clamp(change.point.y + deltaY * falloff),
        },
      };
    });
    drag.after = after;
    drag.moved = Math.abs(deltaX) + Math.abs(deltaY) > 0.0001;
    applyChanges(after);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    if (!drag.moved) return;
    const action: EditAction = {
      label:
        drag.jointCount === 1
          ? `${jointLabel({ part: drag.part, index: drag.jointIndex })} · 第 ${drag.keyFrameIndex + 1} 帧`
          : `${drag.jointCount} 个节点 · 第 ${drag.keyFrameIndex + 1} 帧`,
      before: drag.before,
      after: drag.after,
    };
    setHistory((current) => [...current, action]);
    setRedoHistory([]);
    setDirty(true);
    setStatus(
      `已整体移动 ${drag.jointCount} 个节点，并让前后 ${radius} 帧按距离衰减跟随。`,
    );
  };

  const undo = () => {
    const action = history.at(-1);
    if (!action) return;
    applyChanges(action.before);
    setHistory((current) => current.slice(0, -1));
    setRedoHistory((current) => [...current, action]);
    setDirty(history.length > 1);
    setStatus(`已撤销：${action.label}`);
  };

  const redo = () => {
    const action = redoHistory.at(-1);
    if (!action) return;
    applyChanges(action.after);
    setRedoHistory((current) => current.slice(0, -1));
    setHistory((current) => [...current, action]);
    setDirty(true);
    setStatus(`已重做：${action.label}`);
  };

  const resetUnsaved = () => {
    if (!savedDataset) return;
    setDataset(structuredClone(savedDataset));
    setHistory([]);
    setRedoHistory([]);
    setDirty(false);
    setSelectedJoints([]);
    setStatus("已恢复到上一次保存的版本。");
  };

  const save = async () => {
    const current = datasetRef.current;
    if (!current || saving) return;
    setSaving(true);
    setStatus("正在备份原文件并保存修正…");
    try {
      const response = await fetch(
        `/api/skeleton-editor/datasets/${encodeURIComponent(current.datasetId)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(current),
        },
      );
      const result = (await response.json()) as {
        backupFile?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "保存失败。");
      setSavedDataset(structuredClone(current));
      setHistory([]);
      setRedoHistory([]);
      setDirty(false);
      setStatus(`保存成功。原文件已备份到 bknd/data/${result.backupFile}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  };

  const download = () => {
    const current = datasetRef.current;
    if (!current) return;
    const blob = new Blob([`${JSON.stringify(current, null, 2)}\n`], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${current.datasetId}-corrected.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      await video.play();
    } else {
      video.pause();
    }
  };

  const selectPart = (part: JointPart) => {
    if (!frame) return;
    const joints = getPart(frame, part).map((_, index) => ({ part, index }));
    setSelectedJoints(joints);
    setStatus(
      `已一次选择${PART_STYLE[part].label}的 ${joints.length} 个节点；拖动任意一个即可整组移动。`,
    );
  };

  const selectAll = () => {
    if (!frame) return;
    const joints = (["pose", "leftHand", "rightHand"] as JointPart[]).flatMap(
      (part) => getPart(frame, part).map((_, index) => ({ part, index })),
    );
    setSelectedJoints(joints);
    setStatus(`已一次选择全部 ${joints.length} 个节点。`);
  };

  const activeJoint = selectedJoints.at(-1) ?? null;
  const selectedPoint =
    activeJoint && frame && selectedJoints.length === 1
      ? getPart(frame, activeJoint.part)[activeJoint.index]
      : undefined;
  const activeSummary = summaries.find((item) => item.datasetId === datasetId);

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>MEDIAPIPE CORRECTION TOOL</p>
          <h1>示例视频骨架校正</h1>
          <p className={styles.description}>
            每次只编辑当前类别的第 1 个网页示例素材。拖动一个误标节点，
            相邻帧的同一节点会按距离平滑跟随。
          </p>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.secondaryButton}
            onClick={download}
            disabled={!dataset}
          >
            下载 JSON
          </button>
          <button
            className={styles.primaryButton}
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? "保存中…" : "备份并保存"}
          </button>
        </div>
      </header>

      <section className={styles.toolbar} aria-label="编辑设置">
        <label>
          <span>手势舞类别</span>
          <select
            value={datasetId}
            onChange={(event) => changeDataset(event.target.value)}
            disabled={dirty}
            title={dirty ? "请先保存或放弃当前修改" : undefined}
          >
            {(summaries.length > 0
              ? summaries
              : Object.keys(DATASET_VIDEO).map((id) => ({
                  datasetId: id,
                  title: id,
                  videoCount: 10,
                  primaryVideo: {
                    videoId: `${id} (1)`,
                    durationMs: 0,
                    width: 16,
                    height: 9,
                    frameCount: 0,
                  },
                }))
            ).map((item) => (
              <option key={item.datasetId} value={item.datasetId}>
                {item.datasetId} · {item.primaryVideo.videoId}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>邻帧半径：前后 {radius} 帧</span>
          <input
            type="range"
            min="0"
            max="20"
            value={radius}
            onChange={(event) => setRadius(Number(event.target.value))}
          />
        </label>

        <label>
          <span>邻帧跟随强度：{Math.round(strength * 100)}%</span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(strength * 100)}
            onChange={(event) => setStrength(Number(event.target.value) / 100)}
          />
        </label>

        <div className={styles.historyActions}>
          <button onClick={undo} disabled={history.length === 0}>
            撤销
          </button>
          <button onClick={redo} disabled={redoHistory.length === 0}>
            重做
          </button>
          <button onClick={resetUnsaved} disabled={!dirty}>
            放弃未保存修改
          </button>
        </div>
      </section>

      <section className={styles.workspace}>
        <div className={styles.stageColumn}>
          <div
            className={styles.stage}
            style={{
              aspectRatio:
                primaryVideo?.width && primaryVideo?.height
                  ? `${primaryVideo.width} / ${primaryVideo.height}`
                  : "16 / 9",
            }}
          >
            {DATASET_VIDEO[datasetId] ? (
              <video
                key={DATASET_VIDEO[datasetId]}
                ref={videoRef}
                className={styles.video}
                src={DATASET_VIDEO[datasetId]}
                muted
                playsInline
                preload="metadata"
                onTimeUpdate={syncFromVideo}
                onSeeked={syncFromVideo}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
            ) : null}
            <canvas
              ref={canvasRef}
              className={styles.canvas}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              aria-label="可拖动的骨架关键点"
            />
          </div>

          <div className={styles.timeline}>
            <div className={styles.timelineControls}>
              <button
                type="button"
                onClick={() => seekFrame(frameIndex - 1)}
                disabled={!primaryVideo}
              >
                上一帧
              </button>
              <button
                type="button"
                onClick={() => void togglePlayback()}
                disabled={!primaryVideo}
              >
                {playing ? "暂停" : "播放"}
              </button>
              <button
                type="button"
                onClick={() => seekFrame(frameIndex + 1)}
                disabled={!primaryVideo}
              >
                下一帧
              </button>
              <input
                type="range"
                min="0"
                max={Math.max(0, (primaryVideo?.frames.length ?? 1) - 1)}
                value={frameIndex}
                onChange={(event) => seekFrame(Number(event.target.value))}
                disabled={!primaryVideo}
                aria-label="关键帧时间轴"
              />
            </div>
            <div>
              <span>
                第 {frameIndex + 1} / {primaryVideo?.frames.length ?? 0} 帧
              </span>
              <span>
                {frame ? (frame.timestampMs / 1000).toFixed(2) : "0.00"} 秒
              </span>
            </div>
          </div>
        </div>

        <aside className={styles.inspector}>
          <div className={styles.legend}>
            {(
              Object.entries(PART_STYLE) as Array<
                [JointPart, (typeof PART_STYLE)[JointPart]]
              >
            ).map(([part, item]) => (
              <span key={part}>
                <i style={{ background: item.color }} />
                {item.label}
              </span>
            ))}
          </div>

          <div className={styles.selectionCard}>
            <p>多节点选择</p>
            <div className={styles.selectionTools}>
              <button type="button" onClick={() => selectPart("pose")}>
                身体
              </button>
              <button type="button" onClick={() => selectPart("leftHand")}>
                左手
              </button>
              <button type="button" onClick={() => selectPart("rightHand")}>
                右手
              </button>
              <button type="button" onClick={selectAll}>
                全部
              </button>
              <button
                type="button"
                onClick={() => setSelectedJoints([])}
                disabled={selectedJoints.length === 0}
              >
                清空
              </button>
            </div>
            <p className={styles.selectionHint}>
              Shift + 点击可逐个添加或移除；拖动任意已选节点会整组移动。
            </p>
            <h2>
              {selectedJoints.length > 1
                ? `已选择 ${selectedJoints.length} 个节点`
                : jointLabel(activeJoint)}
            </h2>
            {selectedPoint ? (
              <dl>
                <div>
                  <dt>X</dt>
                  <dd>{selectedPoint.x.toFixed(5)}</dd>
                </div>
                <div>
                  <dt>Y</dt>
                  <dd>{selectedPoint.y.toFixed(5)}</dd>
                </div>
                <div>
                  <dt>Z</dt>
                  <dd>{(selectedPoint.z ?? 0).toFixed(5)}</dd>
                </div>
              </dl>
            ) : (
              <p className={styles.muted}>
                {selectedJoints.length > 1
                  ? "整组拖动会保持这些节点之间的相对结构。"
                  : "点击节点进行单选，或使用上方快捷选择。"}
              </p>
            )}
          </div>

          <div className={styles.infoCard}>
            <p>当前数据范围</p>
            <strong>
              {activeSummary?.primaryVideo.videoId ?? `${datasetId} (1)`}
            </strong>
            <span>只修改 {datasetId}.json 中 sequence=1 的素材</span>
            <span>同类其余 9 个素材保持原样，继续用于泛化</span>
          </div>

          <div className={styles.tipCard}>
            <strong>建议操作</strong>
            <ol>
              <li>暂停到 MediaPipe 误标最明显的一帧。</li>
              <li>把错误节点拖回人体真实位置。</li>
              <li>播放前后片段，观察平滑跟随是否自然。</li>
              <li>必要时减小半径或强度，再撤销重做。</li>
            </ol>
          </div>
        </aside>
      </section>

      <footer className={`${styles.status} ${dirty ? styles.dirty : ""}`}>
        <span>{dirty ? "有未保存修改" : "数据已同步"}</span>
        <p>{status}</p>
      </footer>
    </main>
  );
}
