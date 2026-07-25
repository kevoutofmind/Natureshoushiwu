"use client";

import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import ExpandMoreRoundedIcon from "@mui/icons-material/ExpandMoreRounded";
import { useState } from "react";
import { Box, ButtonBase, Stack, Typography } from "@mui/material";
import {
  RECORDING_EFFECTS,
  type BeautySettings,
  type RecordingEffectId,
} from "../recording-effects";

export function RecordingEffectsPicker({
  value,
  onChange,
  beauty,
  onBeautyChange,
}: {
  value: RecordingEffectId;
  onChange: (effect: RecordingEffectId) => void;
  beauty: BeautySettings;
  onBeautyChange: (key: keyof BeautySettings, value: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const beautyControls: Array<{ key: keyof BeautySettings; label: string }> = [
    { key: "faceSlim", label: "瘦脸" },
    { key: "eyeEnlarge", label: "大眼" },
  ];

  return (
    <Box
      className={`recording-effects-picker${expanded ? " is-open" : " is-collapsed"}`}
    >
      <ButtonBase
        className="recording-effects-toggle"
        onClick={() => setExpanded((current) => !current)}
        aria-expanded={expanded}
        aria-controls="recording-effects-panel"
        aria-label={expanded ? "收起美颜特效" : "展开美颜特效"}
      >
        <AutoAwesomeRoundedIcon />
        <ExpandMoreRoundedIcon className="recording-effects-chevron" />
      </ButtonBase>

      {expanded && (
        <Box id="recording-effects-panel" className="recording-effects-panel">
          <Stack direction="row" alignItems="center" gap={0.5}>
            <AutoAwesomeRoundedIcon fontSize="small" />
            <Typography variant="caption" fontWeight={800}>
              录制特效 · 本地即时渲染
            </Typography>
          </Stack>
          <Box className="beauty-controls" aria-label="本地美颜调节">
            {beautyControls.map((control) => (
              <Box component="label" key={control.key} className="beauty-control">
                <Typography variant="caption">{control.label}</Typography>
                <input
                  aria-label={control.label}
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={beauty[control.key]}
                  onChange={(event) =>
                    onBeautyChange(control.key, Number(event.target.value))
                  }
                />
              </Box>
            ))}
          </Box>
          <Box className="recording-effects-list" role="list" aria-label="录制特效">
            {RECORDING_EFFECTS.slice(0, 3).map((effect) => {
              const selected = effect.id === value;
              return (
                <Box key={effect.id} role="listitem">
                  <ButtonBase
                    className={`recording-effect-option${selected ? " is-selected" : ""}`}
                    onClick={() => onChange(effect.id)}
                    aria-pressed={selected}
                    aria-label={`${effect.label}：${effect.description}`}
                  >
                    <Box
                      className="recording-effect-swatch"
                      sx={{ background: effect.swatch }}
                    />
                    <Typography variant="caption" fontWeight={selected ? 800 : 650}>
                      {effect.label}
                    </Typography>
                  </ButtonBase>
                </Box>
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
}
