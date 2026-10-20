// Shared payload normalisers — backend/ML shapes vary slightly, keep UI robust.
export function normalizeList(payload, keys = ['items', 'analyses', 'history', 'data', 'results']) {
  if (Array.isArray(payload)) return payload;
  for (const k of keys) if (Array.isArray(payload?.[k])) return payload[k];
  return [];
}
export function itemId(item, fallback = '') {
  return item?.id ?? item?._id ?? fallback;
}
export function normalizePredictions(payload) {
  const raw = payload?.top3 || payload?.predictions || payload?.top_predictions || payload?.topPredictions;
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => {
    if (typeof p === 'string') return { label: p, probability: 0 };
    let prob = typeof p.probability === 'number' ? p.probability
      : typeof p.confidence === 'number' ? p.confidence
      : typeof p.score === 'number' ? p.score : 0;
    if (prob > 1) prob = prob / 100;
    return { label: p.label || p.class || p.name || p.class_name || 'Unknown', probability: prob };
  });
}
export function topClassOf(item) {
  return item?.topClass || item?.top_class || item?.topClassName || normalizePredictions(item)[0]?.label || 'Unknown';
}
export function riskOf(item) {
  const r = item?.overall_risk_tier || item?.riskTier || item?.risk_tier || item?.risk;
  if (r) {
    const s = String(r).toLowerCase();
    if (s.includes('high')) return 'High';
    if (s.includes('mod') || s.includes('medium')) return 'Moderate';
    if (s.includes('low')) return 'Low';
  }
  return null; // caller may fall back to riskTierFor(topClass)
}
export function formatDate(value) {
  if (!value) return 'Unknown date';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function pct(prob) { return `${Math.round((prob || 0) * 100)}%`; }
