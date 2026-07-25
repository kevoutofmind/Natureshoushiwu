import { Box, Chip, Stack } from '@mui/material';
import type { CuratedMotion } from '../motion-breakdown-api';

interface MotionBreakdownOverlayProps {
  motions: CuratedMotion[];
  currentTimeMs: number;
}

export default function MotionBreakdownOverlay({
  motions,
  currentTimeMs,
}: MotionBreakdownOverlayProps) {
  if (!motions.length) return null;

  const currentMotionIndex = motions.findIndex(
    (motion) =>
      currentTimeMs >= motion.startMs && currentTimeMs < motion.endMs,
  );

  return (
    <Box
      aria-label="动作拆解"
      sx={{
        position: 'absolute',
        top: 10,
        left: 10,
        right: 10,
        zIndex: 4,
        pointerEvents: 'none',
        p: 0.75,
        borderRadius: 2,
        bgcolor: 'rgba(5, 5, 7, 0.78)',
        border: '1px solid rgba(255,255,255,.16)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <Stack direction="row" alignItems="center" gap={0.6} flexWrap="wrap">
        {motions.map((motion, index) => {
          const isCurrent = index === currentMotionIndex;
          const isCompleted = currentTimeMs >= motion.endMs;
          return (
            <Chip
              key={motion.motionId}
              size="small"
              label={motion.label}
              color={isCurrent ? 'secondary' : 'default'}
              variant={isCompleted ? 'outlined' : 'filled'}
              sx={{
                height: 25,
                maxWidth: '100%',
                opacity: isCompleted && !isCurrent ? 0.68 : 1,
                '& .MuiChip-label': {
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontSize: '0.69rem',
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
