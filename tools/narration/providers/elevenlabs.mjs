import { renderScript } from '../markup.mjs';

/*
 * ElevenLabs text-to-speech, per the official API reference (read 2026-11-14):
 *   POST {base}/v1/text-to-speech/{voice_id}/with-timestamps   (header xi-api-key; JSON {text, model_id, voice_settings, seed, ...})
 *     -> {audio_base64, alignment:{characters, character_start_times_seconds, character_end_times_seconds}, normalized_alignment}
 *   GET  {base}/v2/voices                                      voice discovery (free)
 *   GET  {base}/v1/user/subscription                           usage: character_count / character_limit (free)
 * Pricing (https://elevenlabs.io/pricing/api): billed per character in USD. Estimates use the published per-1K rates below;
 * the provider's own character-cost response header, when present, is logged as the actual figure.
 */
export const PRICING = {
  source:'https://elevenlabs.io/pricing/api (read 2026-11-14)',
  usdPer1kChars:{eleven_v4:0.08, eleven_v4_turbo:0.04, eleven_v3:0.08, eleven_v3_conversational:0.04, eleven_multilingual_v2:0.08, eleven_flash_v2_5:0.04, eleven_flash_v2:0.04}
};
export const DEFAULT_BASE = 'https://api.elevenlabs.io';
// v3/v4 do not support SSML break tags but do support audio tags; the v2 and Flash models take <break time="..."/>
export const markupTarget = modelId => /^eleven_v[34]/.test(modelId) ? 'audio-tags' : 'ssml-break';
const SETTINGS = ['stability', 'similarity_boost', 'style', 'use_speaker_boost', 'speed'];

export class ProviderError extends Error {
  constructor(message, {code, status = null, retryable = false} = {}) { super(message); this.name = 'ProviderError'; this.code = code; this.status = status; this.retryable = retryable; }
}

// Character timings -> word timings. Markup the model does not speak (<break .../>, [audio tags]) is skipped
export function wordsFromAlignment(alignment) {
  if (!alignment?.characters?.length) return null;
  const {characters:chars, character_start_times_seconds:starts, character_end_times_seconds:ends} = alignment;
  const words = [];
  let current = null, closing = null;
  const flush = () => { if (current) words.push(current); current = null; };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (closing) { if (ch === closing) closing = null; continue; }
    if (ch === '<' || ch === '[') { flush(); closing = ch === '<' ? '>' : ']'; continue; }
    if (/\s/.test(ch)) { flush(); continue; }
    if (!current) current = {text:'', start:starts[i], end:ends[i]};
    current.text += ch; current.end = ends[i];
  }
  flush();
  return words.filter(w => /[\p{L}\p{N}]/u.test(w.text));
}

async function failure(response) {
  let body = '';
  try { body = await response.text(); } catch { /* ignore */ }
  let detail = body;
  try { const json = JSON.parse(body); detail = Array.isArray(json.detail) ? json.detail.map(d => d.msg).join('; ') : json.detail?.message ?? json.detail?.status ?? json.message ?? body; } catch { /* not JSON */ }
  detail = String(detail).slice(0, 300);
  const s = response.status;
  if (s === 401) return new ProviderError(`ElevenLabs rejected the API key (401). Check ELEVENLABS_API_KEY in .env. ${detail}`, {code:'auth', status:s});
  if (s === 403) return new ProviderError(`ElevenLabs refused the request (403): the key may lack permission, or the IP is not allowlisted. ${detail}`, {code:'forbidden', status:s});
  if (s === 422 || s === 400) return new ProviderError(`ElevenLabs could not process the request (${s}): ${detail}`, {code:'validation', status:s});
  if (s === 429 || /quota|credits|limit/i.test(detail)) return new ProviderError(`ElevenLabs limit reached (${s}): ${detail}. Wait and retry, or check the plan's quota and concurrency.`, {code:/quota|credit/i.test(detail) ? 'quota' : 'rate-limit', status:s, retryable:true});
  return new ProviderError(`ElevenLabs request failed (${s}): ${detail}`, {code:'server', status:s, retryable:s >= 500});
}

export function createElevenLabs({apiKey, base = DEFAULT_BASE, fetch:fetchImpl = globalThis.fetch} = {}) {
  const call = async (method, path, body) => {
    if (!apiKey) throw new ProviderError('ELEVENLABS_API_KEY is not set: copy .env.example to .env and add the key (https://elevenlabs.io/app/settings/api-keys)', {code:'missing-key'});
    let response;
    try {
      response = await fetchImpl(`${base}${path}`, {method, headers:{'xi-api-key':apiKey, 'content-type':'application/json', accept:'application/json'}, body:body ? JSON.stringify(body) : undefined});
    } catch (err) { throw new ProviderError(`Could not reach ElevenLabs: ${err.message}`, {code:'network', retryable:true}); }
    if (!response.ok) throw await failure(response);
    return response;
  };
  return {
    id:'elevenlabs', paid:true,
    render:(script, profile) => renderScript(script, markupTarget(profile.modelId), profile.delivery),
    estimate(text, profile) {
      const rate = PRICING.usdPer1kChars[profile.modelId];
      if (rate === undefined) throw new ProviderError(`No published price for model "${profile.modelId}" in PRICING; add it from ${PRICING.source} before generating`, {code:'unknown-model'});
      return {characters:text.length, usd:Math.round(text.length / 1000 * rate * 10000) / 10000, rateUsdPer1k:rate, source:PRICING.source};
    },
    cacheKey:(text, profile) => ({provider:'elevenlabs', voiceId:profile.voiceId, modelId:profile.modelId, settings:profile.settings ?? {}, seed:profile.seed ?? null, outputFormat:profile.outputFormat ?? 'mp3_44100_128', text}),
    async synthesize(text, profile) {
      if (!profile.voiceId) throw new ProviderError(`Voice profile ${profile.id} has no voiceId`, {code:'validation'});
      const settings = Object.fromEntries(Object.entries(profile.settings ?? {}).filter(([k]) => SETTINGS.includes(k)));
      const format = profile.outputFormat ?? 'mp3_44100_128';
      const response = await call('POST', `/v1/text-to-speech/${encodeURIComponent(profile.voiceId)}/with-timestamps?output_format=${format}`, {
        text, model_id:profile.modelId, voice_settings:Object.keys(settings).length ? settings : undefined, seed:profile.seed ?? undefined, apply_text_normalization:profile.textNormalization ?? 'auto'
      });
      const json = await response.json();
      if (!json.audio_base64) throw new ProviderError('ElevenLabs returned no audio', {code:'server'});
      return {
        audio:Buffer.from(json.audio_base64, 'base64'), extension:format.split('_')[0] === 'pcm' ? 'pcm' : format.split('_')[0],
        words:wordsFromAlignment(json.alignment ?? json.normalized_alignment),
        response:{requestId:response.headers.get('request-id'), characterCost:response.headers.get('character-cost')}
      };
    },
    async listVoices(params = {}) {
      // Array parameters (voice_ids, use_cases, language) repeat the key
      const query = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined).flatMap(([k, v]) => Array.isArray(v) ? v.map(x => [k, String(x)]) : [[k, String(v)]]));
      return (await call('GET', `/v2/voices?${query}`)).json();
    },
    async subscription() { return (await call('GET', '/v1/user/subscription')).json(); }
  };
}
