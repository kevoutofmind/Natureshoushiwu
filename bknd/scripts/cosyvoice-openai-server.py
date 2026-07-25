from __future__ import annotations

import io
import json
import os
from pathlib import Path
import struct
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any
import wave

import numpy as np


BACKEND_DIR = Path(__file__).resolve().parents[1]
RUNTIME_CACHE = BACKEND_DIR / ".cache" / "cosyvoice" / "runtime"
os.environ.setdefault("HF_HOME", str(RUNTIME_CACHE / "huggingface"))
os.environ.setdefault("MPLCONFIGDIR", str(RUNTIME_CACHE / "matplotlib"))
Path(os.environ["HF_HOME"]).mkdir(parents=True, exist_ok=True)
Path(os.environ["MPLCONFIGDIR"]).mkdir(parents=True, exist_ok=True)

COSYVOICE_ROOT = Path(
    os.getenv(
        "COSYVOICE_ROOT",
        str(BACKEND_DIR / ".cache" / "cosyvoice" / "CosyVoice"),
    )
).resolve()
MODEL_DIR = Path(
    os.getenv(
        "COSYVOICE_MODEL_DIR",
        str(BACKEND_DIR / ".cache" / "cosyvoice" / "models" / "CosyVoice-300M-SFT"),
    )
).resolve()

_model: Any | None = None
_model_lock = threading.Lock()


def get_model() -> Any:
    global _model
    if _model is not None:
        return _model

    if not COSYVOICE_ROOT.exists():
        raise RuntimeError(
            f"CosyVoice source was not found at {COSYVOICE_ROOT}. "
            "Run scripts/setup-cosyvoice.ps1 first."
        )
    if not MODEL_DIR.exists():
        raise RuntimeError(
            f"CosyVoice model was not found at {MODEL_DIR}. "
            "Run scripts/setup-cosyvoice.ps1 first."
        )

    sys.path.insert(0, str(COSYVOICE_ROOT))
    sys.path.insert(0, str(COSYVOICE_ROOT / "third_party" / "Matcha-TTS"))
    from cosyvoice.cli.cosyvoice import AutoModel

    use_fp16 = os.getenv("COSYVOICE_FP16", "1") == "1"
    load_jit = os.getenv("COSYVOICE_LOAD_JIT", "1") == "1"
    _model = AutoModel(
        model_dir=str(MODEL_DIR),
        fp16=use_fp16,
        load_jit=load_jit,
    )
    available_speakers = _model.list_available_spks()
    print(
        f"[CosyVoice] model loaded; speakers={available_speakers}",
        flush=True,
    )
    return _model


def wav_bytes(audio: np.ndarray, sample_rate: int) -> bytes:
    samples = np.asarray(audio, dtype=np.float32).reshape(-1)
    samples = np.clip(samples, -1.0, 1.0)
    pcm = (samples * 32767).astype(np.int16)
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sample_rate)
        wav.writeframes(pcm.tobytes())
    return buffer.getvalue()


def synthesize(text: str, speaker: str, speed: float) -> bytes:
    model = get_model()
    chunks = list(synthesize_chunks(text, speaker, speed, stream=False))
    if not chunks:
        raise RuntimeError("CosyVoice returned no audio.")
    return wav_bytes(np.concatenate(chunks), model.sample_rate)


def synthesize_chunks(
    text: str,
    speaker: str,
    speed: float,
    *,
    stream: bool,
):
    model = get_model()
    available_speakers = model.list_available_spks()
    if speaker not in available_speakers:
        fallback = os.getenv("COSYVOICE_VOICE", "中文女")
        speaker = fallback if fallback in available_speakers else available_speakers[0]

    with _model_lock:
        for result in model.inference_sft(
            text,
            speaker,
            stream=stream,
            speed=max(0.8, min(speed, 1.2)),
        ):
            yield result["tts_speech"].detach().cpu().numpy().reshape(-1)


class CosyVoiceHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/health":
            self.send_json(
                200,
                {
                    "status": "ready" if _model is not None else "loading",
                    "provider": "cosyvoice",
                },
            )
            return
        self.send_json(404, {"error": "not_found"})

    def do_POST(self) -> None:
        normalized_path = self.path.rstrip("/")
        if normalized_path not in {"/v1/audio/speech", "/v1/audio/stream"}:
            self.send_json(404, {"error": "not_found"})
            return

        try:
            content_length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(content_length) or b"{}")
            text = str(payload.get("input", "")).strip()
            if not text:
                self.send_json(400, {"error": "input is required"})
                return

            speaker = str(payload.get("voice") or "中文女").strip()
            speed = float(payload.get("speed") or 1.0)
            if normalized_path == "/v1/audio/stream":
                self.send_pcm_stream(text, speaker, speed)
                return

            audio = synthesize(text, speaker, speed)
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(audio)
            self.close_connection = True
        except Exception as exc:  # noqa: BLE001 - local compatibility service.
            print(f"[CosyVoice] synthesis failed: {exc}", flush=True)
            self.send_json(500, {"error": str(exc)})

    def send_pcm_stream(self, text: str, speaker: str, speed: float) -> None:
        model = get_model()
        self.send_response(200)
        self.send_header("Content-Type", "application/x-lumi-pcm")
        self.send_header("X-Lumi-Sample-Rate", str(model.sample_rate))
        self.send_header("Transfer-Encoding", "chunked")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()

        for samples in synthesize_chunks(text, speaker, speed, stream=True):
            pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).tobytes()
            framed_pcm = struct.pack("<I", len(pcm)) + pcm
            self.wfile.write(f"{len(framed_pcm):X}\r\n".encode("ascii"))
            self.wfile.write(framed_pcm)
            self.wfile.write(b"\r\n")
            self.wfile.flush()
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()
        self.close_connection = True

    def send_json(self, status: int, payload: dict[str, str]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(body)
        self.close_connection = True

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[CosyVoice] {self.address_string()} - {format % args}", flush=True)


def main() -> None:
    host = os.getenv("COSYVOICE_HOST", "127.0.0.1")
    port = int(os.getenv("COSYVOICE_PORT", "9967"))
    print("[CosyVoice] loading model...", flush=True)
    get_model()
    server = ThreadingHTTPServer((host, port), CosyVoiceHandler)
    print(
        f"[CosyVoice] OpenAI-compatible server listening on http://{host}:{port}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
