// Aligns the authored script to recognised words so every script word carries measured audio timing
export const normalizeWord = word => String(word).toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, '');
// Strips engine markup such as macOS say's [[slnc 300]] so only spoken words remain
export const spokenText = script => String(script).replace(/\[\[[^\]]*\]\]/g, ' ');
export const scriptWords = script => spokenText(script).split(/\s+/).filter(word => normalizeWord(word));

export function alignWords(script, recognized, {maxUnalignedRatio = 0.1} = {}) {
  const words = scriptWords(script);
  const a = words.map(normalizeWord), b = recognized.map(word => normalizeWord(word.text));
  // Edit-distance alignment: match 0, substitute 1, insert/delete 1
  const cost = Array.from({length:a.length + 1}, (_, i) => Array.from({length:b.length + 1}, (_, j) => i + j));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    cost[i][j] = Math.min(cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1), cost[i - 1][j] + 1, cost[i][j - 1] + 1);
  }
  const pairs = [];
  for (let i = a.length, j = b.length; i > 0 || j > 0;) {
    if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)) pairs.unshift([--i, --j]);
    else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) pairs.unshift([--i, null]);
    else pairs.unshift([null, --j]);
  }

  const out = words.map((text, i) => ({i, text, norm:a[i], start:null, end:null, match:'unaligned'}));
  let extra = 0, lastScript = null;
  for (const [i, j] of pairs) {
    if (i !== null && j !== null) {
      Object.assign(out[i], {start:recognized[j].start, end:recognized[j].end, match:a[i] === b[j] ? 'exact' : 'substitution'});
      if (a[i] !== b[j]) out[i].recognized = recognized[j].text;
      lastScript = i;
    } else if (i === null) {
      extra++; // An extra recognised word extends the previous script word's measured span rather than being dropped
      if (lastScript !== null) out[lastScript].end = Math.max(out[lastScript].end, recognized[j].end);
    } else lastScript = i;
  }
  // Unaligned script words get the measured gap between their aligned neighbours, never an invented duration
  for (const word of out) if (word.match === 'unaligned') {
    const before = out.slice(0, word.i).reverse().find(other => other.start !== null);
    const after = out.slice(word.i + 1).find(other => other.start !== null);
    word.start = before ? before.end : 0;
    word.end = after ? after.start : before?.end ?? 0;
    word.timing = 'bounded-by-neighbours';
  }
  const counts = {scriptWords:words.length, recognizedWords:recognized.length, exact:0, substitution:0, unaligned:0, extraRecognized:extra};
  for (const word of out) counts[word.match]++;
  const ratio = words.length ? counts.unaligned / words.length : 1;
  if (ratio > maxUnalignedRatio) throw new Error(`Alignment failed: ${counts.unaligned}/${words.length} script words were not found in the audio`);
  return {words:out, quality:{...counts, exactRatio:Math.round(counts.exact / Math.max(1, words.length) * 1000) / 1000}};
}
