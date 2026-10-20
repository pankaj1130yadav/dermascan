import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSamples, sampleImageUrl, analyzeImage } from '../api.js';
import { normalizeList, normalizePredictions } from '../utils/normalize.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n.jsx';

function TopLine({ modelName, data }) {
  if (!data) return null;
  const preds = normalizePredictions(data);
  const top = preds[0];
  const topClass = data.top_class || top?.label;
  const prob = top?.probability;
  if (!topClass) return null;
  return <p><strong>{modelName}:</strong> {topClass}{typeof prob === 'number' && prob ? ` (${Math.round(prob * 100)}%)` : ''}{data.overall_risk_tier ? ` · ${data.overall_risk_tier} risk` : ''}</p>;
}

export default function Gallery() {
  const { t } = useLang();
  const { isAuthenticated } = useAuth();
  const [samples, setSamples] = useState([]);
  const [error, setError] = useState(null);
  const [live, setLive] = useState({}); // id -> {preds} | {error:true}
  const [busy, setBusy] = useState('');
  useEffect(() => { (async () => { try { setSamples(normalizeList(await fetchSamples(), ['samples', 'items', 'data'])); } catch { setError('Sample gallery is unavailable — the ML service appears to be offline.'); } })(); }, []);

  const trySample = async (s) => {
    setBusy(s.id || s.file);
    try {
      const res = await fetch(sampleImageUrl(s.file));
      if (!res.ok) throw new Error('fetch');
      const blob = await res.blob();
      const file = new File([blob], (s.file || 'sample.jpg').split('/').pop(), { type: blob.type || 'image/jpeg' });
      const data = await analyzeImage(file, { model: 'mobilenet' });
      setLive((m) => ({ ...m, [s.id || s.file]: { preds: normalizePredictions(data) } }));
    } catch {
      setLive((m) => ({ ...m, [s.id || s.file]: { error: true } }));
    } finally { setBusy(''); }
  };

  return (
    <div className="container"><section className="section">
      <p className="eyebrow">Dataset samples</p>
      <h1 className="section__title">{t('gallery_title')}</h1>
      <p className="section__lede">{t('gallery_lede')}</p>
      <p className="muted">Sample images from HAM10000 / ISIC Archive, CC BY-NC 4.0 — labels are the dataset&apos;s ground truth.</p>
      {error && <div className="alert alert--error" role="alert"><p>{error}</p></div>}
      <div className="lesion-grid">
        {samples.map((s) => {
          const key = s.id || s.file;
          const lv = live[key];
          return (
            <article key={key} className="lesion-card">
              <img src={sampleImageUrl(s.file)} alt={`HAM10000 sample: ${s.true_name || s.true_class || ''}`} className="gallery-img" loading="lazy" />
              <p><span className="badge">Dataset label: {s.true_name || s.true_class} (HAM10000)</span></p>
              <details>
                <summary>Sample result (computed earlier)</summary>
                <TopLine modelName="MobileNetV2" data={s.mobilenet} />
                <TopLine modelName="EfficientNet-B0" data={s.efficientnet} />
                {!s.mobilenet && !s.efficientnet && <p className="muted">No precomputed result for this sample.</p>}
              </details>
              {isAuthenticated ? (
                <button type="button" className="btn btn--primary btn--sm" disabled={busy === key} onClick={() => trySample(s)}>{busy === key ? 'Analyzing…' : 'Try this sample'}</button>
              ) : <Link to="/login" className="btn btn--ghost btn--sm">Log in to try this sample</Link>}
              {lv?.preds && <div className="live-result"><strong>Live result:</strong>{lv.preds.slice(0, 3).map((p, i) => <p key={i}>{i + 1}. {p.label} — {Math.round(p.probability * 100)}%</p>)}</div>}
              {lv?.error && <p className="alert-inline">Live analysis failed — services may be offline. The precomputed sample result above is still shown.</p>}
              {s.attribution && <p className="muted gallery-attrib">{s.attribution}</p>}
            </article>
          );
        })}
      </div>
    </section></div>
  );
}
