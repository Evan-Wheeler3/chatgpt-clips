// Energy-based speech/silence segmentation of mono 16-bit PCM; deterministic and measured from the audio itself
export function speechIslands(samples, sampleRate, {windowSec = 0.01, minSilenceSec = 0.15, minSpeechSec = 0.05, relativeThreshold = 0.03} = {}) {
  const win = Math.max(1, Math.round(sampleRate * windowSec));
  const energy = [];
  for (let i = 0; i + win <= samples.length; i += win) {
    let sum = 0;
    for (let k = 0; k < win; k++) sum += samples[i + k] * samples[i + k];
    energy.push(Math.sqrt(sum / win));
  }
  if (!energy.length) return {islands:[], threshold:0};
  const sorted = [...energy].sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.1)];
  // Relative to peak for clean TTS, and above the noise floor for room recordings
  const threshold = Math.max(sorted[sorted.length - 1] * relativeThreshold, noiseFloor * 3, 1);
  const loud = energy.map(value => value >= threshold);
  const minSilence = Math.round(minSilenceSec / windowSec);
  const islands = [];
  let start = null, quiet = 0;
  loud.forEach((isLoud, i) => {
    if (isLoud) {
      if (start === null) start = i;
      quiet = 0;
    } else if (start !== null && ++quiet >= minSilence) {
      islands.push([start, i - quiet + 1]);
      start = null; quiet = 0;
    }
  });
  if (start !== null) islands.push([start, loud.length - quiet]);
  return {
    threshold,
    islands:islands.filter(([a, b]) => (b - a) * windowSec >= minSpeechSec).map(([a, b]) => ({start:Math.round(a * windowSec * 1000) / 1000, end:Math.round(b * windowSec * 1000) / 1000}))
  };
}

// Clamps recognised words into the island they were transcribed from, so no word ever starts inside a measured pause
export function placeInIsland(words, island, offset) {
  return words.map(word => {
    const start = Math.min(Math.max(word.start + offset, island.start), island.end);
    const end = Math.min(Math.max(word.end + offset, start), island.end);
    return {...word, start:Math.round(start * 1000) / 1000, end:Math.round(end * 1000) / 1000};
  });
}
