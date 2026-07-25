'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import PauseCircleOutlineRoundedIcon from '@mui/icons-material/PauseCircleOutlineRounded';
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useRouter } from 'next/navigation';
import { getPopularDances } from './api';
import type { PopularDance } from './types';

export default function PopularDancesPage() {
  const router = useRouter();
  const [items, setItems] = useState<PopularDance[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeFullPreviewId, setActiveFullPreviewId] = useState<string | null>(null);
  const previewVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const previewPlaybackModes = useRef<
    Record<string, 'ambient' | 'full' | 'paused' | undefined>
  >({});

  useEffect(() => {
    getPopularDances()
      .then((response) => setItems(response.data.items))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : '舞蹈列表加载失败。'),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    items.forEach((dance) => {
      const video = previewVideoRefs.current[dance.id];
      if (!video || previewPlaybackModes.current[dance.id] === 'paused') return;

      previewPlaybackModes.current[dance.id] = 'ambient';
      video.loop = true;
      video.muted = true;
      void video.play().catch(() => undefined);
    });
  }, [items]);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      `${item.displayTitle ?? ''} ${item.title} ${item.creator ?? ''}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [items, query]);

  const openTeaching = (dance: PopularDance) => {
    const parameters = new URLSearchParams({
      danceId: dance.runtimeDanceId ?? dance.id,
      selectedDanceId: dance.id,
      danceTitle: dance.title,
      onboarding: '1',
    });
    router.push(`/teaching?${parameters.toString()}`);
  };

  const playPreview = (dance: PopularDance) => {
    const video = previewVideoRefs.current[dance.id];
    if (!video) return;

    const previousMode = previewPlaybackModes.current[dance.id];

    if (previousMode === 'full' && !video.paused) {
      video.pause();
      video.muted = true;
      previewPlaybackModes.current[dance.id] = 'paused';
      setActiveFullPreviewId(null);
      return;
    }

    previewPlaybackModes.current[dance.id] = 'full';
    setActiveFullPreviewId(dance.id);

    if (previousMode === 'paused') {
      video.loop = false;
      video.muted = false;
      video.volume = 0.85;
      void video.play().catch(() =>
        setError('视频无法播放，请确认浏览器允许播放声音。'),
      );
      return;
    }

    video.loop = false;
    video.currentTime = 0;
    video.muted = false;
    video.volume = 0.85;
    void video.play().catch(() =>
      setError('视频无法播放，请确认浏览器允许播放声音。'),
    );
  };

  const resetFullPreview = (dance: PopularDance) => {
    const video = previewVideoRefs.current[dance.id];
    if (!video) return;

    previewPlaybackModes.current[dance.id] = 'ambient';
    setActiveFullPreviewId(null);
    video.currentTime = 0;
    video.muted = true;
    video.loop = true;
    void video.play().catch(() => undefined);
  };

  return (
    <Stack spacing={3.5}>
      <Box>
        <Chip label="CHOOSE YOUR DANCE" color="primary" size="small" variant="outlined" />
        <Typography component="h1" variant="h3" fontWeight={950} mt={1.5}>
          挑一支顺眼的，今天就拿下
        </Typography>
        <Typography color="text.secondary" mt={1}>
          Lumi 负责把动作掰开揉碎，你负责跟着比划，手势舞这不就搞起来了。
        </Typography>
      </Box>

      <Box className="popular-feed">
        <TextField
          size="small"
          placeholder="搜索手势舞、风格或难度"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          sx={{ maxWidth: 430 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchRoundedIcon />
              </InputAdornment>
            ),
          }}
        />

        {error && (
          <Alert severity="error" sx={{ mt: 3 }}>
            {error}
          </Alert>
        )}

        {loading ? (
          <Box className="center-state">
            <CircularProgress />
          </Box>
        ) : filteredItems.length === 0 ? (
          <Box className="empty-state popular-empty-state">
            <Typography variant="h5" fontWeight={900}>
              没有找到匹配的手势舞
            </Typography>
            <Typography color="text.secondary">换一个关键词试试吧。</Typography>
          </Box>
        ) : (
          <Box className="dance-grid">
            {filteredItems.map((dance, index) => (
              <Card key={dance.id} className="dance-card">
                <Box
                  className="dance-cover"
                  sx={{ background: dance.coverGradient }}
                >
                  {dance.coverUrl && (
                    <video
                      ref={(node) => {
                        previewVideoRefs.current[dance.id] = node;
                      }}
                      className="dance-cover-video"
                      src={dance.coverUrl}
                      muted
                      playsInline
                      preload="metadata"
                      onEnded={() => resetFullPreview(dance)}
                      aria-hidden="true"
                    />
                  )}
                  <Box className="dance-cover-content">
                    <Typography className="dance-cover-index">
                      {String(index + 1).padStart(2, '0')}
                    </Typography>
                    <IconButton
                      className="dance-preview-button"
                      onClick={() => playPreview(dance)}
                      aria-label={`播放${dance.title}原视频`}
                    >
                      {activeFullPreviewId === dance.id ? (
                        <PauseCircleOutlineRoundedIcon />
                      ) : (
                        <PlayCircleOutlineRoundedIcon />
                      )}
                    </IconButton>
                    <Typography fontWeight={950}>{dance.title}</Typography>
                  </Box>
                </Box>
                <CardContent>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Box className="dance-card-copy">
                      <Typography
                        className="dance-card-title"
                        variant="h6"
                        fontWeight={900}
                        title={dance.displayTitle ?? dance.title}
                      >
                        {dance.displayTitle ?? dance.title}
                      </Typography>
                      <Typography
                        className="dance-card-creator"
                        variant="body2"
                        color="text.secondary"
                      >
                        {dance.creator}
                      </Typography>
                    </Box>
                    <IconButton
                      className="dance-teaching-button"
                      onClick={() => openTeaching(dance)}
                      aria-label={`进入${dance.title}的 AI 教学`}
                    >
                      <ArrowForwardRoundedIcon />
                    </IconButton>
                  </Stack>
                  <Stack direction="row" spacing={1} mt={1.5}>
                    {dance.durationSeconds !== undefined && (
                      <Chip label={`${dance.durationSeconds} 秒`} size="small" variant="outlined" />
                    )}
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </Box>
    </Stack>
  );
}
