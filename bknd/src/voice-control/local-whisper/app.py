"""Local faster-whisper HTTP worker for Lumi voice commands."""

from __future__ import annotations

import os
import tempfile
import threading
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from faster_whisper import WhisperModel

MODEL_NAME = os.getenv("LOCAL_WHISPER_MODEL", "small")
DEVICE = os.getenv("LOCAL_WHISPER_DEVICE", "cpu")
COMPUTE_TYPE = os.getenv("LOCAL_WHISPER_COMPUTE_TYPE", "int8")
CPU_THREADS = max(1, int(os.getenv("LOCAL_WHISPER_CPU_THREADS", "12")))
DEFAULT_LANGUAGE = os.getenv("LOCAL_WHISPER_LANGUAGE", "auto")
DEFAULT_PROMPT = os.getenv("LOCAL_WHISPER_PROMPT", "")
SUPPORTED_LANGUAGES = {"zh", "en"}

app = FastAPI(title="Lumi Local Whisper", version="1.0.0")
model: WhisperModel | None = None
model_lock = threading.RLock()


def get_model() -> WhisperModel:
    global model
    if model is None:
        with model_lock:
            if model is None:
                model = WhisperModel(
                    MODEL_NAME,
                    device=DEVICE,
                    compute_type=COMPUTE_TYPE,
                    cpu_threads=CPU_THREADS,
                )
    return model


def supported_language(language: str) -> str | None:
    normalized = language.strip().lower().replace("_", "-")
    primary_language = normalized.split("-", maxsplit=1)[0]
    return primary_language if primary_language in SUPPORTED_LANGUAGES else None


@app.get("/health")
def health() -> dict[str, object]:
    return {
        "status": "ok",
        "provider": "faster-whisper",
        "model": MODEL_NAME,
        "device": DEVICE,
        "computeType": COMPUTE_TYPE,
        "loaded": model is not None,
        "languages": sorted(SUPPORTED_LANGUAGES),
        "defaultLanguage": supported_language(DEFAULT_LANGUAGE) or "auto",
    }


@app.post("/transcribe")
def transcribe(
    file: UploadFile = File(...),
    language: str = Form(DEFAULT_LANGUAGE),
    initial_prompt: str = Form(DEFAULT_PROMPT),
    hotwords: str = Form(""),
) -> dict[str, str]:
    suffix = Path(file.filename or "voice-command.webm").suffix or ".webm"
    temporary_path = ""
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as audio:
            temporary_path = audio.name
            while chunk := file.file.read(1024 * 1024):
                audio.write(chunk)

        transcription_language = supported_language(language or DEFAULT_LANGUAGE)
        with model_lock:
            segments, _ = get_model().transcribe(
                temporary_path,
                language=transcription_language,
                task="transcribe",
                beam_size=5,
                temperature=0,
                vad_filter=True,
                vad_parameters={
                    "min_speech_duration_ms": 50,
                    "min_silence_duration_ms": 250,
                    "speech_pad_ms": 200,
                },
                initial_prompt=initial_prompt or DEFAULT_PROMPT or None,
                hotwords=hotwords or None,
                condition_on_previous_text=False,
            )
            text = "".join(segment.text for segment in segments).strip()
        return {"text": text, "model": f"local/{MODEL_NAME}"}
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Local Whisper transcription failed: {type(error).__name__}",
        ) from error
    finally:
        file.file.close()
        if temporary_path:
            Path(temporary_path).unlink(missing_ok=True)
