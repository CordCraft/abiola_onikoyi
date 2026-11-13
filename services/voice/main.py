"""Jarvis voice service: Whisper (faster-whisper) for listening, Kokoro for speaking.

Endpoints (all but /health need header x-voice-secret == env VOICE_SECRET, or a
short-lived header x-voice-token minted by the site: base64url(exp).base64url(HMAC-SHA256(VOICE_SECRET, exp))):
  GET  /health
  GET  /voices
  POST /stt   multipart field "audio" (+ optional "prompt", "language")
  POST /tts   json {text, voice?, speed?, format?}  -> audio/mpeg (or audio/wav)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import io
import logging
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import wave
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel

log = logging.getLogger("voice")
logging.basicConfig(level=logging.INFO)

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "small")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE = os.environ.get("WHISPER_COMPUTE", "int8" if WHISPER_DEVICE == "cpu" else "float16")
WHISPER_BEAM = int(os.environ.get("WHISPER_BEAM", "1"))
# "en" is faster and avoids mis-detection on short clips. Use "auto" for any language.
WHISPER_LANGUAGE = os.environ.get("WHISPER_LANGUAGE", "en")
KOKORO_MODEL = os.environ.get("KOKORO_MODEL", "/models/kokoro-v1.0.onnx")
KOKORO_VOICES = os.environ.get("KOKORO_VOICES", "/models/voices-v1.0.bin")
DEFAULT_VOICE = os.environ.get("DEFAULT_VOICE", "bm_george")
MAX_TTS_CHARS = int(os.environ.get("MAX_TTS_CHARS", "1200"))
MAX_AUDIO_BYTES = int(os.environ.get("MAX_AUDIO_BYTES", str(25 * 1024 * 1024)))

# Names the owner says often; fed to Whisper as initial_prompt so they are spelled right.
WHISPER_HINTS = os.environ.get(
    "WHISPER_HINTS",
    "Jarvis, Nikstalis, HopperTax, Onterra, EraView, Najeeb, Hostfully, Deepcrest",
)
DEFAULT_PROMPT = f"Names that may appear: {WHISPER_HINTS}."
CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get(
        "VOICE_CORS_ORIGINS", "https://abiolaonikoyi.com,http://localhost:3000"
    ).split(",")
    if o.strip()
]

state: dict = {"whisper": None, "kokoro": None, "voices": []}
stt_lock = threading.Lock()
tts_lock = threading.Lock()


@asynccontextmanager
async def lifespan(_: FastAPI):
    if not os.environ.get("VOICE_SECRET"):
        log.warning("VOICE_SECRET is not set: every protected endpoint will return 401")
    from faster_whisper import WhisperModel

    log.info("loading whisper %s (%s, %s)", WHISPER_MODEL, WHISPER_DEVICE, WHISPER_COMPUTE)
    state["whisper"] = WhisperModel(WHISPER_MODEL, device=WHISPER_DEVICE, compute_type=WHISPER_COMPUTE)

    if Path(KOKORO_MODEL).exists() and Path(KOKORO_VOICES).exists():
        from kokoro_onnx import Kokoro

        log.info("loading kokoro from %s", KOKORO_MODEL)
        k = Kokoro(KOKORO_MODEL, KOKORO_VOICES)
        state["kokoro"] = k
        state["voices"] = sorted(k.get_voices())
    else:
        log.warning("kokoro model files not found; /tts will return 503")
    yield


app = FastAPI(title="Jarvis voice", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["content-type", "x-voice-token", "x-voice-secret"],
    max_age=86400,
)


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def valid_token(token: str, secret: str) -> bool:
    try:
        exp_b64, sig_b64 = token.split(".", 1)
        exp_raw = _b64url_decode(exp_b64)
        exp = int(exp_raw.decode())
        want = hmac.new(secret.encode(), exp_raw, hashlib.sha256).digest()
        got = _b64url_decode(sig_b64)
    except (ValueError, UnicodeDecodeError):
        return False
    return hmac.compare_digest(want, got) and exp > time.time()


def require_secret(
    x_voice_secret: str | None = Header(default=None),
    x_voice_token: str | None = Header(default=None),
) -> None:
    expected = os.environ.get("VOICE_SECRET", "")
    if not expected:
        raise HTTPException(status_code=401, detail="unauthorized")
    if x_voice_token and valid_token(x_voice_token, expected):
        return
    if x_voice_secret and hmac.compare_digest(x_voice_secret.encode(), expected.encode()):
        return
    raise HTTPException(status_code=401, detail="unauthorized")


# ── Voices ───────────────────────────────────────────────────────────────────

_ACCENTS = {"a": "American", "b": "British"}
_NAMES = {
    "bm_george": "George (British, calm)",
    "bm_lewis": "Lewis (British)",
    "bm_daniel": "Daniel (British)",
    "bm_fable": "Fable (British, storyteller)",
}


def voice_info(vid: str) -> dict:
    prefix = vid[:2]
    accent = _ACCENTS.get(prefix[0], "Other")
    gender = "male" if prefix[1:] == "m" else "female" if prefix[1:] == "f" else "unknown"
    name = vid.split("_", 1)[-1].capitalize()
    label = _NAMES.get(vid, f"{name} ({accent}, {gender})")
    lang = "en-gb" if prefix[0] == "b" else "en-us"
    return {"id": vid, "label": label, "lang": lang, "gender": gender, "accent": accent}


def voice_sort_key(vid: str):
    # British male first, then British female, then American male, American female.
    order = {"bm": 0, "bf": 1, "am": 2, "af": 3}.get(vid[:2], 4)
    return (order, 0 if vid == DEFAULT_VOICE else 1, vid)


def english_voices() -> list[str]:
    return sorted((v for v in state["voices"] if v[:2] in ("bm", "bf", "am", "af")), key=voice_sort_key)


@app.get("/health")
def health():
    return {"ok": True, "whisperModel": WHISPER_MODEL, "voices": len(state["voices"])}


@app.get("/voices", dependencies=[Depends(require_secret)])
def voices():
    return {"default": DEFAULT_VOICE, "voices": [voice_info(v) for v in english_voices()]}


# ── STT ──────────────────────────────────────────────────────────────────────


@app.post("/stt", dependencies=[Depends(require_secret)])
def stt(
    audio: UploadFile = File(...),
    prompt: str | None = Form(default=None),
    language: str | None = Form(default=None),
):
    model = state["whisper"]
    if model is None:
        raise HTTPException(status_code=503, detail="whisper not loaded")

    suffix = ".webm"
    ctype = (audio.content_type or "").lower()
    if "mp4" in ctype or "aac" in ctype or "m4a" in ctype:
        suffix = ".mp4"
    elif "ogg" in ctype:
        suffix = ".ogg"
    elif "wav" in ctype:
        suffix = ".wav"

    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        path = tmp.name
        size = 0
        while chunk := audio.file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_AUDIO_BYTES:
                tmp.close()
                os.unlink(path)
                raise HTTPException(status_code=413, detail="audio too large")
            tmp.write(chunk)

    lang = (language or WHISPER_LANGUAGE or "").strip().lower()
    if lang in ("", "auto"):
        lang = None
    initial = (prompt or "").strip() or DEFAULT_PROMPT
    try:
        with stt_lock:
            segments, info = model.transcribe(
                path,
                language=lang,
                beam_size=WHISPER_BEAM,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500},
                initial_prompt=initial[:600],
                condition_on_previous_text=False,
            )
            parts = []
            for seg in segments:
                # Drop the classic silence hallucinations ("Thank you.", "you").
                if seg.no_speech_prob > 0.6 and seg.avg_logprob < -1.0:
                    continue
                parts.append(seg.text.strip())
    except Exception as exc:  # undecodable audio etc.
        log.exception("stt failed")
        raise HTTPException(status_code=422, detail=f"could not transcribe: {exc}") from exc
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

    text = " ".join(p for p in parts if p).strip()
    return {"text": text, "language": info.language, "durationSec": round(float(info.duration), 2)}


# ── TTS ──────────────────────────────────────────────────────────────────────


class TtsBody(BaseModel):
    text: str
    voice: str | None = None
    speed: float | None = None
    format: str | None = None  # "mp3" (default) or "wav"


def strip_markdown(s: str) -> str:
    s = re.sub(r"\[\[doc:[^|\]]+\|([^\]]+)\]\]", "", s)
    s = re.sub(r"```[\s\S]*?```", " (code omitted) ", s)
    s = re.sub(r"`([^`]+)`", r"\1", s)
    s = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", s)
    s = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", s)
    s = re.sub(r"https?://\S+", "", s)
    s = re.sub(r"\*\*([^*]+)\*\*", r"\1", s)
    s = re.sub(r"__([^_]+)__", r"\1", s)
    s = re.sub(r"\*([^*]+)\*", r"\1", s)
    s = re.sub(r"^#{1,6}\s+", "", s, flags=re.M)
    s = re.sub(r"^\s*[-*+]\s+", "", s, flags=re.M)
    s = re.sub(r"^\s*\d+\.\s+", "", s, flags=re.M)
    s = re.sub(r"^\s*>\s?", "", s, flags=re.M)
    s = s.replace("|", ", ")
    s = re.sub(r"\[saved:[^\]]*\]", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def encode_wav(samples: np.ndarray, sr: int) -> bytes:
    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    return buf.getvalue()


def encode_mp3(samples: np.ndarray, sr: int) -> bytes | None:
    if not shutil.which("ffmpeg"):
        return None
    try:
        p = subprocess.run(
            [
                "ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0",
                "-codec:a", "libmp3lame", "-b:a", "64k", "-f", "mp3", "pipe:1",
            ],
            input=np.asarray(samples, dtype="<f4").tobytes(),
            capture_output=True,
            timeout=30,
        )
    except (subprocess.SubprocessError, OSError):
        return None
    return p.stdout if p.returncode == 0 and p.stdout else None


@app.post("/tts", dependencies=[Depends(require_secret)])
def tts(body: TtsBody):
    kokoro = state["kokoro"]
    if kokoro is None:
        raise HTTPException(status_code=503, detail="kokoro not loaded")
    text = strip_markdown(body.text)[:MAX_TTS_CHARS]
    if not text:
        raise HTTPException(status_code=400, detail="nothing to speak")
    voice = body.voice if body.voice in state["voices"] else DEFAULT_VOICE
    speed = min(1.5, max(0.7, body.speed or 1.0))
    lang = "en-gb" if voice.startswith("b") else "en-us"
    try:
        with tts_lock:
            samples, sr = kokoro.create(text, voice=voice, speed=speed, lang=lang)
    except Exception as exc:
        log.exception("tts failed")
        raise HTTPException(status_code=500, detail=f"tts failed: {exc}") from exc

    if (body.format or "mp3").lower() != "wav":
        mp3 = encode_mp3(samples, sr)
        if mp3:
            return Response(content=mp3, media_type="audio/mpeg", headers={"Cache-Control": "no-store"})
        log.warning("ffmpeg unavailable or failed; falling back to wav")
    return Response(content=encode_wav(samples, sr), media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.exception_handler(HTTPException)
async def http_error(_, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)
