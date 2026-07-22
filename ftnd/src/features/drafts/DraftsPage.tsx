'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import VideoLibraryRoundedIcon from '@mui/icons-material/VideoLibraryRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import { deleteDraft, listDrafts } from './draft-store';
import type { DanceDraft } from './types';

function DraftVideo({ draft }: { draft: DanceDraft }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const url = useMemo(() => URL.createObjectURL(draft.video), [draft.video]);

  useEffect(
    () => () => {
      videoRef.current?.pause();
      videoRef.current?.removeAttribute('src');
      videoRef.current?.load();
      URL.revokeObjectURL(url);
    },
    [url],
  );

  return (
    <video
      ref={videoRef}
      src={url}
      controls
      playsInline
      preload="none"
    />
  );
}

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<DanceDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    listDrafts()
      .then(setDrafts)
      .catch(() => setError('无法读取本地草稿，请检查浏览器存储权限。'))
      .finally(() => setLoading(false));
  }, []);

  const downloadDraft = (draft: DanceDraft) => {
    const url = URL.createObjectURL(draft.video);
    const anchor = document.createElement('a');
    const extension = draft.mimeType.includes('mp4') ? 'mp4' : 'webm';
    anchor.href = url;
    anchor.download = `${draft.title}-${draft.createdAt.slice(0, 10)}.${extension}`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const removeDraft = async (id: string) => {
    try {
      await deleteDraft(id);
      setDrafts((current) => current.filter((draft) => draft.id !== id));
    } catch {
      setError('删除草稿失败，请稍后重试。');
    }
  };

  return (
    <Stack spacing={3.5}>
      <Box>
        <Chip label="LOCAL DRAFTS" color="primary" size="small" variant="outlined" />
        <Typography component="h1" variant="h3" fontWeight={950} mt={1.5}>
          草稿箱
        </Typography>
      </Box>

      {error && <Alert severity="error">{error}</Alert>}

      <Paper className="feature-panel" elevation={0}>
        {loading ? (
          <Box className="center-state">
            <CircularProgress />
          </Box>
        ) : drafts.length === 0 ? (
          <Box className="empty-state">
            <Box className="empty-state-icon">
              <VideoLibraryRoundedIcon />
            </Box>
            <Typography variant="h5" fontWeight={900}>
              还没有录制草稿
            </Typography>
          </Box>
        ) : (
          <Box className="draft-grid">
            {drafts.map((draft) => (
              <Card key={draft.id} className="draft-card">
                <Box className="draft-video">
                  <DraftVideo draft={draft} />
                </Box>
                <CardContent>
                  <Typography variant="h6" fontWeight={900}>
                    {draft.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary" mt={0.5}>
                    {new Intl.DateTimeFormat('zh-CN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(draft.createdAt))}
                  </Typography>
                  <Stack direction="row" spacing={1} mt={2}>
                    <Button
                      variant="contained"
                      startIcon={<DownloadRoundedIcon />}
                      onClick={() => downloadDraft(draft)}
                      fullWidth
                    >
                      下载到本地
                    </Button>
                    <Button
                      variant="outlined"
                      color="secondary"
                      aria-label={`删除 ${draft.title}`}
                      onClick={() => removeDraft(draft.id)}
                    >
                      <DeleteOutlineRoundedIcon />
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            ))}
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
