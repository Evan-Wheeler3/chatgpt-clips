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

test('endingReport flags a last word that is cut off and measures the silence after it', async () => {
  const { endingReport } = await import('../tools/narration/narrate.mjs');
  const wav = samples => {
    const data = Buffer.alloc(samples.length * 2);
    samples.forEach((v, i) => data.writeInt16LE(Math.round(v * 32767), i * 2));
    const head = Buffer.alloc(44);
    head.write('RIFF', 0); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8); head.write('fmt ', 12);
    head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(1, 22); head.writeUInt32LE(48000, 24);
    head.writeUInt32LE(96000, 28); head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write('data', 36); head.writeUInt32LE(data.length, 40);
    return Buffer.concat([head, data]);
  };
  const tone = (n, amp) => Array.from({length:n}, (_, i) => amp * Math.sin(i / 7));
  const words = [{text:'hole.', start:0.5, end:0.98}];
  const cut = endingReport(wav(tone(48000, 0.3)), words);
  assert.equal(cut.cut, true); assert.equal(cut.fileEndSec, 1); assert.equal(cut.silenceAfterLastWordSec, 0.02);
  const decayed = endingReport(wav([...tone(46000, 0.3), ...Array(2000).fill(0)]), words);
  assert.equal(decayed.cut, false); assert.ok(decayed.finalDb < -100);
});
