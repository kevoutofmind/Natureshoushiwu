import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CenterFocusStrongRoundedIcon from '@mui/icons-material/CenterFocusStrongRounded';
import SlowMotionVideoRoundedIcon from '@mui/icons-material/SlowMotionVideoRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import { Box, Chip, Stack, Typography } from '@mui/material';
import type { VlmReaction } from '../contracts/vlm-teaching-feedback';

interface VlmFeedbackProps {
  actionIndex: number;
  reaction: VlmReaction | null;
}

function getFeedbackCopy(actionIndex: number, reaction: VlmReaction) {
  switch (reaction.kind) {
    case 'NOT_VISIBLE':
      return {
        label: '调整取景',
        text: '请让上半身与双手完整进入取景框。',
      };
    case 'SLOW_REPLAY':
      return {
        label: '慢速示范',
        text: '当前动作将以 0.5 倍重播。',
      };
    case 'ADVANCE':
      return {
        label: `动作 ${actionIndex}`,
        text: '已进入下一动作。',
      };
    case 'KEEP_WATCHING':
      return {
        label: '保持跟练',
        text: '继续跟随当前流程。',
      };
  }
}

export function VlmProgressFeedback({
  actionIndex,
  reaction,
}: VlmFeedbackProps) {
  if (!reaction) return null;

  const feedback = getFeedbackCopy(actionIndex, reaction);
  return (
    <Stack className="vlm-side-feedback" gap={1}>
      <Chip label={feedback.label} size="small" />
      <Typography variant="body2" fontWeight={750}>
        {feedback.text}
      </Typography>
    </Stack>
  );
}

export function VlmCoachFeedback({ actionIndex, reaction }: VlmFeedbackProps) {
  if (!reaction) return null;

  const feedback = getFeedbackCopy(actionIndex, reaction);
  return (
    <Stack className="vlm-side-feedback vlm-coach-feedback" gap={1}>
      <Stack direction="row" alignItems="center" gap={0.75}>
        <VisibilityRoundedIcon fontSize="small" />
        <Typography fontWeight={850}>{feedback.label}</Typography>
      </Stack>
      <Typography variant="body2">{feedback.text}</Typography>
    </Stack>
  );
}

export function VlmStageFeedbackOverlay({
  actionIndex,
  reaction,
  stage,
}: VlmFeedbackProps & { stage: 'reference' | 'camera' }) {
  if (!reaction) return null;

  const isCameraPrompt = reaction.kind === 'NOT_VISIBLE' && stage === 'camera';
  const isSlowReplay = reaction.kind === 'SLOW_REPLAY' && stage === 'reference';
  const isAdvance = reaction.kind === 'ADVANCE' && stage === 'reference';
  if (!isCameraPrompt && !isSlowReplay && !isAdvance) return null;

  if (isCameraPrompt) {
    return (
      <Box className="vlm-stage-overlay vlm-stage-overlay--not-visible">
        <Stack alignItems="center" gap={1}>
          <CenterFocusStrongRoundedIcon />
          <Typography fontWeight={900}>请调整位置</Typography>
          <Typography variant="body2">
            请让上半身与双手完整进入取景框
          </Typography>
        </Stack>
      </Box>
    );
  }

  if (isSlowReplay) {
    return (
      <Box className="vlm-stage-overlay vlm-stage-overlay--slow-replay">
        <Stack alignItems="center" gap={0.75}>
          <SlowMotionVideoRoundedIcon />
          <Typography fontWeight={900}>0.5× 慢速示范</Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box className="vlm-stage-overlay vlm-stage-overlay--advance">
      <Stack direction="row" alignItems="center" gap={0.75}>
        <ArrowForwardRoundedIcon />
        <Typography fontWeight={900}>进入动作 {actionIndex}</Typography>
      </Stack>
    </Box>
  );
}
