'use client';

import { useEffect, useMemo, useState } from 'react';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import PlayCircleOutlineRoundedIcon from '@mui/icons-material/PlayCircleOutlineRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import {
  Alert,
  Box,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
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

  useEffect(() => {
    getPopularDances()
      .then((response) => setItems(response.data.items))
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : '舞蹈列表加载失败。'),
      )
      .finally(() => setLoading(false));
  }, []);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      `${item.title} ${item.creator ?? ''} ${item.difficulty ?? ''}`
        .toLowerCase()
        .includes(normalized),
    );
  }, [items, query]);

  const openTeaching = (dance: PopularDance) => {
    const parameters = new URLSearchParams({
      danceId: dance.runtimeDanceId ?? dance.id,
      selectedDanceId: dance.id,
      danceTitle: dance.title,
    });
    router.push(`/teaching?${parameters.toString()}`);
  };

  return (
    <Stack spacing={3.5}>
      <Box>
        <Chip label="CHOOSE YOUR DANCE" color="primary" size="small" variant="outlined" />
        <Typography component="h1" variant="h3" fontWeight={950} mt={1.5}>
          选择你想学习的手势舞
        </Typography>
        <Typography color="text.secondary" mt={1}>
          先选一支喜欢的舞蹈，AI 教练会直接带你进入整舞预览和动作拆解。
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
                <CardActionArea
                  onClick={() => openTeaching(dance)}
                  aria-label={`学习${dance.title}`}
                >
                  <Box
                    className="dance-cover"
                    sx={{ background: dance.coverGradient }}
                  >
                    <Box className="dance-cover-content">
                      <Typography className="dance-cover-index">
                        {String(index + 1).padStart(2, '0')}
                      </Typography>
                      <PlayCircleOutlineRoundedIcon />
                      <Typography fontWeight={950}>{dance.title}</Typography>
                    </Box>
                  </Box>
                  <CardContent>
                    <Stack direction="row" alignItems="center" justifyContent="space-between">
                      <Box>
                        <Typography variant="h6" fontWeight={900}>
                          {dance.title}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {dance.creator}
                        </Typography>
                      </Box>
                      <ArrowForwardRoundedIcon color="primary" />
                    </Stack>
                    <Stack direction="row" spacing={1} mt={1.5}>
                      <Chip label={dance.difficulty} size="small" variant="outlined" />
                      <Chip label={`${dance.durationSeconds} 秒`} size="small" variant="outlined" />
                    </Stack>
                  </CardContent>
                </CardActionArea>
              </Card>
            ))}
          </Box>
        )}
      </Box>
    </Stack>
  );
}
