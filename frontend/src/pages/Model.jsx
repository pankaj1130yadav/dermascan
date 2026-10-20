import { useEffect, useState } from 'react';
import Disclaimer from '../components/Disclaimer.jsx';
import { fetchModelInfo, ML_URL } from '../api.js';

function num(v, d = 3) { return typeof v === 'number' ? v.toFixed(d) : (v ?? '—'); }

function Curve({ epochs }) {
  if (!Array.isArray(epochs) || !epochs.length) return <p className="muted">No training curve data.</p>;
  const W = 520, H = 180;
  const get = (e, keys) => { for (const k of keys) if (typeof e[k] === 'number') return e[k]; return null; };
  const acc = epochs.map((e, i) => [i, get(e, ['val_accuracy', 'val_acc', 'validation_accuracy'])]);
  const loss = epochs.map((e, i) => [i, get(e, ['train_loss', 'loss', 'training_loss'])]);
  const maxLoss = Math.max(...loss.map(([, v]) => v || 0), 1);
  const toXY = (series, scale) => series.filter(([, v]) => v != null).map(([i, v]) => `${20 + (i * (W - 40)) / Math.max(epochs.length - 1, 1)},${H - 20 - scale(v) * (H - 40)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H + 10}`} className="chart" role="img" aria-label="Training curves">
      <polyline points={toXY(acc, (v) => v)} fill="none" stroke="#0e7c6b" strokeWidth="2" />
      <polyline points={toXY(loss, (v) => v / maxLoss)} fill="none" stroke="#b3402a" strokeWidth="2" strokeDasharray="5 3" />
      <text x="20" y="14" fontSize="11" fill="#0e7c6b">val accuracy</text>
      <text x="130" y="14" fontSize="11" fill="#b3402a">train loss (scaled)</text>
    </svg>
  );
}

function Confusion({ matrix, labels }) {
  if (!Array.isArray(matrix) || !matrix.length) return <p className="muted">No confusion matrix available.</p>;
  const max = Math.max(...matrix.flat().map((v) => Number(v) || 0), 1);
  const lab = (labels && labels.length === matrix.length ? labels : matrix.map((_, i) => `C${i + 1}`))
    .map((l) => (l && typeof l === 'object' ? (l.name || l.class_id || '?') : String(l)));
  return (
    <div className="table-scroll"><table className="data-table confusion">
      <thead><tr><th>True \ Pred</th>{lab.map((l, li) => <th key={`${li}-${l}`}>{l}</th>)}</tr></thead>
      <tbody>{matrix.map((row, i) => <tr key={i}><th>{lab[i]}</th>{row.map((v, j) => {
        const a = (Number(v) || 0) / max;
        return <td key={j} style={{ background: i === j ? `rgba(14,124,107,${0.15 + a * 0.7})` : `rgba(179,64,42,${a * 0.55})` }}>{v}</td>;
      })}</tr>)}</tbody>
    </table></div>
  );
}

function ModelBlock({ title, info, classes }) {
  if (!info) return null;
  const epochs = info.epochs || info.history?.epochs || [];
  const best = info.best_val_accuracy ?? info.best_val_acc ?? info.val_accuracy ?? info.accuracy;
  const perClass = info.per_class || info.perClass || info.class_metrics || {};
  const cm = info.confusion_matrix || info.confusionMatrix;
  return (
    <article className="model-block">
      <h3>{title}</h3>
      <p>{title.includes('EfficientNet') ? 'EfficientNet-B0, pre-trained on ImageNet, fine-tuned on the full HAM10000 dataset (10,015 images).' : 'MobileNetV2, pre-trained on ImageNet, fine-tuned on the full HAM10000 dataset (10,015 images).'}</p>
      <p>Best validation accuracy: <strong>{typeof best === 'number' ? `${(best <= 1 ? best * 100 : best).toFixed(2)}%` : '—'}</strong></p>
      {Object.keys(perClass).length > 0 && (
        <div className="table-scroll"><table className="data-table">
          <thead><tr><th>Class</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead>
          <tbody>{Object.entries(perClass).map(([cls, m]) => {
            const met = typeof m === 'object' ? m : { f1: m };
            return <tr key={cls}><td>{cls}</td><td>{num(met.precision)}</td><td>{num(met.recall)}</td><td>{num(met.f1 ?? met.f1_score)}</td></tr>;
          })}</tbody></table></div>
      )}
      <h4>Training curve</h4><Curve epochs={epochs} />
      <h4>Confusion matrix</h4><Confusion matrix={cm} labels={classes} />
    </article>
  );
}

