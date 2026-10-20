import { useEffect, useState } from 'react';

function bandFor(uv) {
  if (uv == null || Number.isNaN(uv)) return null;
  if (uv < 3) return { label: 'Low', advice: 'Minimal protection needed for most people.' };
  if (uv < 6) return { label: 'Moderate', advice: 'Wear sunscreen SPF 30+ and seek shade around midday.' };
  if (uv < 8) return { label: 'High', advice: 'Sunscreen SPF 30+, hat and shade — reduce midday sun.' };
  if (uv < 11) return { label: 'Very high', advice: 'Avoid midday sun, SPF 50, protective clothing and shade are important.' };
  return { label: 'Extreme', advice: 'Stay in shade as much as possible; unprotected skin can burn quickly.' };
}

// UV card: Open-Meteo daily UV max. Default Roorkee (29.8543, 77.8880).
export default function UvCard() {
  const [uv, setUv] = useState(null);
  const [failed, setFailed] = useState(false);
  const [locLabel, setLocLabel] = useState('Roorkee (default)');

  const load = async (lat, lon, label) => {
    setFailed(false);
    try {
      const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=uv_index_max&timezone=auto`);
      if (!res.ok) throw new Error('uv');
      const data = await res.json();
      const v = data?.daily?.uv_index_max?.[0];
      if (typeof v !== 'number') throw new Error('uv');
      setUv(v); setLocLabel(label);
    } catch { setFailed(true); setUv(null); }
  };
  useEffect(() => { load(29.8543, 77.8880, 'Roorkee (default)'); }, []);

  const useMyLocation = () => {
    if (!navigator.geolocation) { setFailed(true); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => load(pos.coords.latitude, pos.coords.longitude, 'Your location'),
      () => setFailed(true),
    );
  };
  const band = bandFor(uv);
  return (
    <div className="info-card">
      <h3>Today&apos;s UV index</h3>
      {failed ? <p>UV data unavailable right now</p> : uv == null ? <p className="muted">Loading UV…</p> : (
        <>
          <p className="uv-value">{uv} <span className="badge">{band.label}</span></p>
          <p>{band.advice}</p>
          <p className="muted">{locLabel} · Source: Open-Meteo</p>
        </>
      )}
      <button type="button" className="btn btn--ghost btn--sm" onClick={useMyLocation}>Use my location</button>
    </div>
  );
}
