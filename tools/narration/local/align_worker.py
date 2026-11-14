"""Forced word alignment for Hold Up narration (runs inside .cache/voice/venv; see tools/narration/voice.mjs).

Given the audio and the exact script text, Qwen3-ForcedAligner (Apache-2.0, via mlx-audio) measures where each word is
spoken. Unlike free transcription, it cannot drift onto the wrong words or collapse the last words of a take.
Request JSON: {"model": "<local model dir>", "audio": "<wav>", "text": "<plain script text>", "language": "English"}
Prints {"words": [{"text", "start", "end"}...], "engineVersion"} to stdout; errors as JSON on stderr. Offline.
"""
import argparse
import json
import os
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    request = json.load(open(parser.parse_args().request))
    from mlx_audio.stt import load
    try:
        from importlib.metadata import version
        engine_version = version("mlx-audio")
    except Exception:
        engine_version = None
    model = load(request["model"])
    result = model.generate(audio=request["audio"], text=request["text"], language=request.get("language", "English"))
    words = [{"text": item.text, "start": round(float(item.start_time), 3), "end": round(float(item.end_time), 3)} for item in result]
    print(json.dumps({"engine": "qwen3-forced-aligner", "engineVersion": engine_version, "model": request["model"], "words": words}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(json.dumps({"error": f"{type(error).__name__}: {error}"}), file=sys.stderr)
        sys.exit(1)
