import { normalizeWord } from '../narration/align.mjs';

/*
 * Anchors tie shots and events to measured narration words instead of seconds:
 *   "bulge"            the only occurrence of a word (ambiguous words are an error)
 *   "bulge#2"          the second occurrence
 *   "on the spot"      a phrase; the anchor is its first word (or last, with edge:"end")
 *   {at:"roll", edge:"end", offset:0.1}
 */
export function resolveAnchor(words, anchor, fps) {
  const spec = typeof anchor === 'string' ? {at:anchor} : anchor ?? {};
  if (typeof spec.at !== 'string' || !spec.at.trim()) throw new Error(`Invalid anchor: ${JSON.stringify(anchor)}`);
  const [phraseText, occurrenceText] = spec.at.split('#');
  const phrase = phraseText.split(/\s+/).map(normalizeWord).filter(Boolean);
  if (!phrase.length) throw new Error(`Anchor has no words: ${spec.at}`);
  const matches = [];
  for (let i = 0; i + phrase.length <= words.length; i++) {
    if (phrase.every((word, k) => normalizeWord(words[i + k].text) === word)) matches.push(i);
  }
  if (!matches.length) throw new Error(`Anchor "${spec.at}" is not in the narration`);
  const occurrence = occurrenceText ? Number(occurrenceText) : null;
  if (occurrence === null && matches.length > 1) throw new Error(`Anchor "${spec.at}" occurs ${matches.length} times; use "${phraseText}#n"`);
  const first = matches[(occurrence ?? 1) - 1];
  if (first === undefined) throw new Error(`Anchor "${spec.at}" has only ${matches.length} occurrence(s)`);
  const index = spec.edge === 'end' ? first + phrase.length - 1 : first;
  const time = (spec.edge === 'end' ? words[index].end : words[index].start) + (spec.offset ?? 0);
  return {wordIndex:index, word:words[index].text, time, frame:Math.round(time * fps), edge:spec.edge ?? 'start'};
}
