import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { fetchShared, resolveApiUrl } from '../api.js';
import { normalizePredictions, formatDate, pct } from '../utils/normalize.js';
import Disclaimer from '../components/Disclaimer.jsx';

export default function Shared() {
  const { token } = useParams();
  const [item, setItem] = useState(null);
  const [status, setStatus] = useState('loading');
  useEffect(() => { (async () => {
    try { const r = await fetchShared(token); setItem(r?.analysis || r?.item || r?.data || r); setStatus('ready'); }
    catch { setStatus('notfound'); }
  })(); }, [token]);
  if (status === 'loading') return <div className="container"><section className="section"><p className="muted">Loading shared result…</p></section></div>;
  if (status === 'notfound' || !item) return <div className="container"><section className="section"><h1 className="section__title">This shared result is not available</h1><p className="section__lede">The link may have expired or never existed. Ask the person who shared it for a fresh link.</p></section></div>;
  const preds = normalizePredictions(item).slice(0, 3);
  return (
    <div className="container"><section className="section">
      <p className="eyebrow">Shared result (read-only)</p>
      <h1 className="section__title">{item.topClass || preds[0]?.label || 'DermaScan result'}</h1>
      <p className="muted">{formatDate(item.createdAt)}{item.modelUsed ? ` · Model: ${item.modelUsed}` : ''}</p>
      {item.imageUrl && <img src={resolveApiUrl(item.imageUrl)} alt="Shared lesion" className="compare-img" />}
      {item.gradcamUrl && <figure><img src={resolveApiUrl(item.gradcamUrl)} alt="Grad-CAM heatmap" className="compare-img" /><figcaption>What the model looked at — warmer areas influenced the prediction most</figcaption></figure>}
      <ol className="predictions">{preds.map((p, i) => <li key={i} className="prediction"><div className="prediction__row"><span className="prediction__rank">{i + 1}</span><span className="prediction__label">{p.label}</span><span className="prediction__value">{pct(p.probability)}</span></div><div className="prediction__bar"><div className="prediction__fill" style={{ width: pct(p.probability) }} /></div></li>)}</ol>
      <Disclaimer />
      <p className="muted">Made with DermaScan (educational demo)</p>
    </section></div>
  );
}
