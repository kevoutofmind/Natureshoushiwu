"use client";

import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import { Box, ButtonBase } from "@mui/material";

/**
 * Keep the filter entry in the recording UI while the actual filter pipeline
 * is disabled. This deliberately does not mount any WebGL/canvas renderer.
 */
export function RecordingEffectsPicker() {
  return (
    <Box className="recording-effects-picker is-collapsed">
      <ButtonBase
        className="recording-effects-toggle"
        aria-label="滤镜（当前未启用）"
        title="滤镜（当前未启用）"
      >
        <AutoAwesomeRoundedIcon />
      </ButtonBase>
    </Box>
  );
}
