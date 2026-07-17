'use client';

import { useEffect, useMemo, useState } from 'react';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import FilterAltRoundedIcon from '@mui/icons-material/FilterAltRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import {
  Alert,
  Box,
  Button,
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
        setError(reason instanceof Error ? reason.message : '加载失败。'),
      )
      .finally(() => setLoading(false));
  }, []);

  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      `${item.title} ${item.creator ?? ''}`.toLowerCase().includes(normalized),
    );
  }, [items, query]);

  return (
    <Stack spacing={3.5}>
      <Box>
        <Chip label="DISCOVER" color="primary" size="small" variant="outlined" />
        <Typography component="h1" variant="h3" fontWeight={950} mt={1.5}>
          选择要学习的手势舞
        </Typography>
      </Box>

      <Box className="popular-feed">
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          justifyContent="space-between"
        >
          <TextField
            size="small"
            placeholder="搜索舞蹈、作者或标签"
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
          <Button
            variant="outlined"
            startIcon={<FilterAltRoundedIcon />}
            disabled
          >
            难度 / 时长筛选
          </Button>
        </Stack>

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
            <Box className="empty-state-icon">
              <CloudUploadRoundedIcon />
            </Box>
            <Typography variant="h5" fontWeight={900}>
              暂无热门手势舞数据
            </Typography>
          </Box>
        ) : (
          <Box className="dance-grid">
            {filteredItems.map((dance) => (
              <Card key={dance.id} className="dance-card">
                <CardActionArea
                  onClick={() =>
                    router.push(
                      `/teaching?danceId=${encodeURIComponent(dance.id)}`,
                    )
                  }
                >
                  <Box className="dance-cover">
                    {dance.coverUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={dance.coverUrl} alt="" />
                    ) : (
                      <Typography color="text.secondary">等待封面</Typography>
                    )}
                  </Box>
                  <CardContent>
                    <Typography fontWeight={900}>{dance.title}</Typography>
                    <Stack
                      direction="row"
                      alignItems="center"
                      justifyContent="space-between"
                      mt={1}
                    >
                      <Typography variant="body2" color="text.secondary">
                        {dance.creator ?? '来源待解析'}
                      </Typography>
                      <ArrowForwardRoundedIcon color="primary" />
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
