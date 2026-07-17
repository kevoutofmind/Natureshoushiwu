'use client';

import { ReactNode, useEffect, useState } from 'react';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import BoltRoundedIcon from '@mui/icons-material/BoltRounded';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import VideoLibraryRoundedIcon from '@mui/icons-material/VideoLibraryRounded';
import {
  AppBar,
  Avatar,
  Box,
  CircularProgress,
  Container,
  IconButton,
  Stack,
  Tab,
  Tabs,
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
} from '@mui/material';
import { usePathname, useRouter } from 'next/navigation';
import { clearSession, readSession, type AuthSession } from '@/lib/auth';
import { workspaceTheme } from '@/theme/workspace-theme';

const navigation = [
  {
    label: '热门手势舞选择',
    path: '/popular',
    icon: <BoltRoundedIcon fontSize="small" />,
  },
  {
    label: 'AI教学',
    path: '/teaching',
    icon: <AutoAwesomeRoundedIcon fontSize="small" />,
  },
  {
    label: '草稿箱',
    path: '/drafts',
    icon: <VideoLibraryRoundedIcon fontSize="small" />,
  },
];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedSession = readSession();
      if (!storedSession) {
        router.replace('/login');
        return;
      }
      setSession(storedSession);
      setChecked(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [router]);

  const currentTab =
    navigation.find((item) => pathname.startsWith(item.path))?.path ??
    '/popular';
  const isTeachingPage = pathname.startsWith('/teaching');
  const isPopularPage = pathname.startsWith('/popular');

  const handleLogout = () => {
    clearSession();
    router.replace('/login');
  };

  if (!checked || !session) {
    return (
      <ThemeProvider theme={workspaceTheme}>
        <Box className="workspace-loading">
          <CircularProgress color="primary" />
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={workspaceTheme}>
      <Box
        className={`workspace-shell${isTeachingPage ? ' teaching-workspace-shell' : ''}${isPopularPage ? ' popular-workspace-shell' : ''}`}
      >
        <AppBar position="sticky" elevation={0} className="workspace-appbar">
          <Container maxWidth="xl">
            <Toolbar disableGutters className="workspace-toolbar">
              <Stack
                direction="row"
                alignItems="center"
                spacing={1.4}
                className="workspace-brand"
              >
                <Box className="workspace-logo">AI</Box>
                <Box>
                  <Typography fontWeight={950} lineHeight={1}>
                    MOVE / MATCH
                  </Typography>
                  <Typography
                    variant="caption"
                    color="primary"
                    fontWeight={850}
                    letterSpacing=".12em"
                  >
                    DANCE STUDIO
                  </Typography>
                </Box>
              </Stack>

              <Tabs
                value={currentTab}
                onChange={(_, value: string) => router.push(value)}
                variant="scrollable"
                scrollButtons="auto"
                className="workspace-tabs"
                aria-label="主功能导航"
              >
                {navigation.map((item) => (
                  <Tab
                    key={item.path}
                    value={item.path}
                    label={item.label}
                    icon={item.icon}
                    iconPosition="start"
                  />
                ))}
              </Tabs>

              <Stack
                direction="row"
                alignItems="center"
                spacing={1}
                className="account-area"
              >
                <Avatar sx={{ width: 34, height: 34, bgcolor: 'secondary.main' }}>
                  {session.user.email.charAt(0).toUpperCase()}
                </Avatar>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  className="account-email"
                >
                  {session.user.email}
                </Typography>
                <Tooltip title="退出登录">
                  <IconButton onClick={handleLogout} aria-label="退出登录">
                    <LogoutRoundedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
            </Toolbar>
          </Container>
        </AppBar>

        <Container
          component="main"
          maxWidth="xl"
          className={`workspace-main${isTeachingPage ? ' workspace-main-teaching' : ''}`}
        >
          {children}
        </Container>
      </Box>
    </ThemeProvider>
  );
}
