import { useEffect, useRef, useState } from 'react';
import Disclaimer from '../components/Disclaimer.jsx';
import ResultActions from '../components/ResultActions.jsx';
import { requestReview } from '../api.js';
import { analyzeImage, fetchProfiles, fetchSpots, resolveApiUrl } from '../api.js';
import { riskTierFor } from '../utils/lesions.js';
import { normalizePredictions, normalizeList, itemId } from '../utils/normalize.js';
import { useLang } from '../i18n.jsx';

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MODELS = [
  { value: 'mobilenet', label: 'MobileNetV2' },
  { value: 'efficientnet', label: 'EfficientNet-B0' },
  { value: 'both', label: 'Compare both' },
  { value: 'ensemble', label: 'Ensemble (both averaged)' },
];
const CHANGE_OPTIONS = ['growth', 'itching', 'bleeding', 'color change', 'pain', 'none'];

function PredictionList({ preds }) {
  return (
    <ol className="predictions">
      {preds.map((pred, i) => (
        <li key={`${pred.label}-${i}`} className="prediction">
          <div className="prediction__row">
            <span className="prediction__rank">{i + 1}</span>
            <span className="prediction__label">{pred.label}</span>
            <span className="prediction__value">{Math.round(pred.probability * 100)}%</span>
          </div>
          <div className="prediction__bar"><div className="prediction__fill" style={{ width: `${Math.round(pred.probability * 100)}%` }} /></div>
        </li>
      ))}
    </ol>
  );
}

