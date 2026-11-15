import test from 'node:test';
import assert from 'node:assert/strict';
import { measurePace, scratchWords } from '../tools/episode-check.mjs';

test('measurePace reads letters per second, sentence gaps, lead-in and tail from a take', () => {
  const words = [
    {text:'Hold', start:0.5, end:0.75}, {text:'up.', start:0.75, end:1.0},
    {text:'Look', start:1.5, end:1.75}, {text:'here.', start:1.75, end:2.0}
  ];
  const pace = measurePace(words, 2.2);
  assert.equal(pace.leadInSec, 0.5);
  assert.equal(+pace.sentenceGapSec.toFixed(2), 0.5);
  assert.equal(+pace.tailSec.toFixed(2), 0.2);
  assert.equal(+pace.lettersPerSec.toFixed(1), 14); // 14 letters over 1.0 s of speech
});

test('scratchWords builds an ordered timeline with sentence gaps and no markup', () => {
  const pace = {lettersPerSec:10, sentenceGapSec:0.4, leadInSec:0.6, tailSec:0};
  const {words, durationSec} = scratchWords('How does it [[emph +]] stop? It doesn\'t.', pace);
  assert.deepEqual(words.map(w => w.text), ['How', 'does', 'it', 'stop?', 'It', "doesn't."]);
  assert.equal(words[0].start, 0.6);
  words.forEach((w, i) => { assert.ok(w.end > w.start); if (i) assert.ok(w.start >= words[i - 1].end); });
  assert.ok(words[4].start - words[3].end >= 0.4 - 1e-9);
  assert.equal(durationSec, +(words.at(-1).end + 0.5).toFixed(2));
});
