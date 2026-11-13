# Jarvis voice service

FastAPI service that gives Jarvis its ears and its voice.

- Listening: [faster-whisper](https://github.com/SYSTRAN/faster-whisper) (CPU int8 by default).
- Speaking: [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx), default voice `bm_george` (calm British male).
- TTS output format: `audio/mpeg` (MP3, 64 kbps mono, encoded with ffmpeg). It falls back to `audio/wav` if ffmpeg is missing, and a client can ask for `"format": "wav"`.

## Endpoints

All except `/health` need either the header `x-voice-secret: <VOICE_SECRET>` (timing-safe compare) or a short-lived `x-voice-token`. The token is minted by the site route `/jarvis/api/voice/token` (session protected) as `base64url(exp).base64url(HMAC-SHA256(VOICE_SECRET, exp))`, where `exp` is unix seconds as a decimal string and the token is valid for 5 minutes. The browser uses it to call this service directly (no Netlify hop) and falls back to the site proxy on any failure. CORS allows `https://abiolaonikoyi.com` and `http://localhost:3000` (override with `VOICE_CORS_ORIGINS`, comma separated).

| Method | Path | Body | Returns |
| --- | --- | --- | --- |
| GET | `/health` | none | `{ok, whisperModel, voices}` |
| GET | `/voices` | none | `{default, voices:[{id,label,lang,gender,accent}]}` British male first |
| POST | `/stt` | multipart `audio` (webm/opus, mp4/aac, ogg, wav), optional `prompt`, `language` | `{text, language, durationSec}` |
| POST | `/tts` | json `{text, voice?, speed?, format?}` | audio bytes (markdown stripped, capped at `MAX_TTS_CHARS`) |

The default STT `initial_prompt` is built from `WHISPER_HINTS` (default `Jarvis, Nikstalis, HopperTax, Onterra, EraView, Najeeb, Hostfully, Deepcrest`) so those names are spelled correctly. Send a `prompt` form field to override it per request. Decoding uses beam size 1 (`WHISPER_BEAM`, default 1) for speed.

## Railway setup

1. New service from the GitHub repo `CordCraft/abiola_onikoyi`, Settings, Root Directory = `services/voice`. Railway builds the `Dockerfile` in that folder.
2. Variables:
   - `VOICE_SECRET` (required): long random string. The same value goes on Netlify.
   - `WHISPER_MODEL` (default `small`): also used as a build arg, so the weights are baked into the image. Changing it needs a redeploy.
   - Optional: `WHISPER_LANGUAGE` (default `en`, `auto` = detect the language per utterance, slightly slower and less accurate on short clips), `WHISPER_BEAM` (default 1), `WHISPER_HINTS` (comma separated names, see above), `VOICE_CORS_ORIGINS`, `DEFAULT_VOICE` (default `bm_george`), `MAX_TTS_CHARS` (default 1200).
3. Memory and CPU: `small` int8 plus Kokoro needs about 2 GB RAM and 2 vCPU to feel responsive (a 5 second utterance transcribes in roughly 1 to 2 seconds, a sentence of speech renders in 1 to 2 seconds). `base` or `tiny` fit in 1 GB. `medium` wants 4 GB.
4. Generate a public domain for the service and put it in Netlify as `VOICE_SERVICE_URL` (no trailing slash).
5. GPU: set `WHISPER_MODEL=large-v3-turbo`, `WHISPER_DEVICE=cuda` and use a CUDA base image with cuDNN 9 (`nvidia/cuda:12.x-cudnn-runtime`). On CPU, `large-v3-turbo` is too slow for conversation.

Netlify variables: `VOICE_SERVICE_URL`, `VOICE_SECRET`, and optionally `VOICE_PUBLIC_URL` (the URL handed to the browser for the direct path; defaults to `VOICE_SERVICE_URL`). Without `VOICE_SERVICE_URL` the site proxy answers 503 and Jarvis falls back to the browser voice.

## Local run

```
cd services/voice
python -m venv .venv            # Python 3.12 or 3.13
.venv/Scripts/pip install -r requirements.txt     # Windows (use .venv/bin/pip on macOS/Linux)
mkdir models
# Kokoro files (int8 is 88 MB, full precision kokoro-v1.0.onnx is 310 MB)
curl -L -o models/kokoro-v1.0.onnx https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -L -o models/voices-v1.0.bin  https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
# ffmpeg must be on PATH for MP3 output (otherwise wav is returned)
export VOICE_SECRET=dev WHISPER_MODEL=tiny KOKORO_MODEL=models/kokoro-v1.0.onnx KOKORO_VOICES=models/voices-v1.0.bin
.venv/Scripts/python -m uvicorn main:app --port 8765
```

Smoke test:

```
curl -H "x-voice-secret: dev" -H "content-type: application/json" -d '{"text":"Good morning."}' -o t.mp3 localhost:8765/tts
curl -H "x-voice-secret: dev" -F audio=@t.mp3 localhost:8765/stt
```

For the site to use a local service set `VOICE_SERVICE_URL=http://localhost:8765` and `VOICE_SECRET=dev` in the site `.env`.

## Notes

- `av` is pinned to 15.1.0: newer releases break faster-whisper's audio decoding.
- Whisper segments with a high no-speech probability and poor log probability are dropped to stop "Thank you." hallucinations on silence.
- One Whisper job and one Kokoro job run at a time per instance (locks), so a busy instance queues rather than thrashing the CPU.
