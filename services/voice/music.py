"""Jarvis Songs: listen to a whole song and measure it.

The site sends the audio (fetched by one of the owner's computers) to
POST /music/analyze. This answers 202 at once, analyses in a background
thread, then POSTs the result to the callback URL with x-voice-secret.

What is measured (numbers, not guesses):
  - tempo and beat grid, with the half/double-time alternative
  - key and mode (Krumhansl profiles on the harmonic part), with confidence
  - sections: boundaries from beat-synchronous chroma + MFCC, labelled A/B/C
    by similarity, with energy, brightness and vocal density per section
  - energy curve across the song, loudness, dynamic range
  - timbre: brightness, low-end weight, percussive share, onset density
  - vocals: Whisper word timestamps give words per second per section,
    vocal coverage, detected language and how repetitive the hook words are.
    The transcript itself is never returned (lyrics are not stored).
"""

from __future__ import annotations

import json
import logging
import subprocess
import threading
import urllib.request
from collections import Counter

import numpy as np

log = logging.getLogger("voice.music")

SR = 22050
KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
# Krumhansl-Kessler key profiles
MAJOR = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MINOR = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])

music_lock = threading.Lock()  # one song at a time; the box also serves live voice


def decode(path: str, sr: int = SR) -> np.ndarray:
    """Any audio file -> mono float32 at sr, via ffmpeg."""
    out = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
        capture_output=True,
        timeout=180,
        check=True,
    ).stdout
    return np.frombuffer(out, dtype=np.float32).copy()


def estimate_key(chroma: np.ndarray) -> dict:
    prof = chroma.mean(axis=1)
    prof = prof / (prof.sum() or 1)
    scores = []
    for i in range(12):
        for mode, p in (("major", MAJOR), ("minor", MINOR)):
            r = np.corrcoef(prof, np.roll(p, i))[0, 1]
            scores.append((float(r), KEYS[i], mode))
    scores.sort(reverse=True)
    best, second = scores[0], scores[1]
    return {
        "key": f"{best[1]} {best[2]}",
        "confidence": round(best[0], 3),
        "margin": round(best[0] - second[0], 3),
        "runnerUp": f"{second[1]} {second[2]}",
    }


def section_labels(feats: list[np.ndarray], threshold: float = 0.6) -> list[str]:
    """A, B, C... with repeats sharing a letter. Features are standardised
    across sections first, so similarity reflects real differences."""
    if not feats:
        return []
    f = np.array(feats)
    f = (f - f.mean(axis=0)) / (f.std(axis=0) + 1e-6)
    labels: list[str] = []
    protos: list[np.ndarray] = []
    for row in f:
        v = row / (np.linalg.norm(row) or 1)
        sims = [float(v @ p) for p in protos]
        if sims and max(sims) >= threshold:
            labels.append(chr(ord("A") + int(np.argmax(sims))))
        elif len(protos) < 26:
            protos.append(v)
            labels.append(chr(ord("A") + len(protos) - 1))
        else:
            labels.append("?")
    return labels


def scale(values: list[float]) -> list[int]:
    lo, hi = min(values), max(values)
    if hi - lo < 1e-6:
        return [5 for _ in values]
    return [int(round(1 + 9 * (v - lo) / (hi - lo))) for v in values]


def transcribe_words(y: np.ndarray, whisper, stt_lock: threading.Lock) -> tuple[list[tuple[float, float, str]], str | None, float]:
    """Word timestamps over the whole song, in 30 s chunks so live voice
    requests can slip in between chunks."""
    words: list[tuple[float, float, str]] = []
    langs: Counter = Counter()
    probs: list[float] = []
    w16 = None
    try:
        import librosa

        w16 = librosa.resample(y, orig_sr=SR, target_sr=16000)
    except Exception:  # pragma: no cover
        return words, None, 0.0
    chunk = 30 * 16000
    for start in range(0, len(w16), chunk):
        seg = w16[start : start + chunk]
        if len(seg) < 16000:
            break
        with stt_lock:
            segments, info = whisper.transcribe(
                seg, language=None, beam_size=1, word_timestamps=True, vad_filter=True, condition_on_previous_text=False
            )
            seg_words = []
            for s in segments:
                for w in s.words or []:
                    seg_words.append((start / 16000 + w.start, start / 16000 + w.end, w.word.strip()))
        if seg_words:
            langs[info.language] += len(seg_words)
            probs.append(float(info.language_probability))
        words.extend(seg_words)
    lang = langs.most_common(1)[0][0] if langs else None
    return words, lang, (float(np.mean(probs)) if probs else 0.0)


