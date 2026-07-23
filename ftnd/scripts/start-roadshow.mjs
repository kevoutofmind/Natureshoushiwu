import { spawn } from 'node:child_process';
import { join } from 'node:path';

const nextCli = join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
const child = spawn(process.execPath, [nextCli, 'dev'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT_PUBLIC_ROADSHOW_MODE: 'true',
  },
});

child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}
