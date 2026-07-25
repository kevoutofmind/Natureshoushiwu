from __future__ import annotations

import io
import json
import os
from pathlib import Path
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import numpy as np

_chat: Any | None = None
_chattts: Any | None = None


def get_chat() -> Any:
    global _chat, _chattts
    if _chat is not None:
        return _chat

    import ChatTTS

    _chattts = ChatTTS
    _chat = ChatTTS.Chat()
    cache_dir = Path(
        os.getenv(
            "CHAT_TTS_CACHE_DIR",
            str(Path(__file__).resolve().parents[1] / ".cache" / "chattts"),
        )
    )
    cache_dir.mkdir(parents=True, exist_ok=True)
    loaded = _chat.load(
        source=os.getenv("CHAT_TTS_SOURCE", "huggingface"),
        custom_path=str(cache_dir),
        compile=os.getenv("CHAT_TTS_COMPILE", "0") == "1",
    )
    if not loaded:
        raise RuntimeError(f"ChatTTS model failed to load from {cache_dir}")
    return _chat


def wav_bytes(audio: np.ndarray, sample_rate: int = 24000) -> bytes:
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


class ChatTtsHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/v1/audio/speech":
            self.send_json(404, {"error": "not_found"})
            return

        try:
            content_length = int(self.headers.get("content-length", "0"))
            payload = json.loads(self.rfile.read(content_length) or b"{}")
            text = str(payload.get("input", "")).strip()
            if not text:
                self.send_json(400, {"error": "input is required"})
                return

            chat = get_chat()
            prompt = os.getenv("CHAT_TTS_REFINE_PROMPT", "[oral_2][laugh_0][break_4]")
            params_refine_text = _chattts.Chat.RefineTextParams(prompt=prompt)
            wavs = chat.infer([text], params_refine_text=params_refine_text)
            audio = wav_bytes(wavs[0])
            self.send_response(200)
            self.send_header("Content-Type", "audio/wav")
            self.send_header("Content-Length", str(len(audio)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(audio)
        except Exception as exc:  # noqa: BLE001 - this is a tiny local service.
            self.send_json(500, {"error": str(exc)})

    def send_json(self, status: int, payload: dict[str, str]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[ChatTTS] {self.address_string()} - {format % args}")


def main() -> None:
    host = os.getenv("CHAT_TTS_HOST", "127.0.0.1")
    port = int(os.getenv("CHAT_TTS_PORT", "9966"))
    server = ThreadingHTTPServer((host, port), ChatTtsHandler)
    print(
        f"ChatTTS OpenAI-compatible server listening on http://{host}:{port}",
        flush=True,
    )
    server.serve_forever()


if __name__ == "__main__":
    main()