export default function Analyze() {
  const { t } = useLang();
  const fileInputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState('idle');
  const [payload, setPayload] = useState(null);
  const [results, setResults] = useState([]);
  const [error, setError] = useState(null);
  const [model, setModel] = useState('mobilenet');
  const [profiles, setProfiles] = useState([]);
  const [spots, setSpots] = useState([]);
  const [profileId, setProfileId] = useState('');
  const [spotId, setSpotId] = useState('');
  const [tta, setTta] = useState(false);
  const [hairRemoval, setHairRemoval] = useState(false);
  const [intake, setIntake] = useState({ duration: '', changes: [], familyHistory: '', notes: '' });
  const [reviewMsg, setReviewMsg] = useState(null);
  const toggleChange = (c) => setIntake((i) => ({ ...i, changes: i.changes.includes(c) ? i.changes.filter((x) => x !== c) : [...i.changes, c] }));

  useEffect(() => {
    (async () => {
      try { setProfiles(normalizeList(await fetchProfiles(), ['profiles', 'items', 'data'])); } catch { /* optional */ }
      try { setSpots(normalizeList(await fetchSpots(), ['spots', 'items', 'data'])); } catch { /* optional */ }
    })();
  }, []);

  const reset = () => { setFile(null); setPreviewUrl(null); setResults([]); setPayload(null); setError(null); setStatus('idle'); };
  const pickFile = (candidate) => {
    if (!candidate) return;
    if (!ACCEPTED_TYPES.includes(candidate.type) && !candidate.type.startsWith('image/')) { setError('Please choose a JPG, PNG or WebP image.'); setStatus('error'); return; }
    reset(); setFile(candidate); setPreviewUrl(URL.createObjectURL(candidate));
  };
  const handleDrop = (e) => { e.preventDefault(); setIsDragging(false); pickFile(e.dataTransfer.files?.[0]); };

  const handleAnalyze = async () => {
    if (!file) return;
    setStatus('loading'); setError(null); setResults([]); setPayload(null);
    try {
      const hasIntake = intake.duration || intake.changes.length || intake.familyHistory || intake.notes;
      const data = await analyzeImage(file, { model, profileId: profileId || undefined, spotId: spotId || undefined, tta, hairRemoval, intake: hasIntake ? intake : undefined });
      setPayload(data);
      setResults(normalizePredictions(data));
      setStatus('success');
    } catch (err) {
      setStatus('error');
      if (err.status === 503) setError('The analysis model is not ready yet — the backend has no trained weights. If you are running this locally, train the model first (see the ml-service README) and try again.');
      else setError(err.message || 'Something went wrong while analyzing the image.');
    }
  };

  const topTier = results.length > 0 ? riskTierFor(results[0].label) : null;
  const altPreds = payload?.altPredictions ? normalizePredictions({ predictions: payload.altPredictions }) : [];
  const resultId = payload ? itemId(payload, payload.analysisId || payload.historyId || '') : '';
  const gradcamSrc = payload?.gradcamUrl ? resolveApiUrl(payload.gradcamUrl) : null;
  const segSrc = payload?.segUrl ? resolveApiUrl(payload.segUrl) : null;
  const details = payload?.details || {};
  const uncertainty = details.uncertainty || payload?.uncertainty || null;
  const reliability = uncertainty?.reliability ? String(uncertainty.reliability) : null;
  const lowReliability = reliability && reliability.toLowerCase().startsWith('low');
  const ood = details.ood || payload?.ood || null;
  const origSrc = payload?.imageUrl ? resolveApiUrl(payload.imageUrl) : previewUrl;

  return (
    <div className="container">
      <section className="section">
        <p className="eyebrow">Analysis</p>
        <h1 className="section__title">{t('analyze_title')}</h1>
        <p className="section__lede">{t('analyze_lede')}</p>

        <div className="analyze-options">
          <div className="field">
            <span className="field__label">Model</span>
            <div className="segmented" role="group" aria-label="Choose model">
              {MODELS.map((m) => (
                <button key={m.value} type="button" className={`segmented__btn${model === m.value ? ' segmented__btn--active' : ''}`} onClick={() => setModel(m.value)}>{m.label}</button>
              ))}
            </div>
          </div>
          <div className="analyze-options__row">
            <label className="field">
              <span className="field__label">Profile (optional)</span>
              <select className="field__input" value={profileId} onChange={(e) => setProfileId(e.target.value)}>
                <option value="">None</option>
                {profiles.map((p) => <option key={itemId(p)} value={itemId(p)}>{p.name}</option>)}
              </select>
            </label>
            <label className="field">
              <span className="field__label">Body spot (optional)</span>
              <select className="field__input" value={spotId} onChange={(e) => setSpotId(e.target.value)}>
                <option value="">None</option>
                {spots.map((s) => <option key={itemId(s)} value={itemId(s)}>{s.label || s.name || 'Spot'}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="analyze-options__row">
          <label className="check-row"><input type="checkbox" checked={tta} onChange={(e) => setTta(e.target.checked)} /> Deep scan (test-time augmentation)</label>
          <label className="check-row"><input type="checkbox" checked={hairRemoval} onChange={(e) => setHairRemoval(e.target.checked)} /> Hair removal preprocessing</label>
        </div>
        <fieldset className="intake-form">
          <legend>Case intake (optional)</legend>
          <label className="field"><span className="field__label">How long has the spot been there?</span>
            <select className="field__input" value={intake.duration} onChange={(e) => setIntake({ ...intake, duration: e.target.value })}>
              <option value="">—</option><option>&lt;1 month</option><option>1-6 months</option><option>6-12 months</option><option>&gt;1 year</option>
            </select></label>
          <div className="field"><span className="field__label">Changes noticed</span>
            <div className="check-grid">{CHANGE_OPTIONS.map((c) => <label key={c} className="check-row"><input type="checkbox" checked={intake.changes.includes(c)} onChange={() => toggleChange(c)} /> {c}</label>)}</div></div>
          <label className="field"><span className="field__label">Family history of skin cancer</span>
            <select className="field__input" value={intake.familyHistory} onChange={(e) => setIntake({ ...intake, familyHistory: e.target.value })}>
              <option value="">—</option><option value="yes">Yes</option><option value="no">No</option>
            </select></label>
          <label className="field"><span className="field__label">Notes (optional)</span><textarea className="field__input" value={intake.notes} onChange={(e) => setIntake({ ...intake, notes: e.target.value })} /></label>
        </fieldset>

        <div className={`upload-zone${isDragging ? ' upload-zone--dragging' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)} onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()} role="button" tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
          aria-label="Upload a lesion image">
          <input ref={fileInputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" hidden onChange={(e) => pickFile(e.target.files?.[0])} />
          {previewUrl ? <img src={previewUrl} alt="Uploaded lesion preview" className="upload-zone__preview" /> : (
            <div className="upload-zone__prompt">
              <p className="upload-zone__headline">{t('upload_headline')}</p>
              <p className="upload-zone__hint">{t('upload_hint')}</p>
            </div>
          )}
        </div>

        {file && (
          <div className="analyze-actions">
            <button type="button" className="btn btn--ghost" onClick={reset} disabled={status === 'loading'}>{t('choose_another')}</button>
            <button type="button" className="btn btn--primary btn--lg" onClick={handleAnalyze} disabled={status === 'loading'}>{status === 'loading' ? t('analyzing') : t('analyze_btn')}</button>
          </div>
        )}

        {status === 'loading' && <div className="loading" aria-live="polite"><div className="loading__spinner" aria-hidden="true" /><p>The model is studying your image… this usually takes a few seconds.</p></div>}
        {status === 'error' && error && <div className="alert alert--error" role="alert"><p className="alert__title">The analysis could not run</p><p>{error}</p></div>}

        {status === 'success' && (
          <div className="results" aria-live="polite">
            <h2 className="results__title">{t('model_findings')}</h2>
            {reliability && <p>Reliability: <span className={`badge badge--${lowReliability ? 'high' : reliability.toLowerCase().startsWith('mod') ? 'moderate' : 'low'}`}>{reliability} confidence</span>{typeof uncertainty?.entropy === 'number' ? ` · entropy ${uncertainty.entropy.toFixed(2)}` : ''}{typeof uncertainty?.mc_std === 'number' ? ` · mc std ${uncertainty.mc_std.toFixed(3)}` : ''}</p>}
            {lowReliability && <div className="alert alert--warn" role="alert"><p className="alert__title">Uncertain result</p><p>Uncertain result — a clearer photo or an in-person dermatologist visit is recommended.</p></div>}
            {ood && ood.is_likely_lesion_photo === false && <div className="alert alert--ood" role="alert"><p className="alert__title">Photo check</p><p>This doesn&apos;t look like a skin-lesion close-up — the prediction below may be unreliable.{ood.warning ? ` ${ood.warning}` : ''}</p></div>}
            {ood && ood.is_likely_lesion_photo !== false && ood.warning && <p className="muted">{ood.warning}</p>}
            {details.disagreement && <p className="alert-inline">The two models disagreed on the top class — treat this result with extra caution.</p>}
            {(details.ttaUsed || payload?.ttaUsed) && <p className="muted">Deep scan (TTA) was used{typeof (details.ttaDelta ?? payload?.ttaDelta) === 'number' ? ` — deep scan changed top confidence by ${((details.ttaDelta ?? payload.ttaDelta) >= 0 ? '+' : '')}${(Math.abs(details.ttaDelta ?? payload.ttaDelta) <= 1 ? ((details.ttaDelta ?? payload.ttaDelta) * 100).toFixed(1) : (details.ttaDelta ?? payload.ttaDelta).toFixed(1))}%` : ''}.</p>}
            {(details.hairRemovalUsed || payload?.hairRemovalUsed) && <p className="muted">Hair-removal preprocessing was applied.</p>}
            {payload?.modelUsed && <p className="muted">Model used: {payload.modelUsed === 'both' ? 'MobileNetV2 + EfficientNet-B0 (compare)' : payload.modelUsed}</p>}
            {results.length === 0 ? <p className="muted">The backend returned no predictions for this image. Try a clearer photograph.</p> : (
              <>
                {(origSrc || gradcamSrc) && (
                  <div className="result-images">
                    {origSrc && <figure><img src={origSrc} alt="Original lesion" /><figcaption>Your photo</figcaption></figure>}
                    {gradcamSrc && <figure><img src={gradcamSrc} alt="Grad-CAM heatmap" /><figcaption>What the model looked at — warmer areas influenced the prediction most</figcaption></figure>}
                    {segSrc && <figure><img src={segSrc} alt="Lesion segmentation overlay" /><figcaption>Lesion outline (classical segmentation — approximate)</figcaption></figure>}
                  </div>
                )}

                {payload?.modelUsed === 'both' && altPreds.length > 0 ? (
                  <div className="compare-table-wrap">
                    <h3>Both models, side by side</h3>
                    <table className="data-table">
                      <thead><tr><th>#</th><th>{payload.altTopClass ? 'Primary model' : 'MobileNetV2'}</th><th>%</th><th>Other model{payload.altTopClass ? ` (top: ${payload.altTopClass})` : ''}</th><th>%</th></tr></thead>
                      <tbody>
                        {[0, 1, 2].map((i) => (
                          <tr key={i}><td>{i + 1}</td><td>{results[i]?.label || '—'}</td><td>{results[i] ? Math.round(results[i].probability * 100) : '—'}</td><td>{altPreds[i]?.label || '—'}</td><td>{altPreds[i] ? Math.round(altPreds[i].probability * 100) : '—'}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <PredictionList preds={results} />}

                {topTier && (
                  <div className={`risk-callout risk-callout--${topTier.toLowerCase()}`}>
                    <p className="risk-callout__tier">{topTier} priority signal</p>
                    <p className="risk-callout__text">
                      {topTier === 'High' && 'The top prediction is a category that dermatologists treat urgently. Please book an in-person appointment soon.'}
                      {topTier === 'Moderate' && 'The top prediction is a category that is often monitored or treated. Mention it at your next skin check.'}
                      {topTier === 'Low' && 'The top prediction is usually benign — but only a dermatologist can confirm that. Keep watching for change.'}
                    </p>
                  </div>
                )}

                {payload?.quality && (
                  <div className="info-card">
                    <h3>Photo quality</h3>
                    <p>Score: <strong>{typeof payload.quality.score === 'number' ? Math.round(payload.quality.score) : payload.quality.score ?? '—'}</strong>
                      {typeof payload.quality.blur_variance === 'number' && <> · Sharpness (blur variance): {Math.round(payload.quality.blur_variance)}</>}
                      {typeof payload.quality.brightness === 'number' && <> · Brightness: {Math.round(payload.quality.brightness)}</>}</p>
                    {Array.isArray(payload.quality.warnings) && payload.quality.warnings.length > 0 && (
                      <ul className="bullet-list">{payload.quality.warnings.map((w, i) => <li key={i}>{String(w)}</li>)}</ul>
                    )}
                    <p className="muted">Your analysis is shown above regardless of photo quality.</p>
                  </div>
                )}

                {payload?.lesion && typeof payload.lesion.coverage_percent === 'number' && (
                  <p className="lesion-line">Lesion covers ≈ {payload.lesion.coverage_percent}% of the photo frame (rough estimate{payload.lesion.method ? `, method: ${payload.lesion.method}` : ''}).</p>
                )}

                {resultId && <p><button type="button" className="btn btn--ghost btn--sm" onClick={async () => { try { await requestReview(resultId); setReviewMsg('Review requested (demo).'); } catch (e) { setReviewMsg(e.message || 'Could not request review.'); } }}>Request review (demo)</button>{reviewMsg && <span className="muted"> {reviewMsg}</span>}</p>}
                {payload?.reviewStatus === 'reviewed' && payload?.reviewComment && <div className="demo-review"><strong>Demo doctor review — not medical advice</strong><p>{payload.reviewComment}</p></div>}
                {resultId && <ResultActions id={resultId} topClass={results[0]?.label} risk={topTier} prob={results[0]?.probability} />}
                {!resultId && <p className="muted">Note: this response carried no saved-analysis ID, so PDF / share / feedback actions are unavailable for it.</p>}

                <Disclaimer compact />
                <p className="advisory">This is not a medical diagnosis — please see a dermatologist.</p>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
