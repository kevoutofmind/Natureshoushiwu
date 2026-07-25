# Lumi CosyVoice Setup

This branch makes Lumi use CosyVoice by default. After teammates pull the
`AIVoice` branch, they should run the setup below before testing voice output.

## What Gets Installed

- Node dependencies from `bknd/package.json` and `ftnd/package.json`.
- A local Miniconda Python 3.10 runtime under `bknd/.cache/cosyvoice`.
- The official CosyVoice source checkout under `bknd/.cache/cosyvoice/CosyVoice`.
- Python packages from CosyVoice requirements, including ModelScope and runtime
  dependencies.
- CUDA PyTorch `2.3.1+cu121` for Windows, downloaded by the setup script when
  the existing Python env does not already have the expected torch build.
- The `iic/CosyVoice-300M-SFT` model under
  `bknd/.cache/cosyvoice/models/CosyVoice-300M-SFT`.

The `.cache` directory is intentionally ignored by git. Do not commit the model,
the Python environment, or real `.env` secrets.

## One-Time Setup

From the repository root:

```powershell
git switch AIVoice

cd bknd
npm install
Copy-Item .env.example .env
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-cosyvoice.ps1
```

Fill in secrets such as `KIMI_API_KEY` in `bknd\.env`. The CosyVoice defaults in
`.env.example` should stay enabled:

```dotenv
LUMI_TTS_PROVIDER=cosyvoice
COSYVOICE_BASE_URL=http://127.0.0.1:9967
COSYVOICE_MODEL=CosyVoice-300M-SFT
COSYVOICE_VOICE=中文女
COSYVOICE_TIMEOUT_MS=120000
COSYVOICE_FP16=1
COSYVOICE_LOAD_JIT=1
```

## Running Locally

Terminal 1, start CosyVoice:

```powershell
cd bknd
& ".\.cache\cosyvoice\env\python.exe" ".\scripts\cosyvoice-openai-server.py"
```

Wait until the terminal prints that the OpenAI-compatible server is listening on
`http://127.0.0.1:9967`.

Terminal 2, start the backend:

```powershell
cd bknd
npm run start:roadshow
```

Terminal 3, start the frontend:

```powershell
cd ftnd
npm install
npm run dev
```

Open `http://localhost:3000/teaching`. Lumi speech requests go from the frontend
to `POST /api/lumi/voice/synthesize`, then the backend proxies them to the local
CosyVoice server.

## Quick Checks

Check CosyVoice:

```powershell
Invoke-WebRequest -UseBasicParsing http://127.0.0.1:9967/health
```

Check the backend speech route:

```powershell
Invoke-WebRequest `
  -Method POST `
  -Uri http://127.0.0.1:3001/api/lumi/voice/synthesize `
  -ContentType application/json `
  -Body '{"text":"你好，我是 Lumi。"}' `
  -OutFile lumi-test.wav
```

If `lumi-test.wav` plays, the teammate is hearing CosyVoice rather than the
browser speech fallback.

## Notes

- First setup can take a long time because it downloads Python dependencies,
  PyTorch, CosyVoice, and the model.
- GPU is recommended. CPU mode may work but is too slow for the teaching flow.
- If CosyVoice is not running, the frontend eventually falls back to browser
  speech synthesis. For this branch, keep CosyVoice running while testing Lumi.
