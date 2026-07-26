# Local Whisper worker

This folder is the only non-Node runtime required by the voice transcription
feature. It exposes a loopback-only HTTP endpoint consumed by the Nest backend.
Audio never leaves the machine.

## Requirements

- Windows with Python 3.10-3.12
- Approximately 1 GB of free disk space for the `small` model and runtime
- No CUDA requirement; the default is CPU `int8`

## Start

From the backend directory:

```powershell
npm run voice:local
```

The first run creates `.venv`, installs dependencies, and downloads the model.
Later starts reuse both the environment and the model cache.

Health check:

```text
http://127.0.0.1:8765/health
```

## Configuration

The Nest backend selects this worker with:

```dotenv
VOICE_TRANSCRIPTION_PROVIDER=local
LOCAL_WHISPER_URL=http://127.0.0.1:8765/transcribe
LOCAL_WHISPER_TIMEOUT_MS=60000
```

Worker tuning:

```dotenv
LOCAL_WHISPER_MODEL=small
LOCAL_WHISPER_DEVICE=cpu
LOCAL_WHISPER_COMPUTE_TYPE=int8
LOCAL_WHISPER_CPU_THREADS=12
```

The Nest backend sends its `OPENAI_TRANSCRIPTION_PROMPT` value as
`initial_prompt`, so the existing Lumi vocabulary works for local and hosted
Whisper without maintaining two word lists. Strong `hotwords` injection is
intentionally disabled because it can turn music or ambient noise into a false
navigation command.

## Moving into a newer teammate branch

The local Whisper work is intended to live in its own Git commit and does not
include `action-evaluation`. On the teammate branch:

```powershell
git cherry-pick <local-whisper-commit>
Copy-Item src/voice-control/local-whisper/.env.snippet .env.local-whisper
```

Merge the variables from `.env.local-whisper` into the backend `.env`, then run
`npm run voice:local`.

If the teammate branch truly has no voice feature, copy the complete backend
`src/voice-control` and frontend `src/features/voice-control` directories
instead. Register `VoiceControlModule` in the backend `AppModule`, render
`VoiceControlPanel` in the teaching page, and preserve the frontend contract:

```tsx
<VoiceControlPanel
  autoListen={lessonFlowStage === "training"}
  onCommandRecognized={handlePageVoiceResult}
/>
```

`autoListen` only starts wake-word standby. Commands are ignored until the
transcript contains `Lumi` (or a configured Chinese alias).

```text
POST /api/voice/transcriptions
multipart field: file
```

The action-evaluation folder and its teaching-agent integration should be moved
in a separate commit so merge conflicts in the teaching page do not block voice
recognition.
