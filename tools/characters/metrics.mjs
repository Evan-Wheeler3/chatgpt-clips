// Turns per-frame character pixel metrics into review warnings; thresholds are triggers, not verdicts
export const METRIC_LIMITS = {edgeContrast:0.1, colorContrast:12, headPoints:16, colorDrift:16};

export function judgeCharacterMetrics(frames, limits = METRIC_LIMITS) {
  const warnings = [];
  const byCharacter = new Map();
  for (const f of frames) for (const c of f.characters) {
    if (!c.visible) continue;
    (byCharacter.get(c.id) ?? byCharacter.set(c.id, []).get(c.id)).push({...c, frame:f.frame, shot:f.shot});
    const at = `${c.id} f${f.frame}`;
    if (c.edgeContrast < limits.edgeContrast) warnings.push({code:'CHARACTER_WEAK_SILHOUETTE', shot:f.shot, frame:f.frame, message:`${at}: silhouette edge contrast ${c.edgeContrast.toFixed(3)}`});
    if (c.colorContrast < limits.colorContrast) warnings.push({code:'CHARACTER_BLENDS_IN', shot:f.shot, frame:f.frame, message:`${at}: body vs surroundings ΔE ${c.colorContrast.toFixed(1)}`});
    if (c.pieces > 1) warnings.push({code:'CHARACTER_DETACHED_PARTS', shot:f.shot, frame:f.frame, message:`${at}: silhouette splits into ${c.pieces} pieces`});
    if (c.headPoints < limits.headPoints) warnings.push({code:'FACE_TOO_SMALL_ON_PHONE', shot:f.shot, frame:f.frame, message:`${at}: head is ${c.headPoints.toFixed(0)} pt tall on a phone`});
  }
  const summary = {};
  for (const [id, list] of byCharacter) {
    const mean = k => list.reduce((s, c) => s + c[k], 0) / list.length;
    // Colour drift between shots: the same character should not change colour across cuts
    const shots = [...new Set(list.map(c => c.shot))].map(shot => { const l = list.filter(c => c.shot === shot); return l[0].lab.map((_, k) => l.reduce((s, c) => s + c.lab[k], 0) / l.length); });
    let drift = 0;
    for (let i = 1; i < shots.length; i++) drift = Math.max(drift, Math.hypot(...shots[i].map((v, k) => v - shots[i - 1][k])));
    if (drift > limits.colorDrift) warnings.push({code:'CHARACTER_COLOR_SHIFT', message:`${id}: interior colour changes by ΔE ${drift.toFixed(1)} between shots`});
    summary[id] = {frames:list.length, edgeContrast:+mean('edgeContrast').toFixed(3), colorContrast:+mean('colorContrast').toFixed(1),
      minHeadPoints:+Math.min(...list.map(c => c.headPoints)).toFixed(1), maxPieces:Math.max(...list.map(c => c.pieces)), colorDriftBetweenShots:+drift.toFixed(1)};
  }
  return {status:warnings.length ? 'review' : 'pass', warnings, summary};
}
