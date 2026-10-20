import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchStats, fetchInsights, fetchReminders, resolveApiUrl, downloadFullReport } from '../api.js';
import { normalizeList, formatDate } from '../utils/normalize.js';
import UvCard from '../components/UvCard.jsx';
import { useLang } from '../i18n.jsx';

function BarChart({ data }) {
  const entries = Object.entries(data || {});
  if (!entries.length) return <p className="muted">No data yet.</p>;
  const max = Math.max(...entries.map(([, v]) => Number(v) || 0), 1);
  const W = 520, H = 180, bw = Math.min(48, (W - 40) / entries.length - 10);
  return (
    <svg viewBox={`0 0 ${W} ${H + 30}`} className="chart" role="img" aria-label="Analyses per class">
      {entries.map(([k, v], i) => {
        const h = ((Number(v) || 0) / max) * H;
        const x = 30 + i * ((W - 40) / entries.length);
        return <g key={k}><rect x={x} y={H - h} width={bw} height={h} fill="#0e7c6b" /><text x={x + bw / 2} y={H - h - 6} textAnchor="middle" fontSize="12">{v}</text><text x={x + bw / 2} y={H + 18} textAnchor="middle" fontSize="11">{k}</text></g>;
      })}
    </svg>
  );
}
function LineChart({ data }) {
  const pts = (data || []).map((d) => ({ date: d.date, count: Number(d.count) || 0 }));
  if (!pts.length) return <p className="muted">No recent activity.</p>;
  const W = 520, H = 160, max = Math.max(...pts.map((p) => p.count), 1);
  const coords = pts.map((p, i) => [20 + (i * (W - 40)) / Math.max(pts.length - 1, 1), H - 20 - (p.count / max) * (H - 40)]);
  const line = coords.map((c) => c.join(',')).join(' ');
  const area = `20,${H - 20} ${line} ${coords[coords.length - 1][0]},${H - 20}`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Analyses in the last 30 days">
      <polygon points={area} fill="rgba(14,124,107,0.18)" />
      <polyline points={line} fill="none" stroke="#0e7c6b" strokeWidth="2" />
      {coords.map((c, i) => <circle key={i} cx={c[0]} cy={c[1]} r="3" fill="#0e7c6b" />)}
      <text x="20" y={H - 2} fontSize="10">{pts[0].date}</text>
      <text x={W - 80} y={H - 2} fontSize="10">{pts[pts.length - 1].date}</text>
    </svg>
  );
}
function RiskBar({ perRisk }) {
  const entries = Object.entries(perRisk || {}).map(([k, v]) => [k, Number(v) || 0]);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (!total) return <p className="muted">No data yet.</p>;
  const colors = { low: '#0e7c6b', Low: '#0e7c6b', moderate: '#9a6b1a', medium: '#9a6b1a', Moderate: '#9a6b1a', high: '#b3402a', High: '#b3402a' };
  let x = 0; const W = 520, H = 36;
  return (
    <svg viewBox={`0 0 ${W} ${H + 22}`} className="chart" role="img" aria-label="Analyses by risk">
      {entries.map(([k, v]) => { const w = (v / total) * W; const el = <g key={k}><rect x={x} y={0} width={w} height={H} fill={colors[k] || '#5c6b66'} /><text x={x + 4} y={H + 16} fontSize="11">{k}: {v}</text></g>; x += w; return el; })}
    </svg>
  );
}

export default function Dashboard() {
  const { t } = useLang();
  const [stats, setStats] = useState(null);
  const [insights, setInsights] = useState([]);
  const [reminders, setReminders] = useState([]);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => {
    (async () => {
      try { setStats(await fetchStats()); } catch (e) { setError(e.message || 'Could not load stats.'); }
      try { const r = await fetchInsights(); setInsights(Array.isArray(r?.insights) ? r.insights : normalizeList(r)); } catch {}
      try { setReminders(normalizeList(await fetchReminders())); } catch {}
    })();
  }, []);
  const perRisk = stats?.perRisk || {};
  const highCount = perRisk.high ?? perRisk.High ?? 0;
  const fb = stats?.feedback || {};
  const fbTotal = (fb.right || 0) + (fb.wrong || 0);
  const fbAcc = fbTotal ? Math.round(((fb.right || 0) / fbTotal) * 100) : null;
  return (
    <div className="container"><section className="section">
      <p className="eyebrow">Overview</p>
      <h1 className="section__title">{t('dashboard_title')}</h1>
      <p className="section__lede">{t('dashboard_lede')}</p>
      <p><button type="button" className="btn btn--ghost" onClick={async () => { try { await downloadFullReport(); } catch (e) { setMsg(e.message || 'Full report failed.'); } }}>Download full health report (PDF)</button></p>
      {msg && <p className="muted">{msg}</p>}
      {error && <div className="alert alert--error" role="alert"><p>{error}</p></div>}
      {!stats && !error && <p className="muted">{t('loading')}</p>}
      {stats && <>
        <div className="stat-grid">
          <div className="stat-card"><p className="stat-card__value">{stats.total ?? 0}</p><p className="stat-card__label">{t('total_analyses')}</p></div>
          <div className="stat-card"><p className="stat-card__value">{highCount}</p><p className="stat-card__label">{t('high_risk')}</p></div>
          <div className="stat-card"><p className="stat-card__value">{fbAcc == null ? '—' : `${fbAcc}%`}</p><p className="stat-card__label">{t('feedback_accuracy')}{fbTotal ? ` (${fb.right || 0}/${fbTotal})` : ''}</p></div>
          {stats.perModel && <div className="stat-card"><p className="stat-card__value">{Object.values(stats.perModel).reduce((a, b) => a + (Number(b) || 0), 0)}</p><p className="stat-card__label">Analyses by model: {Object.entries(stats.perModel).map(([k, v]) => `${k} ${v}`).join(' · ')}</p></div>}
        </div>
        <h2 className="section__subtitle">Analyses per class</h2><BarChart data={stats.perClass} />
        <h2 className="section__subtitle">Last 30 days</h2><LineChart data={stats.last30Days} />
        <h2 className="section__subtitle">By risk</h2><RiskBar perRisk={stats.perRisk} />
      </>}
      <h2 className="section__subtitle">{t('insights')}</h2>
      <p className="muted">Insights — generated by simple rules from your data, not AI</p>
      {insights.length ? <ul className="bullet-list">{insights.map((ins, i) => <li key={i}>{typeof ins === 'string' ? ins : ins.text || ins.message || JSON.stringify(ins)}</li>)}</ul> : <p className="muted">No insights yet.</p>}
      <h2 className="section__subtitle">{t('reminders')}</h2>
      {reminders.length ? <div className="reminder-list">{reminders.map((r, i) => (
        <div key={r.analysisId || i} className="reminder-item">
          {r.imageUrl && <img src={resolveApiUrl(r.imageUrl)} alt="" className="reminder-thumb" />}
          <div><strong>{r.topClass || 'Lesion'}</strong> — {r.message || `Checked ${r.daysAgo ?? ''} days ago. Consider a follow-up photo.`}<br /><span className="muted">{formatDate(r.createdAt)}{typeof r.daysAgo === 'number' ? ` · ${r.daysAgo} days ago` : ''}</span></div>
        </div>))}</div> : <p className="muted">No follow-up reminders.</p>}
      <h2 className="section__subtitle">Sun safety</h2><UvCard />
      <p><Link to="/analyze" className="btn btn--primary">{t('analyze')}</Link></p>
    </section></div>
  );
}
