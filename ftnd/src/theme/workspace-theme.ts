'use client';

import { createTheme } from '@mui/material/styles';

export const workspaceTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#25F4EE',
      contrastText: '#000000',
    },
    secondary: {
      main: '#FE2C55',
      contrastText: '#FFFFFF',
    },
    background: {
      default: '#000000',
      paper: '#101014',
    },
    text: {
      primary: '#FFFFFF',
      secondary: '#A8A8B3',
    },
  },
  shape: { borderRadius: 16 },
  typography: {
    fontFamily:
      '"Segoe UI Variable Text", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif',
    button: {
      textTransform: 'none',
      fontWeight: 800,
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          minHeight: 42,
          borderRadius: 11,
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
  },
});
