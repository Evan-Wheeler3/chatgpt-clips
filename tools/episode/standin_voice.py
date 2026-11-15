"""Stand-in narration for machines without the owner's cloned voice (see docs/NARRATION.md).

The approved narrator is the owner's Qwen3-TTS clone, which needs voices/private/ and Apple MLX. This script exists so
an episode can be timed, animated and reviewed elsewhere: it speaks the approved script line by line with Kokoro
(Apache-2.0, CPU), then measures word timing from the audio with faster-whisper. It writes the same files a real take
does (narration.wav, words.json) and marks them as a stand-in. Re-narrate on the Mac before publishing.

  python tools/episode/standin_voice.py stories/<slug>/story.json production/<slug>
"""
import json, re, sys, difflib
from pathlib import Path
import numpy as np, soundfile as sf

SR = 48000
norm = lambda w: re.sub(r"[^a-z0-9]+", "", w.lower().replace("’", "").replace("'", ""))

def resample(x, r):
    from scipy.signal import resample_poly
    from math import gcd
    g = gcd(SR, r); return resample_poly(x, SR // g, r // g).astype("float32")

def trim(x, sr, thresh=0.012, pad=0.02):
    idx = np.where(np.abs(x) > thresh)[0]
    if not len(idx): return x
    a, b = max(0, idx[0] - int(pad * sr)), min(len(x), idx[-1] + int(pad * sr))
    y = x[a:b].copy(); f = int(0.006 * sr); y[:f] *= np.linspace(0, 1, f); y[-f:] *= np.linspace(1, 0, f); return y

def main(story_path, out_dir):
    from huggingface_hub import hf_hub_download
    from kokoro_onnx import Kokoro
    from faster_whisper import WhisperModel
    story = json.loads(Path(story_path).read_text()); n = story["narration"]; cfg = n.get("standIn", {})
    k = Kokoro(hf_hub_download("fastrtc/kokoro-onnx", "kokoro-v1.0.onnx"), hf_hub_download("fastrtc/kokoro-onnx", "voices-v1.0.bin"))
    asr = WhisperModel("small.en", device="cpu", compute_type="int8")
    audio, words, t, i = [np.zeros(int(0.12 * SR), "float32")], [], 0.12, 0
    for line in n["lines"]:
        x, sr = k.create(line.get("say", line["text"]), voice=cfg.get("voice", "am_michael"), speed=line.get("speed", cfg.get("speed", 1.0)), lang="en-us")
        x = resample(trim(x, sr), sr); dur = len(x) / SR
        script = [w for w in line["text"].replace("—", " ").split() if norm(w)]
        heard = []
        if len(script) > 1:
            segs, _ = asr.transcribe(resample_to(x, 16000), word_timestamps=True, condition_on_previous_text=False)
            heard = [(norm(w.word), float(w.start), float(w.end)) for s in segs for w in s.words if norm(w.word)]
        times = [None] * len(script)
        sm = difflib.SequenceMatcher(None, [norm(w) for w in script], [h[0] for h in heard], autojunk=False)
        for a, b, m in sm.get_matching_blocks():
            for j in range(m): times[a + j] = (heard[b + j][1], heard[b + j][2])
        # words whisper missed take the measured gap between their neighbours (never a text-length guess)
        for j in range(len(script)):
            if times[j] is None:
                prev = next((times[q][1] for q in range(j - 1, -1, -1) if times[q]), 0.0)
                nxt = next((times[q][0] for q in range(j + 1, len(script)) if times[q]), dur)
                run = [q for q in range(j, len(script)) if times[q] is None and all(times[r] is None for r in range(j, q + 1))]
                step = (nxt - prev) / len(run)
                for r, q in enumerate(run): times[q] = (prev + r * step, prev + (r + 1) * step)
        for w, (a, b) in zip(script, times):
            a, b = min(max(a, 0), dur), min(max(b, 0), dur)
            words.append({"i": i, "text": w, "norm": norm(w), "start": round(t + a, 3), "end": round(t + max(b, a + 0.04), 3), "match": "exact", "line": line.get("id")}); i += 1
        audio.append(x); t += dur
        pause = line.get("pauseMs", cfg.get("pauseMs", 200)) / 1000
        audio.append(np.zeros(int(pause * SR), "float32")); t += pause
    y = np.concatenate(audio[:-1])
    y = y / (np.abs(y).max() + 1e-9) * 0.7
    out = Path(out_dir); out.mkdir(parents=True, exist_ok=True)
    sf.write(str(out / "narration.wav"), y, SR, subtype="PCM_16")
    doc = {"standIn": True, "voice": "kokoro " + cfg.get("voice", "am_michael") + " (NOT the approved Hold Up narrator)", "durationSec": round(len(y) / SR, 3), "words": words}
    (out / "words.json").write_text(json.dumps(doc, indent=1))
    print(f"stand-in narration: {len(y)/SR:.2f}s, {len(words)} words")

def resample_to(x, r):
    from scipy.signal import resample_poly
    from math import gcd
    g = gcd(SR, r); return resample_poly(x, r // g, SR // g).astype("float32")

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
