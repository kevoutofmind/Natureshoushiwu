"use client";

import {
  Box,
  Chip,
  Divider,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import type { RealtimeJudgeFeedback } from "../contracts/teaching-runtime";

interface SimilarityEngineeringDialogProps {
  open: boolean;
  judge?: RealtimeJudgeFeedback;
}

const decisionLabels: Record<RealtimeJudgeFeedback["decision"], string> = {
  ACCEPT: "通过",
  ACCEPT_HINT: "提示后通过",
  RETRY: "需要重试",
  KEEP_WATCHING: "采集中",
  NOT_VISIBLE: "骨架不可见",
};

const decisionColors: Record<
  RealtimeJudgeFeedback["decision"],
  "success" | "warning" | "error" | "info" | "default"
> = {
  ACCEPT: "success",
  ACCEPT_HINT: "warning",
  RETRY: "error",
  KEEP_WATCHING: "info",
  NOT_VISIBLE: "default",
};

const scoreDefinitions = [
  ["overall", "总相似度"],
  ["actionCoverage", "关键动作覆盖率"],
  ["pose", "身体姿态"],
  ["leftHand", "左手动作"],
  ["rightHand", "右手动作"],
  ["trajectory", "连续运动轨迹"],
  ["keyframeTrajectory", "关键帧轨迹"],
  ["visibility", "骨架可见度"],
] as const;

function percentage(score: number | undefined): string {
  return score === undefined ? "—" : `${Math.round(score * 100)}%`;
}

export function SimilarityEngineeringDialog({
  open,
  judge,
}: SimilarityEngineeringDialogProps) {
  if (!open) return null;

  return (
    <Paper
      role="status"
      aria-live="polite"
      aria-label="当前动作整体相似度"
      elevation={12}
      sx={{
        position: "fixed",
        top: { xs: 76, md: 92 },
        right: { xs: 12, md: 24 },
        zIndex: (theme) => theme.zIndex.tooltip + 1,
        width: { xs: "calc(100vw - 24px)", sm: 420 },
        maxHeight: "calc(100vh - 116px)",
        overflowY: "auto",
        p: 2,
        color: "#fff",
        backgroundColor: "rgba(10, 13, 20, 0.7)",
        border: "1px solid rgba(255, 255, 255, 0.2)",
        backdropFilter: "blur(10px)",
        pointerEvents: "none",
      }}
    >
      <Typography variant="h6" fontWeight={900}>
        当前动作整体相似度
      </Typography>

      {!judge ? (
        <Box sx={{ py: 3, textAlign: "center" }}>
          <Typography fontWeight={800}>等待完整动作数据</Typography>
          <Typography sx={{ mt: 1, color: "rgba(255,255,255,0.7)" }}>
            完整做完当前动作后，系统统一计算一次整体相似度。
          </Typography>
        </Box>
      ) : (
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
            gap={1}
          >
            <Box>
              <Typography variant="h3" fontWeight={900}>
                {percentage(judge.scores.overall)}
              </Typography>
              <Typography sx={{ color: "rgba(255,255,255,0.7)" }}>
                当前动作：{judge.motionId}
              </Typography>
            </Box>
            <Chip
              label={decisionLabels[judge.decision]}
              color={decisionColors[judge.decision]}
              size="small"
            />
          </Stack>

          <Divider sx={{ borderColor: "rgba(255,255,255,0.16)" }} />

          <Stack spacing={1.1}>
            {scoreDefinitions.map(([key, label]) => {
              const score = judge.scores[key];
              return (
                <Box key={key}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2">{label}</Typography>
                    <Typography variant="body2" fontWeight={800}>
                      {percentage(score)}
                    </Typography>
                  </Stack>
                  <LinearProgress
                    variant="determinate"
                    value={Math.max(0, Math.min(100, (score ?? 0) * 100))}
                    color={
                      score === undefined
                        ? "inherit"
                        : score >= 0.78
                          ? "success"
                          : score >= 0.55
                            ? "warning"
                            : "error"
                    }
                    sx={{
                      mt: 0.4,
                      backgroundColor: "rgba(255,255,255,0.14)",
                    }}
                  />
                </Box>
              );
            })}
          </Stack>

          <Divider sx={{ borderColor: "rgba(255,255,255,0.16)" }} />

          <Box>
            <Typography variant="body2">
              最接近模板：{judge.bestTemplateId ?? "尚未确定"}
            </Typography>
            <Typography variant="body2">
              最弱部分：{judge.weakestPart ?? "无"}
            </Typography>
            <Typography variant="body2">
              参考模板数：{judge.metadata.referenceCount} · 本地计算耗时：
              {judge.metadata.latencyMs} ms
            </Typography>
          </Box>
        </Stack>
      )}
    </Paper>
  );
}
