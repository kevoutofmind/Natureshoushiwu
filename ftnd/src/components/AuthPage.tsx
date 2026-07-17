'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import AlternateEmailRoundedIcon from '@mui/icons-material/AlternateEmailRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import VisibilityOffRoundedIcon from '@mui/icons-material/VisibilityOffRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Paper,
  Stack,
  Tab,
  Tabs,
  TextField,
  ThemeProvider,
  Typography,
  createTheme,
} from '@mui/material';
import {
  readSession,
  saveSession,
  submitCredentials,
} from '@/lib/auth';
import { useRouter } from 'next/navigation';

type Mode = 'login' | 'signup';
type FieldErrors = Partial<Record<'email' | 'password', string>>;

const TIKTOK_PINK = '#FE2C55';
const TIKTOK_AQUA = '#25F4EE';
const emailPattern =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/;
const passwordCharacters = /^[\x21-\x7E]+$/;
const passwordComposition = /^(?=.*[A-Za-z])(?=.*\d).+$/;

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {};
  const normalizedEmail = email.trim();

  if (!normalizedEmail) {
    errors.email = '请输入电子邮箱。';
  } else if (!emailPattern.test(normalizedEmail)) {
    errors.email = '邮箱格式不正确，例如 name@example.com。';
  } else if (normalizedEmail.length > 254) {
    errors.email = '电子邮箱不能超过 254 个字符。';
  }

  if (!password) {
    errors.password = '请输入密码。';
  } else if (!passwordCharacters.test(password)) {
    errors.password = '密码只能包含英文字母、数字和英文符号，不能包含空格。';
  } else if (password.length > 72) {
    errors.password = '密码不能超过 72 个字符。';
  } else if (!passwordComposition.test(password)) {
    errors.password = '密码至少需要包含 1 个字母和 1 个数字。';
  }

  return errors;
}

