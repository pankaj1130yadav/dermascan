import { useEffect, useState } from 'react';
import { fetchDoctors, fetchBookings, createBooking, cancelBooking } from '../api.js';
import { normalizeList, itemId, formatDate } from '../utils/normalize.js';

export default function Consult() {
  const [doctors, setDoctors] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [form, setForm] = useState({ doctorId: '', when: '', reason: '' });
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const load = async () => {
    try { setDoctors(normalizeList(await fetchDoctors(), ['doctors', 'items', 'data'])); } catch (e) { setError(e.message); }
    try { setBookings(normalizeList(await fetchBookings(), ['bookings', 'items', 'data'])); } catch {}
  };
  useEffect(() => { load(); }, []);
  const doctorName = (id) => doctors.find((d) => String(itemId(d)) === String(id))?.name || 'Doctor';
  const submit = async (e) => {
    e.preventDefault();
    const payload = { doctorId: form.doctorId, doctor: doctorName(form.doctorId), dateTime: form.when, when: form.when, datetime: form.when, reason: form.reason };
    try { await createBooking(payload); setMsg('Booking created (demo).'); setForm({ doctorId: '', when: '', reason: '' }); load(); }
    catch (err) { setError(err.message || 'Booking failed.'); }
  };
  return (
    <div className="container"><section className="section">
      <p className="eyebrow">Demo</p><h1 className="section__title">Consult a doctor</h1>
      <div className="alert" role="note"><p className="alert__title">Demo data — fictional doctors, booking is for demonstration only</p><p>No real appointment is made. For real concerns, visit a dermatologist in person.</p></div>
      {error && <div className="alert alert--error" role="alert"><p>{error}</p></div>}
      {msg && <p className="muted">{msg}</p>}
      <div className="lesion-grid">
        {doctors.map((d) => (
          <article key={itemId(d)} className="lesion-card">
            <h3 className="lesion-card__name">{d.name}</h3>
            <p className="lesion-card__desc">{[d.specialty || d.specialization, d.experience && `${d.experience} experience`, d.location || d.city].filter(Boolean).join(' · ')}</p>
            {d.notes && <p className="lesion-card__desc">{d.notes}</p>}
          </article>
        ))}
      </div>
      <form className="form form-card" onSubmit={submit}>
        <h3>Book a (demo) appointment</h3>
        <label className="field"><span className="field__label">Doctor</span>
          <select className="field__input" required value={form.doctorId} onChange={(e) => setForm({ ...form, doctorId: e.target.value })}>
            <option value="">Choose a doctor…</option>
            {doctors.map((d) => <option key={itemId(d)} value={itemId(d)}>{d.name}</option>)}
          </select></label>
        <label className="field"><span className="field__label">Date & time</span><input className="field__input" type="datetime-local" required value={form.when} onChange={(e) => setForm({ ...form, when: e.target.value })} /></label>
        <label className="field"><span className="field__label">Reason</span><textarea className="field__input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
        <button type="submit" className="btn btn--primary">Book (demo)</button>
      </form>
      <h2 className="section__subtitle">My bookings</h2>
      {bookings.length ? <ul className="booking-list">{bookings.map((b) => (
        <li key={itemId(b)} className="booking-item">
          <span><strong>{b.doctorName || doctorName(b.doctorId || b.doctor)}</strong> — {formatDate(b.dateTime || b.when || b.datetime || b.createdAt)}{b.reason ? ` · ${b.reason}` : ''}</span>
          <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { await cancelBooking(itemId(b)); load(); }}>Cancel</button>
        </li>))}</ul> : <p className="muted">No bookings yet.</p>}
    </section></div>
  );
}
