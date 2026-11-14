"""Local voice-cloning worker for Hold Up narration (runs inside .cache/voice/venv; see tools/narration/voice.mjs).

Reads a JSON request, loads the cloning model once, and writes one 16-bit WAV per item:
  {"model": "<local model dir>", "refAudio": "<wav>", "refText": "<transcript>", "seed": 1873,
   "items": [{"text": "...", "out": "<wav path>", "settings": {"temperature": 0.7}}]}
Prints a JSON report to stdout. A setting is applied only if the model's generate() names it as a parameter;
everything else is reported as ignored, so callers never assume a control the engine does not have.
Runs offline: models are loaded from the local directory written at install time.
"""
import argparse
import inspect
import json
import os
import sys
import time

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True)
    request = json.load(open(parser.parse_args().request))

    import numpy as np
    import soundfile as sf
    import mlx.core as mx
    from mlx_audio.tts.utils import load_model

    try:
        from importlib.metadata import version
        engine_version = version("mlx-audio")
    except Exception:
        engine_version = None

    if request.get("seed") is not None:
        mx.random.seed(int(request["seed"]))
    started = time.time()
    model = load_model(request["model"])
    load_seconds = time.time() - started
    params = inspect.signature(model.generate).parameters
    named = {name for name, p in params.items() if p.kind not in (p.VAR_KEYWORD, p.VAR_POSITIONAL)}

    results = []
    for item in request["items"]:
        kwargs = {"text": item["text"], "ref_audio": request["refAudio"], "ref_text": request["refText"]}
        applied, ignored = {}, []
        for key, value in (item.get("settings") or {}).items():
            if key in named:
                kwargs[key] = value
                applied[key] = value
            else:
                ignored.append(key)
        if request.get("seed") is not None:
            mx.random.seed(int(request["seed"]))
        t0 = time.time()
        segments = list(model.generate(**kwargs))
        if not segments:
            raise RuntimeError("the model returned no audio")
        audio = np.concatenate([np.asarray(s.audio, dtype=np.float32).reshape(-1) for s in segments])
        rate = int(getattr(segments[0], "sample_rate", None) or getattr(model, "sample_rate", None) or 24000)
        sf.write(item["out"], np.clip(audio, -1.0, 1.0), rate, subtype="PCM_16")
        seconds = time.time() - t0
        results.append({"out": item["out"], "sampleRate": rate, "audioSec": round(len(audio) / rate, 3),
                        "generateSec": round(seconds, 2), "realTimeFactor": round(seconds / max(1e-6, len(audio) / rate), 2),
                        "applied": applied, "ignored": ignored})

    print(json.dumps({"engine": "mlx-audio", "engineVersion": engine_version, "model": request["model"],
                      "loadSec": round(load_seconds, 2), "supportedSettings": sorted(named - {"text", "ref_audio", "ref_text"}),
                      "items": results}))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # report to the caller as JSON on stderr, exit non-zero
        print(json.dumps({"error": f"{type(error).__name__}: {error}"}), file=sys.stderr)
        sys.exit(1)