function DatasetChart({ dist }) {
  const entries = Object.entries(dist || {});
  if (!entries.length) return null;
  const total = entries.reduce((a, [, v]) => a + (Number(v) || 0), 0);
  const max = Math.max(...entries.map(([, v]) => Number(v) || 0), 1);
  const W = 520, rowH = 28, H = entries.length * rowH + 10;
  return (
    <><svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="HAM10000 dataset distribution">
      {entries.map(([k, v], i) => { const w = ((Number(v) || 0) / max) * (W - 150); const y = i * rowH + 4;
        return <g key={k}><text x="0" y={y + 15} fontSize="12">{k}</text><rect x="90" y={y} width={Math.max(w, 2)} height="18" fill="#0e7c6b" /><text x={96 + w} y={y + 15} fontSize="12">{v}</text></g>; })}
    </svg><p className="muted">Total images in distribution: {total.toLocaleString()} (HAM10000 has 10,015 images; class imbalance is real — common moles dominate, rare classes are much harder to learn).</p></>
  );
}

export default function ModelPage() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => { (async () => { try { setInfo(await fetchModelInfo()); } catch (e) { setError('Model information is unavailable — the ML service appears to be offline.'); } })(); }, []);
  const classes = info?.classes || [];
  const baseline = info?.v1_baseline;
  const baseAcc = typeof baseline === 'object' ? (baseline.best_val_accuracy ?? baseline.val_accuracy ?? baseline.accuracy) : null;
  const methods = info?.methods_notes;
  const methodEntries = methods ? (Array.isArray(methods) ? methods.map((m) => [typeof m === 'object' ? (m.title || m.name || 'Note') : 'Note', typeof m === 'object' ? (m.text || m.description || JSON.stringify(m)) : String(m)]) : Object.entries(methods).map(([k, v]) => [k, typeof v === 'object' ? (v.text || JSON.stringify(v)) : String(v)])) : [];
  const pp = info?.preprocessing_example;
  const ppSrc = (p) => !p ? null : (/^https?:\/\//.test(p) ? p : `${ML_URL}/static/${String(p).replace(/^\/?(static\/)?/, '')}`);
  return (
    <div className="container"><section className="section">
      <p className="eyebrow">Transparency</p>
      <h1 className="section__title">About the model</h1>
      <p className="section__lede">How the models were trained, how well they actually do — including where they are weak.</p>
      {error && <div className="alert alert--error" role="alert"><p>{error}</p></div>}
      {!info && !error && <p className="muted">Loading model information…</p>}
      {info && <>
        <ModelBlock title="MobileNetV2" info={info.mobilenet} classes={classes} />
        <ModelBlock title="EfficientNet-B0" info={info.efficientnet} classes={classes} />
        <div className="info-card">
          <h3>v1 baseline — honest comparison</h3>
          <p>The first version was trained on only a stratified <strong>2,000-image subset</strong> of HAM10000 and reached a best validation accuracy of <strong>{baseAcc != null && typeof baseAcc === 'number' ? `${(baseAcc <= 1 ? baseAcc * 100 : baseAcc).toFixed(2)}%` : '81.25%'}</strong>. The v2 models above train on the full 10,015 images — compare their numbers directly, per class, not just the headline.</p>
          {baseline && typeof baseline === 'object' && baseline.note && <p className="muted">{baseline.note}</p>}
        </div>
        {info.dataset_distribution && <><h2 className="section__subtitle">Inside the dataset — HAM10000</h2><DatasetChart dist={info.dataset_distribution} /></>}
        {pp && (pp.before || pp.after) && (
          <div className="info-card"><h3>Preprocessing example</h3>
            <div className="result-images">
              {pp.before && <figure><img src={ppSrc(pp.before)} alt="Original lesion" /><figcaption>Original</figcaption></figure>}
              {pp.after && <figure><img src={ppSrc(pp.after)} alt="After hair removal" /><figcaption>After hair removal (DullRazor-style)</figcaption></figure>}
            </div>
            {pp.note && <p className="muted">{pp.note}</p>}
          </div>
        )}
        {methodEntries.length > 0 && (
          <div className="info-card"><h3>How to read these results</h3>
            <p className="muted">The signals below are <strong>heuristics</strong> — simple rules and estimates, not clinical measurements.</p>
            <ul className="bullet-list">{methodEntries.map(([k, v], i) => <li key={i}><strong>{String(k)}:</strong> {String(v)}</li>)}</ul>
          </div>
        )}
        {Array.isArray(info.limitations) && info.limitations.length > 0 && (
          <div className="info-card"><h3>Limitations</h3><ul className="bullet-list">{info.limitations.map((l, i) => <li key={i}>{String(l)}</li>)}</ul></div>
        )}
      </>}
      <Disclaimer />
    </section></div>
  );
}
