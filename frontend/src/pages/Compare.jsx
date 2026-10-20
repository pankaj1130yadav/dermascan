import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { fetchAnalysis, resolveApiUrl, updateIntake } from '../api.js';
import { normalizePredictions, formatDate, pct } from '../utils/normalize.js';
import { riskTierFor } from '../utils/lesions.js';
import Disclaimer from '../components/Disclaimer.jsx';

export function IntakeBlock({ item, editable = false, onSaved }) {
  const [editing, setEditing] = useState(false);
  const intake = item?.intake || {};
  const [form, setForm] = useState({ duration: intake.duration || '', familyHistory: intake.familyHistory || '', notes: intake.notes || '', changes: (intake.changes || []).join(', ') });
  const [msg, setMsg] = useState(null);
  if (!item) return null;
  const has = intake.duration || intake.familyHistory || intake.notes || (intake.changes && intake.changes.length);
  const save = async (e) => {
    e.preventDefault();
    try {
      await updateIntake(item.id ?? item._id, { duration: form.duration, familyHistory: form.familyHistory, notes: form.notes, changes: form.changes ? form.changes.split(',').map((s) => s.trim()).filter(Boolean) : [] });
      setMsg('Intake saved.'); setEditing(false); if (onSaved) onSaved();
    } catch (err) { setMsg(err.message || 'Could not save intake.'); }
  };
  return (
    <div className="intake-block">
      <h4>Case intake</h4>
      {has ? <ul className="bullet-list">
        {intake.duration && <li>Duration: {intake.duration}</li>}
        {intake.changes?.length > 0 && <li>Changes: {intake.changes.join(', ')}</li>}
        {intake.familyHistory && <li>Family history of skin cancer: {intake.familyHistory}</li>}
        {intake.notes && <li>Notes: {intake.notes}</li>}
      </ul> : <p className="muted">No intake recorded.</p>}
      {item.details?.uncertainty && <p>Reliability: {item.details.uncertainty.reliability || '—'}{typeof item.details.uncertainty.entropy === 'number' ? ` (entropy ${item.details.uncertainty.entropy.toFixed(2)})` : ''}</p>}
      {editable && (editing ? (
        <form className="form" onSubmit={save}>
          <label className="field"><span className="field__label">Duration</span>
            <select className="field__input" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })}><option value="">—</option><option>&lt;1 month</option><option>1-6 months</option><option>6-12 months</option><option>&gt;1 year</option></select></label>
          <label className="field"><span className="field__label">Changes (comma separated)</span><input className="field__input" value={form.changes} onChange={(e) => setForm({ ...form, changes: e.target.value })} /></label>
          <label className="field"><span className="field__label">Family history</span>
            <select className="field__input" value={form.familyHistory} onChange={(e) => setForm({ ...form, familyHistory: e.target.value })}><option value="">—</option><option value="yes">Yes</option><option value="no">No</option></select></label>
          <label className="field"><span className="field__label">Notes</span><textarea className="field__input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
          <button type="submit" className="btn btn--primary btn--sm">Save intake</button>
        </form>
      ) : <button type="button" className="btn btn--ghost btn--sm" onClick={() => setEditing(true)}>Edit intake</button>)}
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}

function Column({ item }) {
  if (!item) return <div className="compare-col"><p className="muted">Not found.</p></div>;
  const preds = normalizePredictions(item);
  const top = preds[0];
  const tier = riskTierFor(top?.label || item.topClass || '');
  return (
    <div className="compare-col">
      <p className="muted">{formatDate(item.createdAt)}</p>
      {item.imageUrl && <img src={resolveApiUrl(item.imageUrl)} alt="Lesion" className="compare-img" />}
      {item.gradcamUrl && <img src={resolveApiUrl(item.gradcamUrl)} alt="Grad-CAM" className="compare-img" />}
      <h3>{item.topClass || top?.label || 'Unknown'}</h3>
      <span className={`badge badge--${tier.toLowerCase()}`}>{tier} tier</span>
      <p className="muted">Model: {item.modelUsed || '—'} · Quality score: {item.quality?.score ?? '—'}</p>
      {item.details?.uncertainty?.reliability && <p>Reliability: <strong>{item.details.uncertainty.reliability}</strong></p>}
      <ol className="predictions">{preds.slice(0, 3).map((p, i) => (
        <li key={i} className="prediction"><div className="prediction__row"><span className="prediction__rank">{i + 1}</span><span className="prediction__label">{p.label}</span><span className="prediction__value">{pct(p.probability)}</span></div>
        <div className="prediction__bar"><div className="prediction__fill" style={{ width: pct(p.probability) }} /></div></li>))}
      </ol>
      <IntakeBlock item={item} editable />
      {item.reviewStatus === 'reviewed' && item.reviewComment && <div className="demo-review"><strong>Demo doctor review — not medical advice</strong><p>{item.reviewComment}</p></div>}
    </div>
  );
}

export default function Compare() {
  const [params] = useSearchParams();
  const [a, setA] = useState(null); const [b, setB] = useState(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    (async () => {
      try { setA(await fetchAnalysis(params.get('a'))); } catch { setA(null); }
      try { setB(await fetchAnalysis(params.get('b'))); } catch { setB(null); }
    })();
  }, [params, tick]);
  return (
    <div className="container"><section className="section">
      <p className="eyebrow">Side by side</p><h1 className="section__title">Compare analyses</h1>
      <div className="compare-grid"><Column item={a} key={`a-${tick}`} /><Column item={b} key={`b-${tick}`} /></div>
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setTick((x) => x + 1)}>Refresh</button>
      <Disclaimer compact />
    </section></div>
  );
}
