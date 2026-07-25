"use client";

import { useMemo } from "react";
import ArrowForwardRoundedIcon from "@mui/icons-material/ArrowForwardRounded";
import AutoAwesomeRoundedIcon from "@mui/icons-material/AutoAwesomeRounded";
import PlayArrowRoundedIcon from "@mui/icons-material/PlayArrowRounded";
import {
  Box,
  Button,
  Chip,
  Paper,
  Stack,
  ThemeProvider,
  Typography,
  createTheme,
} from "@mui/material";
import { saveSession } from "@/lib/auth";
import { useRouter } from "next/navigation";

const TIKTOK_PINK = "#FE2C55";
const TIKTOK_AQUA = "#25F4EE";
const LOCAL_DEMO_ACCESS_TOKEN = "local-demo-session";

export default function AuthPage() {
  const router = useRouter();
  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: "dark",
          primary: { main: TIKTOK_PINK, contrastText: "#FFFFFF" },
          secondary: { main: TIKTOK_AQUA, contrastText: "#000000" },
          background: { default: "#000000", paper: "#0B0B0F" },
          text: { primary: "#FFFFFF", secondary: "#A8A8B3" },
        },
        shape: { borderRadius: 14 },
        typography: {
          fontFamily:
            '"Segoe UI Variable Text", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif',
          button: { textTransform: "none", fontWeight: 800 },
        },
      }),
    [],
  );

  const enterLumi = () => {
    saveSession({
      accessToken: LOCAL_DEMO_ACCESS_TOKEN,
      user: {
        id: "local-demo-user",
        email: "体验用户",
        createdAt: new Date().toISOString(),
      },
    });
    router.replace("/popular");
  };

  return (
    <ThemeProvider theme={theme}>
      <Box component="main" className="auth-shell lumi-welcome-shell">
        <Box className="glow glow-pink" />
        <Box className="glow glow-aqua" />
        <Box className="noise-grid" />
        <Box className="auth-layout">
          <Stack className="brand-panel" justifyContent="space-between">
            <Box>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Box className="glitch-mark" aria-hidden="true"><span>AI</span></Box>
                <Typography className="brand-overline">TIKTOK AI LAB</Typography>
              </Stack>
              <Box mt={{ xs: 6, md: 11 }}>
                <Chip label="MULTIMODAL DANCE AGENT" size="small" className="signal-chip" />
                <Typography component="h1" className="glitch-title" data-text="LUMI">LUMI</Typography>
                <Typography className="brand-copy lumi-welcome-copy">
                  Lumi：下一代懂抖音用户的 VLM Agent
                </Typography>
              </Box>
            </Box>
          </Stack>

          <Paper className="auth-card lumi-welcome-card" elevation={0}>
            <Stack spacing={3}>
              <Box>
                <Typography className="card-kicker">LUMI / DANCE AGENT</Typography>
                <Typography variant="h3" fontWeight={900} mt={0.8}>
                  什么叫
                  <br />
                  我觉醒的系统只能教手势舞
                </Typography>
              </Box>
              <Stack className="lumi-welcome-manifesto" spacing={1.6}>
                <Stack direction="row" spacing={1.2} alignItems="flex-start">
                  <AutoAwesomeRoundedIcon color="secondary" />
                  <Typography className="lumi-welcome-manifesto-copy">
                    nature 拒我多模态，
                    <br />
                    手势舞教学搞起来
                  </Typography>
                </Stack>
                <Box className="lumi-beat-track" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                  <span />
                </Box>
              </Stack>
              <Button
                variant="contained"
                color="secondary"
                onClick={enterLumi}
                startIcon={<PlayArrowRoundedIcon />}
                endIcon={<ArrowForwardRoundedIcon />}
                className="submit-button"
              >
                进入系统
              </Button>
            </Stack>
          </Paper>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
