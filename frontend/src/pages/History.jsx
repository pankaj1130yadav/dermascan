import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { fetchHistory, deleteAnalysis, fetchProfiles, downloadPdf, downloadCsv, shareAnalysis, downloadFullReport, requestReview } from '../api.js';
import { riskTierFor } from '../utils/lesions.js';
import { normalizeList, itemId, topClassOf, riskOf, formatDate } from '../utils/normalize.js';
import { resolveApiUrl } from '../api.js';
import { useLang } from '../i18n.jsx';

export default function History() {
  const { t } = useLang();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [profileFilter, setProfileFilter] = useState('');
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [selected, setSelected] = useState([]);
  const [shareInfo, setShareInfo] = useState({});
  const [msg, setMsg] = useState(null);

  const load = async () => {
    setStatus('loading');
    try {
      const payload = await fetchHistory(profileFilter ? { profileId: profileFilter } : {});
      setItems(normalizeList(payload));
      setStatus('ready');
    } catch (err) { setError(err.message || 'Could not load your history.'); setStatus('error'); }
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [profileFilter]);
  useEffect(() => { (async () => { try { setProfiles(normalizeList(await fetchProfiles(), ['profiles', 'items', 'data'])); } catch {} })(); }, []);

  const profileName = (item) => {
    if (item.profileName) return item.profileName;
    const pid = item.profileId?._id || item.profileId;
    const p = profiles.find((x) => String(itemId(x)) === String(pid));
    return p?.name || null;
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this analysis from your history?')) return;
    setDeletingId(id);
    try { await deleteAnalysis(id); setItems((prev) => prev.filter((item) => String(itemId(item)) !== String(id))); }
    catch (err) { alert(err.message || 'Could not delete this analysis.'); }
    finally { setDeletingId(null); }
  };
  const toggleCompare = (id) => setSelected((s) => s.includes(id) ? s.filter((x) => x !== id) : (s.length >= 2 ? [s[1], id] : [...s, id]));
  const doShare = async (id) => {
    try { const r = await shareAnalysis(id); const path = r.sharePath || (r.token ? `/shared/${r.token}` : ''); setShareInfo((m) => ({ ...m, [id]: { url: `${window.location.origin}${path}`, qr: r.qrDataUrl } })); }
    catch (e) { setMsg(e.message || 'Could not create share link.'); }
  };
  const doReview = async (id) => {
    try { await requestReview(id); setMsg('Review requested (demo).'); load(); } catch (e) { setMsg(e.message || 'Could not request review.'); }
  };

  const canCompare = selected.length === 2;
  const groupedMsg = useMemo(() => msg, [msg]);

  return (
    <div className="container">
      <section className="section">
        <p className="eyebrow">Your record</p>
        <h1 className="section__title">{t('history_title')}</h1>
        <p className="section__lede">{t('history_lede')}</p>

        <div className="toolbar">
          <label className="field toolbar__field">
            <span className="field__label">Profile</span>
            <select className="field__input" value={profileFilter} onChange={(e) => setProfileFilter(e.target.value)}>
              <option value="">All</option>
              {profiles.map((p) => <option key={itemId(p)} value={itemId(p)}>{p.name}</option>)}
            </select>
          </label>
          <div className="toolbar__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { try { await downloadCsv(); } catch (e) { setMsg(e.message); } }}>Export CSV</button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { try { await downloadFullReport(); } catch (e) { setMsg(e.message || 'Full report failed.'); } }}>Download full health report (PDF)</button>
            <button type="button" className="btn btn--primary btn--sm" disabled={!canCompare} onClick={() => navigate(`/compare?a=${selected[0]}&b=${selected[1]}`)}>Compare selected</button>
          </div>
        </div>
        {groupedMsg && <p className="muted">{groupedMsg}</p>}

        {status === 'loading' && <div className="loading" aria-live="polite"><div className="loading__spinner" aria-hidden="true" /><p>Loading your history…</p></div>}
        {status === 'error' && <div className="alert alert--error" role="alert"><p className="alert__title">Could not load history</p><p>{error}</p></div>}
        {status === 'ready' && items.length === 0 && (
          <div className="empty"><p className="empty__title">{t('no_analyses')}</p><p className="empty__text">Your past analyses will appear here once you analyze your first lesion.</p><Link to="/analyze" className="btn btn--primary">Analyze a lesion</Link></div>
        )}

        {status === 'ready' && items.length > 0 && (
          <div className="history-grid">
            {items.map((item, i) => {
              const id = itemId(item, String(i));
              const topClass = topClassOf(item);
              const tier = riskOf(item) || riskTierFor(topClass);
              const imageSrc = item.imageUrl ? resolveApiUrl(item.imageUrl) : null;
              const pname = profileName(item);
              return (
                <article key={id} className="history-card">
                  {imageSrc ? <img src={imageSrc} alt={`Lesion analyzed on ${formatDate(item.createdAt || item.date)}`} className="history-card__thumb" loading="lazy" />
                    : <div className="history-card__thumb history-card__thumb--placeholder" aria-hidden="true"><span>{String(topClass).charAt(0).toUpperCase()}</span></div>}
                  <div className="history-card__body">
                    <p className="history-card__date">{formatDate(item.createdAt || item.created_at || item.date)}</p>
                    <h3 className="history-card__class">{topClass}</h3>
                    <span className={`badge badge--${tier.toLowerCase()}`}>{tier} tier</span>
                    {pname && <p className="history-card__meta">Profile: {pname}</p>}
                    {item.modelUsed && <p className="history-card__meta">Model: {item.modelUsed}</p>}
                    {item.feedback && <p className="history-card__meta">Your feedback: {item.feedback === 'right' || item.feedback?.verdict === 'right' ? 'Looks right' : 'Looks wrong'}</p>}
                    {item.reviewStatus === 'reviewed' && item.reviewComment && (
                      <div className="demo-review"><strong>Demo doctor review — not medical advice</strong><p>{item.reviewComment}</p>{item.reviewedBy && <p className="muted">By {item.reviewedBy}</p>}</div>
                    )}
                    {item.reviewStatus === 'requested' && <p className="history-card__meta">Review requested (demo) — pending.</p>}
                    <label className="compare-check"><input type="checkbox" checked={selected.includes(id)} onChange={() => toggleCompare(id)} /> Compare</label>
                  </div>
                  <div className="history-card__actions">
                    <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { try { await downloadPdf(id); } catch (e) { setMsg(e.message); } }}>PDF</button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => doShare(id)}>Share</button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => doReview(id)}>Request review (demo)</button>
                    <button type="button" className="btn btn--ghost btn--sm" onClick={() => handleDelete(id)} disabled={deletingId === id}>{deletingId === id ? 'Deleting…' : t('delete')}</button>
                  </div>
                  {shareInfo[id] && (
                    <div className="share-box"><p><a href={shareInfo[id].url} target="_blank" rel="noreferrer">{shareInfo[id].url}</a></p>{shareInfo[id].qr && <img src={shareInfo[id].qr} alt="QR code" className="share-qr" />}</div>
                  )}
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
