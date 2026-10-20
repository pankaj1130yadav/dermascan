import { useState } from 'react';
import { downloadPdf, emailReport, postFeedback, shareAnalysis, resolveApiUrl } from '../api.js';

// Action row for a saved analysis: feedback, PDF, email, share (+QR), WhatsApp.
// Props: id, topClass, risk, prob (0-1), showFeedback (default true)
export default function ResultActions({ id, topClass, risk, prob, showFeedback = true }) {
  const [feedback, setFeedback] = useState(null); // 'right' | 'wrong'
  const [share, setShare] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState('');
  if (!id) return null;

  const doFeedback = async (verdict) => {
    setBusy('feedback');
    try { await postFeedback(id, verdict); setFeedback(verdict); }
    catch (e) { setMsg(e.message || 'Could not save feedback.'); }
    finally { setBusy(''); }
  };
  const doPdf = async () => {
    setBusy('pdf');
    try { await downloadPdf(id); } catch (e) { setMsg(e.message || 'PDF download failed.'); }
    finally { setBusy(''); }
  };
  const doEmail = async () => {
    const email = window.prompt('Email address to send the report to:');
    if (!email) return;
    setBusy('email');
    try { await emailReport(id, email); setMsg('Report emailed.'); }
    catch (e) {
      if (e.status === 501 || e.body?.error === 'EmailNotConfigured') setMsg('Email is not configured on this server.');
      else setMsg(e.message || 'Could not email the report.');
    } finally { setBusy(''); }
  };
  const doShare = async () => {
    setBusy('share');
    try {
      const r = await shareAnalysis(id);
      const path = r.sharePath || (r.token ? `/shared/${r.token}` : '');
      setShare({ url: path ? `${window.location.origin}${path}` : '', qr: r.qrDataUrl });
    } catch (e) { setMsg(e.message || 'Could not create a share link.'); }
    finally { setBusy(''); }
  };
  const waText = encodeURIComponent(`DermaScan result: ${topClass || 'Unknown'} (${risk || 'unknown'} risk signal), ${Math.round((prob || 0) * 100)}% — educational demo, not a diagnosis.`);

  return (
    <div className="result-actions">
      {showFeedback && (feedback ? (
        <p className="feedback-thanks">Thanks for your feedback.</p>
      ) : (
        <div className="feedback-row">
          <span className="muted">Does this look right?</span>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy === 'feedback'} onClick={() => doFeedback('right')}>Looks right</button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy === 'feedback'} onClick={() => doFeedback('wrong')}>Looks wrong</button>
        </div>
      ))}
      <div className="action-row">
        <button type="button" className="btn btn--ghost btn--sm" onClick={doPdf} disabled={busy === 'pdf'}>Download PDF</button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={doEmail} disabled={busy === 'email'}>Email report</button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={doShare} disabled={busy === 'share'}>Share</button>
        <a className="btn btn--ghost btn--sm" href={`https://wa.me/?text=${waText}`} target="_blank" rel="noreferrer">WhatsApp</a>
      </div>
      {msg && <p className="muted action-msg">{msg}</p>}
      {share && (
        <div className="share-box">
          <p>Share link: <a href={share.url} target="_blank" rel="noreferrer">{share.url}</a></p>
          {share.qr && <img src={share.qr} alt="QR code for the shared result" className="share-qr" />}
        </div>
      )}
    </div>
  );
}
export { resolveApiUrl };
