import { useEffect, useState } from 'react';
import { fetchAdminUsers, fetchAdminStats } from '../api.js';
import { normalizeList, formatDate } from '../utils/normalize.js';
import { useAuth } from '../context/AuthContext.jsx';

export default function Admin() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (user?.role !== 'admin') return;
    (async () => {
      try { setUsers(normalizeList(await fetchAdminUsers(), ['users', 'items', 'data'])); } catch (e) { setError(e.message); }
      try { setStats(await fetchAdminStats()); } catch {}
    })();
  }, [user]);
  if (user?.role !== 'admin') return <div className="container"><section className="section"><h1 className="section__title">Admins only</h1><p className="section__lede">This page is available to administrator accounts only.</p></section></div>;
  const cards = stats ? Object.entries(stats).filter(([, v]) => typeof v === 'number' || typeof v === 'string') : [];
  return (
    <div className="container"><section className="section">
      <p className="eyebrow">Admin</p><h1 className="section__title">Admin dashboard</h1>
      {error && <div className="alert alert--error" role="alert"><p>{error}</p></div>}
      {cards.length > 0 && <div className="stat-grid">{cards.map(([k, v]) => <div key={k} className="stat-card"><p className="stat-card__value">{v}</p><p className="stat-card__label">{k}</p></div>)}</div>}
      <h2 className="section__subtitle">Users</h2>
      <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th><th>Analyses</th></tr></thead>
        <tbody>{users.map((u, i) => <tr key={u.id ?? u._id ?? i}><td>{u.name}</td><td>{u.email}</td><td>{u.role || 'user'}</td><td>{formatDate(u.createdAt)}</td><td>{u.analysisCount ?? u.analysesCount ?? u.count ?? '—'}</td></tr>)}</tbody>
      </table></div>
    </section></div>
  );
}
