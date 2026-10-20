import { useEffect, useState } from 'react';
import { pingHealth } from '../api.js';

// Slim banner under the navbar when backend/ML services are unreachable.
export default function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      const h = await pingHealth();
      if (!cancelled) setOffline(!h.ok);
    };
    check();
    const id = setInterval(check, 30000);
    const onOnline = () => check();
    const onOffline = () => setOffline(true);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => { cancelled = true; clearInterval(id); window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline); };
  }, []);
  if (!offline) return null;
  return (
    <div className="offline-banner" role="status">
      Services are unreachable — you&apos;re viewing cached pages. Live analysis is unavailable.
    </div>
  );
}
