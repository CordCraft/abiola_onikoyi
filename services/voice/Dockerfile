FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HOME=/models/hf

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg espeak-ng curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt

# Bake the Whisper weights into the image so cold starts do not download them.
# Railway passes service variables as build args when the ARG is declared.
ARG WHISPER_MODEL=small
ENV WHISPER_MODEL=${WHISPER_MODEL}
RUN python -c "import os; from faster_whisper import WhisperModel; WhisperModel(os.environ['WHISPER_MODEL'], device='cpu', compute_type='int8')"

# Kokoro model + voices from the official kokoro-onnx release (pinned tag).
ARG KOKORO_RELEASE=model-files-v1.0
RUN mkdir -p /models \
    && curl -fL --retry 3 -o /models/kokoro-v1.0.onnx \
       https://github.com/thewh1teagle/kokoro-onnx/releases/download/${KOKORO_RELEASE}/kokoro-v1.0.onnx \
    && curl -fL --retry 3 -o /models/voices-v1.0.bin \
       https://github.com/thewh1teagle/kokoro-onnx/releases/download/${KOKORO_RELEASE}/voices-v1.0.bin

COPY main.py .

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