def analyze_file(path: str, whisper, stt_lock: threading.Lock) -> dict:
    import librosa

    y = decode(path)
    if len(y) < SR * 5:
        raise ValueError("Audio is shorter than 5 seconds")
    duration = len(y) / SR
    hop = 512

    y_h, y_p = librosa.effects.hpss(y)
    onset_env = librosa.onset.onset_strength(y=y_p, sr=SR, hop_length=hop)
    tempo, beats = librosa.beat.beat_track(onset_envelope=onset_env, sr=SR, hop_length=hop, start_bpm=100, units="frames")
    tempo = float(np.atleast_1d(tempo)[0])
    beat_times = librosa.frames_to_time(beats, sr=SR, hop_length=hop)
    alt = tempo * 2 if tempo < 80 else tempo / 2 if tempo > 150 else None

    chroma = librosa.feature.chroma_cqt(y=y_h, sr=SR, hop_length=hop)
    key = estimate_key(chroma)

    rms = librosa.feature.rms(y=y, hop_length=hop)[0]
    rms_db = librosa.amplitude_to_db(rms + 1e-9)
    centroid = librosa.feature.spectral_centroid(y=y, sr=SR, hop_length=hop)[0]
    mfcc = librosa.feature.mfcc(y=y, sr=SR, n_mfcc=13, hop_length=hop)

    spec = np.abs(librosa.stft(y, n_fft=2048, hop_length=hop)) ** 2
    freqs = librosa.fft_frequencies(sr=SR, n_fft=2048)
    total = spec.sum() or 1
    low_share = float(spec[freqs < 150].sum() / total)
    sub_share = float(spec[freqs < 60].sum() / total)
    perc_share = float((y_p**2).sum() / (((y_h**2).sum() + (y_p**2).sum()) or 1))
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=SR, hop_length=hop)

    # Sections from beat-synchronous features
    if len(beats) > 16:
        feats = np.vstack([librosa.util.normalize(chroma, axis=0), librosa.util.normalize(mfcc, axis=1)])
        sync = librosa.util.sync(feats, beats, aggregate=np.median)
        k = int(np.clip(round(duration / 22), 4, 12))
        bounds = librosa.segment.agglomerative(sync, k)
        # sync column b starts at beat b-1 (column 0 is the lead-in before the first beat)
        bound_times = sorted(set([0.0] + [float(beat_times[min(b - 1, len(beat_times) - 1)]) for b in bounds if b > 0] + [duration]))
    else:
        bound_times = [0.0, duration]

    words, lang, lang_prob = ([], None, 0.0)
    if whisper is not None:
        try:
            words, lang, lang_prob = transcribe_words(y, whisper, stt_lock)
        except Exception as e:  # vocals are a bonus
            log.warning("transcribe failed: %s", e)

    frame_t = librosa.frames_to_time(np.arange(len(rms)), sr=SR, hop_length=hop)
    seg_feats, sections = [], []
    for a, b in zip(bound_times[:-1], bound_times[1:]):
        if b - a < 4:
            continue
        m = (frame_t >= a) & (frame_t < b)
        if not m.any():
            continue
        seg_feats.append(np.concatenate([chroma[:, m].mean(axis=1), mfcc[1:, m].mean(axis=1) / 50]))
        n_words = sum(1 for w in words if a <= w[0] < b)
        sung = sum(min(w[1], b) - max(w[0], a) for w in words if w[1] > a and w[0] < b)
        sections.append(
            {
                "start": round(a, 1),
                "end": round(b, 1),
                "bars": round((b - a) * tempo / 240, 1),  # 4/4 bars
                "loudnessDb": round(float(rms_db[m].mean()), 1),
                "brightnessHz": int(centroid[m].mean()),
                "wordsPerSec": round(n_words / (b - a), 2),
                "vocalCoverage": round(min(sung / (b - a), 1.0), 2),
            }
        )
    labels = section_labels(seg_feats)
    energies = scale([s["loudnessDb"] for s in sections]) if sections else []
    for s, lab, e in zip(sections, labels, energies):
        s["label"] = lab
        s["energy"] = e

    # 16-point energy curve
    pts = np.array_split(rms_db, 16)
    curve = scale([float(p.mean()) for p in pts if len(p)])

    tokens = [w[2].lower().strip(".,!?\"'()") for w in words if w[2].strip()]
    counts = Counter(t for t in tokens if t)
    repetition = round(1 - len(counts) / len(tokens), 2) if tokens else None

    return {
        "ok": True,
        "durationSec": round(duration, 1),
        "tempo": round(tempo, 1),
        "tempoAlternative": round(alt, 1) if alt else None,
        "beatsDetected": int(len(beats)),
        "key": key,
        "loudnessDb": round(float(rms_db.mean()), 1),
        "dynamicRangeDb": round(float(np.percentile(rms_db, 95) - np.percentile(rms_db, 10)), 1),
        "brightnessHz": int(centroid.mean()),
        "lowEndShare": round(low_share, 3),
        "subBassShare": round(sub_share, 3),
        "percussiveShare": round(perc_share, 3),
        "onsetsPerSec": round(len(onsets) / duration, 2),
        "energyCurve": curve,
        "sections": sections,
        "sectionPattern": "".join(s["label"] for s in sections),
        "vocals": {
            "language": lang,
            "languageConfidence": round(lang_prob, 2),
            "wordsHeard": len(tokens),
            "wordsPerSec": round(len(tokens) / duration, 2) if tokens else 0,
            "repetition": repetition,
            "firstVocalAt": round(words[0][0], 1) if words else None,
        },
    }


def run_job(path: str, callback: str, secret: str, song_id: str, whisper, stt_lock: threading.Lock) -> None:
    import os

    with music_lock:
        try:
            result = analyze_file(path, whisper, stt_lock)
        except Exception as e:
            log.exception("music analysis failed")
            result = {"ok": False, "error": str(e)[:300]}
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
    body = json.dumps({"songId": song_id, **result}).encode()
    req = urllib.request.Request(
        callback, data=body, method="POST", headers={"content-type": "application/json", "x-voice-secret": secret}
    )
    for attempt in range(3):
        try:
            urllib.request.urlopen(req, timeout=30).read()
            return
        except Exception as e:  # pragma: no cover
            log.warning("callback failed (%s): %s", attempt, e)
