import { useEffect, useState } from 'react';
import { fetchProfiles, createProfile, updateProfile, deleteProfile } from '../api.js';
import { normalizeList, itemId } from '../utils/normalize.js';

const EMPTY = { name: '', relation: '', birthYear: '', notes: '' };
export default function Profiles() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState(null);
  const [error, setError] = useState(null);
  const load = async () => { try { setItems(normalizeList(await fetchProfiles(), ['profiles', 'items', 'data'])); } catch (e) { setError(e.message); } };
  useEffect(() => { load(); }, []);
  const submit = async (e) => {
    e.preventDefault();
    const data = { ...form, birthYear: form.birthYear ? Number(form.birthYear) : undefined };
    try { if (editingId) await updateProfile(editingId, data); else await createProfile(data); setForm(EMPTY); setEditingId(null); load(); }
    catch (err) { setError(err.message || 'Could not save profile.'); }
  };
  return (
    <div className="container"><section className="section">
      <p className="eyebrow">Family</p><h1 className="section__title">Profiles</h1>
      <p className="section__lede">Keep a separate profile for each family member you track spots for.</p>
      {error && <div className="alert alert--error" role="alert"><p>{error}</p></div>}
      <div className="lesion-grid">
        {items.map((p) => (
          <article key={itemId(p)} className="lesion-card">
            <h3 className="lesion-card__name">{p.name}</h3>
            <p className="lesion-card__desc">{[p.relation, p.birthYear].filter(Boolean).join(' · ')}</p>
            {p.notes && <p className="lesion-card__desc">{p.notes}</p>}
            <div className="action-row">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setEditingId(itemId(p)); setForm({ name: p.name || '', relation: p.relation || '', birthYear: p.birthYear || '', notes: p.notes || '' }); }}>Edit</button>
              <button type="button" className="btn btn--ghost btn--sm" onClick={async () => { if (window.confirm('Delete this profile?')) { await deleteProfile(itemId(p)); load(); } }}>Delete</button>
            </div>
          </article>
        ))}
      </div>
      <form className="form form-card" onSubmit={submit}>
        <h3>{editingId ? 'Edit profile' : 'Add a profile'}</h3>
        <label className="field"><span className="field__label">Name</span><input className="field__input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
        <label className="field"><span className="field__label">Relation</span><input className="field__input" value={form.relation} onChange={(e) => setForm({ ...form, relation: e.target.value })} placeholder="Self, Mother, Father…" /></label>
        <label className="field"><span className="field__label">Birth year</span><input className="field__input" type="number" min="1900" max="2100" value={form.birthYear} onChange={(e) => setForm({ ...form, birthYear: e.target.value })} /></label>
        <label className="field"><span className="field__label">Notes</span><textarea className="field__input" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></label>
        <button type="submit" className="btn btn--primary">{editingId ? 'Save changes' : 'Create profile'}</button>
        {editingId && <button type="button" className="btn btn--ghost" onClick={() => { setEditingId(null); setForm(EMPTY); }}>Cancel edit</button>}
      </form>
    </section></div>
  );
}
