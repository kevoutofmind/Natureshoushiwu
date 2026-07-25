import type { Metadata } from "next";
import { SkeletonEditor } from "@/features/video-stage/skeleton-editor/SkeletonEditor";

export const metadata: Metadata = {
  title: "示例视频骨架校正",
  description: "手动修正 MediaPipe 关键帧，并平滑传播到相邻帧。",
};

export default function SkeletonEditorPage() {
  return <SkeletonEditor />;
}
