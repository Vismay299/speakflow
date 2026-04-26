#!/usr/bin/env python3
"""Transcribe one utterance with MLX Whisper large-v3 on Apple Silicon GPU.

Phase 12.4.1 decision: mlx-whisper locked as the large-v3 runtime.
"""
from __future__ import annotations

import argparse
import json
import math
import re
import sys

import mlx_whisper

_HALLUCINATION_TEXTS = {
    "askforfollowupchange",
    "askforfollowupchanges",
    "thanksforwatching",
    "pleasesubscribe",
}
_HALLUCINATION_PATTERNS = [
    r"\bask\s+for\s+follow(?:\s|-|\u2010|\u2011|\u2012|\u2013|\u2014|\u2212)*up\s+change(?:s)?\b(?:\s*[,.;:!?]+)?",
    r"\bthanks\s+for\s+watching\b(?:\s*[,.;:!?]+)?",
    r"\bplease\s+subscribe\b(?:\s*[,.;:!?]+)?",
]
_HALLUCINATION_RE = re.compile("|".join(_HALLUCINATION_PATTERNS), re.IGNORECASE)


def _is_blocked_hallucination(text: str) -> bool:
    normalized = "".join(char for char in text.lower() if char.isalpha())
    return normalized in _HALLUCINATION_TEXTS


def _contains_blocked_hallucination(text: str) -> bool:
    return _HALLUCINATION_RE.search(text) is not None or _is_blocked_hallucination(text)


def _strip_blocked_hallucinations(text: str) -> str:
    cleaned = _HALLUCINATION_RE.sub("", text)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    cleaned = re.sub(r"\s+([,.!?;:])", r"\1", cleaned)
    return cleaned.strip()


def _sanitize_transcription_text_and_segments(text: str, segments: list[dict]) -> tuple[str, list[dict]]:
    raw_text = text.strip()
    raw_text_had_blocked = _contains_blocked_hallucination(raw_text)
    cleaned_text = _strip_blocked_hallucinations(raw_text)

    if _is_blocked_hallucination(raw_text) or (raw_text_had_blocked and not cleaned_text):
        return "", []

    cleaned_segments = []
    for segment in segments:
        segment_text = segment["text"].strip()
        cleaned_segment_text = _strip_blocked_hallucinations(segment_text)
        if cleaned_segment_text and not _is_blocked_hallucination(segment_text):
            segment["text"] = cleaned_segment_text
            cleaned_segments.append(segment)

    # The phrase can be split across adjacent Whisper segments, so check the
    # joined segment surface before returning it to the app.
    joined_segments = " ".join(segment["text"] for segment in cleaned_segments)
    if _contains_blocked_hallucination(joined_segments):
        cleaned_segments = []

    return cleaned_text, cleaned_segments


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Transcribe one utterance with mlx-whisper large-v3.")
    parser.add_argument("--input", required=True, help="Path to the WAV file to transcribe.")
    parser.add_argument("--utterance-id", required=True, help="Utterance UUID for tracing.")
    parser.add_argument("--model", default="mlx-community/whisper-large-v3-turbo", help="HuggingFace model repo.")
    parser.add_argument("--language", default="en", help="Language code.")
    return parser.parse_args()


def transcribe(args: argparse.Namespace) -> dict:
    options = {
        "path_or_hf_repo": args.model,
        "language": args.language,
        "task": "transcribe",
        "temperature": 0.0,
        "condition_on_previous_text": False,
        "word_timestamps": False,
        "no_speech_threshold": 0.6,
        "logprob_threshold": -1.0,
        "compression_ratio_threshold": 2.4,
        "without_timestamps": True,
    }
    try:
        result = mlx_whisper.transcribe(args.input, **options)
    except TypeError:
        options.pop("without_timestamps", None)
        result = mlx_whisper.transcribe(args.input, **options)

    segments = []
    for i, seg in enumerate(result.get("segments", [])):
        avg_logprob = seg.get("avg_logprob")
        confidence = None
        if avg_logprob is not None:
            confidence = max(0.0, min(1.0, math.exp(float(avg_logprob))))

        segments.append({
            "index": i,
            "start_seconds": seg.get("start", 0.0),
            "end_seconds": seg.get("end", 0.0),
            "text": seg.get("text", "").strip(),
            "confidence": confidence,
        })

    # Compute audio duration from segments.
    duration = 0.0
    if segments:
        duration = max(s["end_seconds"] for s in segments)

    text, segments = _sanitize_transcription_text_and_segments(result.get("text", ""), segments)

    return {
        "utterance_id": args.utterance_id,
        "model_identifier": "large-v3-turbo",
        "language": result.get("language", args.language),
        "duration_seconds": duration,
        "text": text,
        "segments": segments,
    }


def main() -> int:
    args = parse_args()
    try:
        payload = transcribe(args)
        json.dump(payload, sys.stdout, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        sys.stdout.write("\n")
        return 0
    except Exception as error:
        print(f"[transcribe_utterance] {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
