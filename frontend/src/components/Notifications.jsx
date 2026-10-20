import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { API_URL, fetchNotifications, markNotificationsRead } from '../api.js';
import { normalizeList } from '../utils/normalize.js';
import { useAuth } from '../context/AuthContext.jsx';

function isUnread(n) { return !(n.read ?? n.isRead ?? n.readAt); }
function iconFor(type) {
  const s = String(type || '').toLowerCase();
  if (s.includes('review')) return '🩺';
  if (s.includes('remind')) return '⏰';
  if (s.includes('uv')) return '☀️';
  if (s.includes('result') || s.includes('analys')) return '🔬';
  return '🔔';
}
function timeStr(v) { if (!v) return ''; const d = new Date(v); return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }

// Navbar bell: socket.io live events + 60s polling fallback.
export default function Notifications() {
  const { isAuthenticated, token } = useAuth();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const socketRef = useRef(null);

  useEffect(() => {
    if (!isAuthenticated) { setItems([]); return undefined; }
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetchNotifications();
        if (cancelled) return;
        const list = normalizeList(r, ['notifications', 'items', 'data']);
        setItems(list);
      } catch { /* keep existing */ }
    };
    load();
    const id = setInterval(load, 60000);
    let socket = null;
    try {
      socket = io(API_URL, { auth: { token: token || localStorage.getItem('dermascan_token') }, transports: ['websocket', 'polling'] });
      socketRef.current = socket;
      socket.on('notification', (n) => { if (!cancelled && n) setItems((prev) => [n, ...prev]); });
    } catch { /* polling fallback remains */ }
    return () => { cancelled = true; clearInterval(id); if (socket) socket.disconnect(); socketRef.current = null; };
  }, [isAuthenticated, token]);

  if (!isAuthenticated) return null;
  const unread = items.filter(isUnread).length;
  const markAll = async () => {
    try { await markNotificationsRead(); } catch { /* still clear locally */ }
    setItems((prev) => prev.map((n) => ({ ...n, read: true, isRead: true })));
  };
  return (
    <div className="notif">
      <button type="button" className="notif__bell" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}>
        🔔{unread > 0 && <span className="notif__badge">{unread}</span>}
      </button>
      {open && (
        <div className="notif__panel">
          <div className="notif__head"><strong>Notifications</strong><button type="button" className="btn btn--ghost btn--sm" onClick={markAll}>Mark all read</button></div>
          {items.length === 0 ? <p className="muted">No notifications yet.</p> : items.slice(0, 20).map((n, i) => (
            <div key={n.id ?? n._id ?? i} className={`notif__item${isUnread(n) ? ' notif__item--unread' : ''}`}>
              <span aria-hidden="true">{iconFor(n.type)}</span>
              <div><p>{n.message || n.text || n.title || 'Notification'}</p><p className="muted">{timeStr(n.createdAt || n.time)}</p></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