export default function AuthPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState<{
    severity: 'success' | 'error';
    message: string;
  } | null>(null);
  useEffect(() => {
    if (readSession()) router.replace('/popular');
  }, [router]);

  const theme = useMemo(
    () =>
      createTheme({
        palette: {
          mode: 'dark',
          primary: {
            main: TIKTOK_PINK,
            contrastText: '#FFFFFF',
          },
          secondary: {
            main: TIKTOK_AQUA,
            contrastText: '#000000',
          },
          background: {
            default: '#000000',
            paper: '#0B0B0F',
          },
          text: {
            primary: '#FFFFFF',
            secondary: '#A8A8B3',
          },
          error: { main: '#FE2C55' },
          success: { main: '#25F4EE' },
        },
        shape: { borderRadius: 14 },
        typography: {
          fontFamily:
            '"Segoe UI Variable Text", "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei UI", sans-serif',
          button: {
            textTransform: 'none',
            fontWeight: 800,
          },
        },
        components: {
          MuiTextField: {
            defaultProps: {
              variant: 'outlined',
              fullWidth: true,
            },
          },
          MuiOutlinedInput: {
            styleOverrides: {
              root: {
                backgroundColor: '#141419',
                transition:
                  'border-color 160ms ease, box-shadow 160ms ease, background 160ms ease',
                '&:hover': {
                  backgroundColor: '#19191F',
                },
              },
              notchedOutline: {
                borderColor: 'rgba(255,255,255,.16)',
              },
            },
          },
          MuiButton: {
            styleOverrides: {
              root: {
                minHeight: 50,
                borderRadius: 12,
              },
            },
          },
        },
      }),
    [],
  );

  const changeMode = (nextMode: Mode) => {
    setMode(nextMode);
    setFieldErrors({});
    setNotice(null);
    setPassword('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const clientErrors = validate(email, password);
    setFieldErrors(clientErrors);
    setNotice(null);

    if (Object.keys(clientErrors).length > 0) return;

    setSubmitting(true);
    const result = await submitCredentials(mode, {
      email: email.trim().toLowerCase(),
      password,
    });
    setSubmitting(false);

    if (!result.success || !result.data) {
      setFieldErrors(result.fieldErrors ?? {});
      setNotice({ severity: 'error', message: result.message });
      return;
    }

    saveSession(result.data);
    setPassword('');
    setNotice({ severity: 'success', message: result.message });
    window.setTimeout(() => router.replace('/popular'), 550);
  };

  return (
    <ThemeProvider theme={theme}>
      <Box component="main" className="auth-shell">
        <Box className="glow glow-pink" />
        <Box className="glow glow-aqua" />
        <Box className="noise-grid" />

        <Box className="auth-layout">
          <Stack className="brand-panel" justifyContent="space-between">
            <Box>
              <Stack direction="row" alignItems="center" spacing={1.5}>
                <Box className="glitch-mark" aria-hidden="true">
                  <span>AI</span>
                </Box>
                <Box>
                  <Typography className="brand-overline">TIKTOK AI LAB</Typography>
                  <Typography className="brand-name">MOVE / MATCH</Typography>
                </Box>
              </Stack>

              <Box mt={{ xs: 6, md: 11 }}>
                <Chip
                  label="MULTIMODAL EXPERIENCE"
                  size="small"
                  className="signal-chip"
                />
                <Typography component="h1" className="glitch-title" data-text="SYNC">
                  SYNC
                </Typography>
                <Typography className="brand-copy">
                  让视觉理解动作，
                  <br />
                  让声音控制节奏。
                </Typography>
              </Box>
            </Box>

          </Stack>

          <Paper className="auth-card" elevation={0}>
            <Stack spacing={3}>
                <Box>
                  <Typography className="card-kicker">
                    {mode === 'login' ? 'WELCOME BACK' : 'CREATE IDENTITY'}
                  </Typography>
                  <Typography variant="h3" fontWeight={900} mt={0.8}>
                    {mode === 'login' ? '登录账号' : '创建账号'}
                  </Typography>
                </Box>

                <Tabs
                  value={mode}
                  onChange={(_, value: Mode) => changeMode(value)}
                  variant="fullWidth"
                  aria-label="登录和注册"
                  className="auth-tabs"
                >
                  <Tab value="login" label="登录" />
                  <Tab value="signup" label="注册" />
                </Tabs>

                {notice && (
                  <Alert
                    severity={notice.severity}
                    variant="outlined"
                    className="auth-alert"
                  >
                    {notice.message}
                  </Alert>
                )}

                <Box component="form" noValidate onSubmit={handleSubmit}>
                  <Stack spacing={2.2}>
                    <TextField
                      id="auth-email"
                      label="电子邮箱"
                      type="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        setFieldErrors((current) => ({
                          ...current,
                          email: undefined,
                        }));
                      }}
                      error={Boolean(fieldErrors.email)}
                      helperText={fieldErrors.email}
                      required
                      autoComplete="email"
                      inputProps={{ maxLength: 254 }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <AlternateEmailRoundedIcon fontSize="small" />
                          </InputAdornment>
                        ),
                      }}
                    />

                    <TextField
                      id="auth-password"
                      label="密码"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value);
                        setFieldErrors((current) => ({
                          ...current,
                          password: undefined,
                        }));
                      }}
                      error={Boolean(fieldErrors.password)}
                      helperText={
                        fieldErrors.password
                      }
                      required
                      autoComplete={
                        mode === 'login' ? 'current-password' : 'new-password'
                      }
                      inputProps={{ maxLength: 72 }}
                      InputProps={{
                        startAdornment: (
                          <InputAdornment position="start">
                            <LockRoundedIcon fontSize="small" />
                          </InputAdornment>
                        ),
                        endAdornment: (
                          <InputAdornment position="end">
                            <IconButton
                              aria-label={showPassword ? '隐藏密码' : '显示密码'}
                              onClick={() =>
                                setShowPassword((visible) => !visible)
                              }
                              edge="end"
                            >
                              {showPassword ? (
                                <VisibilityOffRoundedIcon />
                              ) : (
                                <VisibilityRoundedIcon />
                              )}
                            </IconButton>
                          </InputAdornment>
                        ),
                      }}
                    />

                    <Button
                      type="submit"
                      variant="contained"
                      color="primary"
                      disabled={submitting}
                      endIcon={
                        submitting ? undefined : <ArrowForwardRoundedIcon />
                      }
                      className="submit-button"
                    >
                      {submitting ? (
                        <CircularProgress size={23} color="inherit" />
                      ) : mode === 'login' ? (
                        '进入系统'
                      ) : (
                        '创建账号'
                      )}
                    </Button>
                  </Stack>
                </Box>

            </Stack>
          </Paper>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
