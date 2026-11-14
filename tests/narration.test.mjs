import {test} from 'node:test';
import assert from 'node:assert/strict';
import { alignWords, spokenText, scriptWords } from '../tools/narration/align.mjs';
import { speechIslands, placeInIsland } from '../tools/narration/vad.mjs';

const heard = (...entries) => entries.map(([text, start, end]) => ({text, start, end}));

test('spoken text drops engine markup and alignment keeps measured timings', () => {
  assert.equal(spokenText('Why? [[slnc 300]] The [[emph +]] bilge.').replace(/\s+/g, ' ').trim(), 'Why? The bilge.');
  assert.deepEqual(scriptWords('Why? [[slnc 300]] The bilge.'), ['Why?', 'The', 'bilge.']);
  const {words, quality} = alignWords('Why do barrels bulge?', heard(['Why', 0, 0.2], ['do', 0.2, 0.3], ['barrels', 0.3, 0.8], ['bulge?', 0.8, 1.2]));
  assert.deepEqual(words.map(w => [w.text, w.start, w.end, w.match]), [['Why', 0, 0.2, 'exact'], ['do', 0.2, 0.3, 'exact'], ['barrels', 0.3, 0.8, 'exact'], ['bulge?', 0.8, 1.2, 'exact']]);
  assert.equal(quality.exactRatio, 1);
});

test('substitutions keep the recognised timing, missing words are bounded by neighbours, extras extend spans', () => {
  const sub = alignWords('the hoops hold', heard(['the', 0, 0.1], ['hoop', 0.1, 0.4], ['hold', 0.4, 0.7]));
  assert.deepEqual([sub.words[1].match, sub.words[1].recognized, sub.words[1].start], ['substitution', 'hoop', 0.1]);

  const gap = alignWords('one two three four five six seven eight nine ten eleven', heard(...['one', 'two', 'three', 'four', 'five', 'seven', 'eight', 'nine', 'ten', 'eleven'].map((w, i) => [w, i, i + 0.8])));
  const six = gap.words.find(w => w.text === 'six');
  assert.equal(six.match, 'unaligned');
  assert.equal(six.timing, 'bounded-by-neighbours');
  assert.deepEqual([six.start, six.end], [4.8, 5]); // Between "five" ending and "seven" starting; no invented duration

  const extra = alignWords('roll it', heard(['roll', 0, 0.3], ['uh', 0.3, 0.5], ['it', 0.5, 0.7]));
  assert.equal(extra.words[0].end, 0.5);
  assert.equal(extra.quality.extraRecognized, 1);

  assert.throws(() => alignWords('a completely different sentence entirely', heard(['hello', 0, 1])), /Alignment failed/);
});

function tone(seconds, sampleRate, amplitude = 8000) {
  return Array.from({length:Math.round(seconds * sampleRate)}, (_, i) => Math.round(amplitude * Math.sin(i / sampleRate * 2 * Math.PI * 220)));
}
const silence = (seconds, sampleRate) => Array.from({length:Math.round(seconds * sampleRate)}, () => 0);

test('speech islands are measured from audio energy and short gaps do not split words', () => {
  const sr = 16000;
  const pcm = Int16Array.from([...silence(0.1, sr), ...tone(0.5, sr), ...silence(0.3, sr), ...tone(0.4, sr), ...silence(0.08, sr), ...tone(0.3, sr), ...silence(0.2, sr)]);
  const {islands} = speechIslands(pcm, sr);
  assert.equal(islands.length, 2);
  assert.ok(Math.abs(islands[0].start - 0.1) < 0.02 && Math.abs(islands[0].end - 0.6) < 0.02);
  assert.ok(Math.abs(islands[1].start - 0.9) < 0.02 && Math.abs(islands[1].end - 1.68) < 0.02); // The 80 ms gap stays inside
  assert.deepEqual(speechIslands(new Int16Array(0), sr).islands, []);
});

test('recognised words are clamped into their island so none starts inside a pause', () => {
  const placed = placeInIsland(heard(['Iron', 0, 0.3], ['hoops', 0.3, 0.9]), {start:4.9, end:5.6}, 4.7);
  assert.deepEqual(placed.map(w => [w.start, w.end]), [[4.9, 5], [5, 5.6]]);
});
