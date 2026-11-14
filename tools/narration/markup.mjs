/*
 * Provider-neutral delivery markup. Scripts keep their words; markup only shapes delivery:
 *   [[slnc 350]]        an intentional pause of 350 ms (the existing barrel-bilge markup)
 *   [[emph +]]          emphasise the next word
 *   [[tone amused]]     a speaking style for what follows, where the model supports it (ElevenLabs v3/v4 audio tags)
 * parseScript() splits a script into tokens; each provider renders them its own way. Words are never changed.
 */
export function parseScript(script) {
  const tokens = [];
  const re = /\[\[\s*(slnc|emph|tone)\s+([^\]]*?)\s*\]\]|(\S+)/g;
  let m, emphasise = false;
  while ((m = re.exec(String(script)))) {
    if (m[1] === 'slnc') tokens.push({type:'pause', ms:Number(m[2])});
    else if (m[1] === 'emph') emphasise = m[2].trim() !== '-';
    else if (m[1] === 'tone') tokens.push({type:'tone', tag:m[2].trim()});
    else { tokens.push({type:'word', text:m[3], emphasis:emphasise}); emphasise = false; }
  }
  return tokens;
}

export const spokenWords = script => parseScript(script).filter(t => t.type === 'word').map(t => t.text);
export const plainText = script => spokenWords(script).join(' ');

// The marked pauses after each spoken word (index in the spoken word list -> ms), for checking they survive delivery
export function markedPauses(script) {
  const out = [];
  let index = -1;
  for (const t of parseScript(script)) {
    if (t.type === 'word') index++;
    else if (t.type === 'pause' && index >= 0) out.push({afterWord:index, ms:t.ms});
  }
  return out;
}

/*
 * Render for a target. delivery: {minPauseMs (shorter marked pauses are left to punctuation), pauseScale, maxPauseMs}
 *   'macos-say'        [[slnc N]] [[emph +]] as authored
 *   'ssml-break'       <break time="0.35s" /> (ElevenLabs Multilingual v2 / Flash); emphasis has no tag, so the word is kept as is
 *   'audio-tags'       ElevenLabs v3/v4: no break tags; long pauses become an ellipsis, tones become [tag] audio tags
 *   'plain'            words only
 */
export function renderScript(script, target, {minPauseMs = 0, pauseScale = 1, maxPauseMs = 3000} = {}) {
  const parts = [];
  for (const t of parseScript(script)) {
    if (t.type === 'word') parts.push(target === 'macos-say' && t.emphasis ? `[[emph +]] ${t.text}` : t.text);
    else if (t.type === 'pause') {
      // Short marked pauses are left to punctuation; the deliberate ones are kept, scaled for the voice
      if (t.ms < minPauseMs) continue;
      const ms = Math.min(maxPauseMs, Math.round(t.ms * pauseScale));
      if (target === 'macos-say') parts.push(`[[slnc ${ms}]]`);
      else if (target === 'ssml-break') parts.push(`<break time="${(ms / 1000).toFixed(2)}s" />`);
      else if (target === 'audio-tags' && ms >= 500 && parts.length && !/[.…!?]$/.test(parts.at(-1))) parts[parts.length - 1] += '…';
    } else if (t.type === 'tone' && target === 'audio-tags') parts.push(`[${t.tag}]`);
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}
