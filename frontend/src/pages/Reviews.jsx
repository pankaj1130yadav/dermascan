import { useEffect, useState } from 'react';
import { fetchReviewQueue, respondReview, resolveApiUrl } from '../api.js';
import { normalizeList, itemId, topClassOf, formatDate } from '../utils/normalize.js';
import { riskTierFor } from '../utils/lesions.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Reviews() {
  const { user } = useAuth();
  const allowed = user?.role === 'doctor' || user?.role === 'admin';
  const [queue, setQueue] = useState([]);
  const [comments, setComments] = useState({});
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = async () => { try { setQueue(normalizeList(await fetchReviewQueue(), ['queue', 'items', 'reviews', 'data'])); } catch (e) { setError(e.message); } };
  useEffect(() => { if (allowed) load(); }, [allowed]);
  if (!allowed) return <div className="container"><section className="section"><h1 className="section__title">Review queue</h1><p className="section__lede">This page is for demo doctor and admin accounts only.</p></section></div>;
  const respond = async (id) => {
    try { await respondReview(id, comments[id] || ''); setMsg('Marked reviewed (demo opinion).'); setComments((c) => ({ ...c, [id]: '' })); load(); }
    catch (e) { setError(e.message || 'Could not respond.'); }
  };
  return (
    <div className="container"><section className="section">
      <p className="eyebrow">Demo</p><h1 className="section__title">Doctor review queue</h1>
      <div className="alert" role="note"><p className="alert__title">Demo — not medical advice</p><p>Reviews here are demonstration opinions by fictional/demo reviewers. They are not diagnoses and do not replace an in-person dermatologist.</p></div>
      {error && <div className="alert alert--error" role="alert"><p>{error}</p></div>}
      {msg && <p className="muted">{msg}</p>}
      {queue.length === 0 && <p className="muted">The review queue is empty.</p>}
      <div className="review-list">
        {queue.map((item) => {
          const id = itemId(item); const tc = topClassOf(item); const tier = riskTierFor(tc);
          const intake = item.intake || {};
          const uname = item.userName || item.user?.name || item.userEmail || item.user?.email || 'User';
          return (
            <article key={id} className="review-item">
              {item.imageUrl && <img src={resolveApiUrl(item.imageUrl)} alt="Lesion awaiting review" className="review-thumb" />}
              <div className="review-item__body">
                <p className="muted">{uname} · {formatDate(item.createdAt)}</p>
                <h3>{tc} <span className={`badge badge--${tier.toLowerCase()}`}>{tier}</span></h3>
                {(intake.duration || intake.familyHistory || intake.notes || intake.changes?.length) ? <p className="muted">Intake: {[intake.duration, intake.changes?.length && `changes: ${intake.changes.join(', ')}`, intake.familyHistory && `family history: ${intake.familyHistory}`, intake.notes].filter(Boolean).join(' · ')}</p> : <p className="muted">No intake recorded.</p>}
                <textarea className="field__input" placeholder="Your demo comment…" value={comments[id] || ''} onChange={(e) => setComments((c) => ({ ...c, [id]: e.target.value }))} />
                <button type="button" className="btn btn--primary btn--sm" onClick={() => respond(id)}>Mark reviewed (demo opinion)</button>
              </div>
            </article>
          );
        })}
      </div>
    </section></div>
  );
}
