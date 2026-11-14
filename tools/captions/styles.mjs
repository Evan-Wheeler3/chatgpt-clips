/*
 * Caption style presets. Sizes are in pixels at 1080 x 1920 and scale with the frame; times are in seconds.
 * The Hold Up style: bold, clean, warm. White words with a dark ink stroke (the characters' outline colour) and a soft
 * shadow, the spoken word in the channel's warm amber with a small scale, groups that pop in gently and fade between.
 */
export const CAPTION_STYLES = {
  'hold-up':{
    font:{family:'"Avenir Next", "Helvetica Neue", Arial, sans-serif', weight:800, sizePx:74, lineHeight:1.12, letterSpacing:0.5, wordGap:0.14, uppercase:false},
    fill:'#FFFFFF', stroke:{color:'#1E1A16', widthPx:11}, shadow:{color:'rgba(20,14,10,0.55)', blurPx:10, offsetYPx:5},
    highlight:{mode:'color', color:'#FFC547', scale:1.06},
    emphasis:{color:'#FFC547', scale:1.12, persist:true},
    grouping:{minWords:2, maxWords:5, maxChars:24, softGapSec:0.28, weakEndings:['a', 'an', 'the', 'to', 'of', 'and', 'in', 'on', 'at', 'for', 'with', 'is']},
    timing:{leadSec:0.08, holdSec:0.6, gapHideSec:0.9},
    animation:{enter:'pop-in', enterSec:0.14, enterScale:0.9, exit:'fade', exitSec:0.12, wordScaleSec:0.08},
    layout:{maxWidth:0.72, centerX:0.47, bands:{lower:0.68, upper:0.24, middle:0.5}, default:'lower', maxLines:2,
      safe:{left:0.09, right:0.86, top:0.11, bottom:0.77}}
  },
  // The Phase 4-6.1 review overlay, kept for comparisons
  'legacy-hud':{
    font:{family:'sans-serif', weight:700, sizePx:45, lineHeight:1.27, letterSpacing:0, uppercase:false},
    fill:'#FFFFFF', stroke:{color:'#000000', widthPx:0}, shadow:{color:'rgba(0,0,0,0.6)', blurPx:0, offsetYPx:3},
    highlight:{mode:'color', color:'#facc15', scale:1}, emphasis:null,
    grouping:{sentence:true, minWords:1, maxWords:40, maxChars:200, softGapSec:99, weakEndings:[]},
    timing:{leadSec:0, holdSec:0.15, gapHideSec:99},
    animation:{enter:'none', enterSec:0, enterScale:1, exit:'none', exitSec:0, wordScaleSec:0},
    layout:{maxWidth:0.8, centerX:0.5, bands:{lower:0.79}, default:'lower', maxLines:4, safe:{left:0.1, right:0.9, top:0.1, bottom:0.98}}
  }
};

// A story can name a preset and override any field: {"captions": {"style": "hold-up", "font": {"sizePx": 72}}}
export function resolveStyle(config = {}) {
  const base = CAPTION_STYLES[config.style ?? 'hold-up'];
  if (!base) throw new Error(`Unknown caption style "${config.style}" (${Object.keys(CAPTION_STYLES).join(', ')})`);
  const merge = (a, b) => b === undefined ? a : (a && typeof a === 'object' && !Array.isArray(a) && b && typeof b === 'object' && !Array.isArray(b)) ? Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(k => [k, merge(a[k], b[k])])) : b;
  const {style, enabled, emphasize, shots, ...overrides} = config;
  return {name:config.style ?? 'hold-up', ...merge(base, overrides)};
}
