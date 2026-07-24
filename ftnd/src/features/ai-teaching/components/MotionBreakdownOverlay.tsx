import { Box, Chip, Stack, Typography } from "@mui/material";
import type { MotionSemanticBreakdown } from "@/features/video-stage/reference-dataset.types";

interface MotionSummary {
  motionId: string;
  semantic?: MotionSemanticBreakdown;
}

interface MotionBreakdownOverlayProps {
  motions: MotionSummary[];
  currentMotionIndex: number;
  completedMotionCount: number;
}

/**
 * Renders inside the practice phone screen. It stays hidden until the
 * reference-video analysis returns real semantic labels, never placeholders.
 */
export default function MotionBreakdownOverlay({
  motions,
  currentMotionIndex,
  completedMotionCount,
}: MotionBreakdownOverlayProps) {
  if (!motions.some((motion) => motion.semantic?.label.trim())) return null;

  return (
    <Box
      aria-label="原手势舞动作拆解"
      sx={{
        position: "absolute",
        top: 10,
        left: 10,
        right: 10,
        zIndex: 4,
        pointerEvents: "none",
        p: 0.75,
        borderRadius: 2,
        bgcolor: "rgba(5, 5, 7, 0.78)",
        border: "1px solid rgba(255,255,255,.16)",
        backdropFilter: "blur(8px)",
      }}
    >
      <Stack direction="row" alignItems="center" gap={0.6} flexWrap="wrap">
        <Typography
          component="span"
          sx={{ fontSize: "0.68rem", fontWeight: 900, color: "#25F4EE" }}
        >
          动作拆解
        </Typography>
        {motions.map((motion, index) => {
          const label = motion.semantic?.label?.trim();
          if (!label) return null;
          const isCurrent = index === currentMotionIndex;
          const isCompleted = index < completedMotionCount;

          return (
            <Chip
              key={motion.motionId}
              size="small"
              label={`${index + 1}. ${label}`}
              color={isCurrent ? "secondary" : "default"}
              variant={isCompleted ? "outlined" : "filled"}
              sx={{
                height: 25,
                maxWidth: "100%",
                opacity: isCompleted && !isCurrent ? 0.68 : 1,
                "& .MuiChip-label": {
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  fontSize: "0.69rem",
                  fontWeight: 800,
                },
              }}
            />
          );
        })}
      </Stack>
    </Box>
  );
}
