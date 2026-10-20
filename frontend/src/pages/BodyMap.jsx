import { useEffect, useRef, useState } from 'react';
import { fetchSpots, createSpot, deleteSpot, fetchHistory, fetchProfiles, resolveApiUrl } from '../api.js';
import { normalizeList, itemId, topClassOf, formatDate } from '../utils/normalize.js';
import { riskTierFor } from '../utils/lesions.js';

// Simple, dignified body silhouettes (front + back) as SVG paths in a
// 200x400 viewBox per figure. Spots store x/y as % of the viewBox.
function BodyFigure({ side }) {
  return (
    <g fill="var(--paper-deep)" stroke="var(--slate)" strokeWidth="1.5">
      <circle cx="100" cy="26" r="20" />
      <path d="M78 52 L122 52 L128 120 L118 122 L116 210 L106 210 L100 130 L94 210 L84 210 L82 122 L72 120 Z" />
      <path d="M72 58 L54 130 L64 134 L76 96 Z" />
      <path d="M128 58 L146 130 L136 134 L124 96 Z" />
      <text x="100" y="392" textAnchor="middle" fontSize="12" fill="var(--slate)" stroke="none">{side}</text>
    </g>
  );
}

export default function BodyMap() {
  const [spots, setSpots] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [selected, setSelected] = useState(null);
  const [analyses, setAnalyses] = useState([]);
  const [error, setError] = useState(null);
  const svgRef = useRef(null);

  const loadSpots = async () => { try { setSpots(normalizeList(await fetchSpots(), ['spots', 'items', 'data'])); } catch (e) { setError(e.message); } };
  useEffect(() => { loadSpots(); (async () => { try { setProfiles(normalizeList(await fetchProfiles(), ['profiles', 'items', 'data'])); } catch {} })(); }, []);

  const handleClick = async (e, side) => {
    if (e.target.closest('.bodymap__dot')) return;
    const rect = svgRef.current.getBoundingClientRect();
    // Two figures side by side: front occupies left half, back right half (offset 220 in a 420-wide viewBox).
    const vbX = ((e.clientX - rect.left) / rect.width) * 420;
    const vbY = ((e.clientY - rect.top) / rect.height) * 400;
    const offset = side === 'back' ? 220 : 0;
    const x = Math.max(0, Math.min(100, ((vbX - offset) / 200) * 100));
    const y = Math.max(0, Math.min(100, (vbY / 400) * 100));
    const label = window.prompt(`Label for this spot (${side})?`, `${side} spot`);
    if (!label) return;
    let profileId;
    if (profiles.length) {
      const choice = window.prompt(`Profile (optional) — type one of: ${profiles.map((p) => p.name).join(', ')} — or leave blank.`, '');
      const p = profiles.find((x) => x.name === choice);
      if (p) profileId = itemId(p);
    }
    try {
      await createSpot({ label, side, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, profileId });
      loadSpots();
    } catch (err) { setError(err.message || 'Could not save spot.'); }
  };

  const openSpot = async (s) => {
    setSelected(s);
    try { setAnalyses(normalizeList(await fetchHistory({ spotId: itemId(s) }))); } catch { setAnalyses([]); }
  };

  return (
    <div className="container"><section className="section">
      <p className="eyebrow">Tracking</p><h1 className="section__title">Body map</h1>
      <p className="section__lede">Click the body to mark a spot you want to track. Click a dot to see its analysis timeline.</p>
      {error && <div className="alert alert--error" role="alert"><p>{error}</p></div>}
      <div className="bodymap-wrap">
        <svg ref={svgRef} viewBox="0 0 420 400" className="bodymap" role="img" aria-label="Body map, front and back">
          <g onClick={(e) => handleClick(e, 'front')} className="bodymap__side"><BodyFigure side="Front" /></g>
          <g transform="translate(220,0)" onClick={(e) => handleClick(e, 'back')} className="bodymap__side"><BodyFigure side="Back" /></g>
          {spots.map((s) => {
            const side = (s.side || 'front').toLowerCase().includes('back') ? 'back' : 'front';
            const cx = (side === 'back' ? 220 : 0) + ((Number(s.x) || 0) / 100) * 200;
            const cy = ((Number(s.y) || 0) / 100) * 400;
            return <circle key={itemId(s)} className="bodymap__dot" cx={cx} cy={cy} r="7" fill="#b3402a" stroke="#fff" strokeWidth="2" onClick={(e) => { e.stopPropagation(); openSpot(s); }}><title>{s.label || 'Spot'}</title></circle>;
          })}
        </svg>
        <aside className="bodymap-panel">
          {selected ? <>
            <h3>{selected.label || 'Spot'}</h3>
            <p className="muted">{selected.side || 'front'} · x {selected.x}% · y {selected.y}%</p>
            <h4>Analysis timeline</h4>
            {analyses.length ? <ul className="timeline">{analyses.map((a) => {
              const tc = topClassOf(a); const tier = riskTierFor(tc);
              return <li key={itemId(a)} className="timeline-item">
                {a.imageUrl && <img src={resolveApiUrl(a.imageUrl)} alt="" className="reminder-thumb" />}
                <span>{formatDate(a.createdAt)} — <strong>{tc}</strong> <span className={`badge badge--${tier.toLowerCase()}`}>{tier}</span></span>
              </li>;
            })}</ul> : <p className="muted">No analyses linked to this spot yet. Choose it in the Analyze page when you upload.</p>}
            <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { if (window.confirm('Delete this spot?')) { await deleteSpot(itemId(selected)); setSelected(null); loadSpots(); } }}>Delete spot</button>
          </> : <p className="muted">No spot selected. Click a dot, or click the body to add one.</p>}
          <h4>All spots ({spots.length})</h4>
          <ul className="bullet-list">{spots.map((s) => <li key={itemId(s)}><button type="button" className="link-btn" onClick={() => openSpot(s)}>{s.label || 'Spot'} ({s.side || 'front'})</button></li>)}</ul>
        </aside>
      </div>
    </section></div>
  );
}
