import { useEffect, useState } from 'react';

// Dark-mode toggle: [data-theme='dark'] on <html>, persisted in localStorage.
export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('dermascan_theme', theme); } catch { /* ignore */ }
}
export function initTheme() {
  let saved = 'light';
  try { saved = localStorage.getItem('dermascan_theme') || 'light'; } catch { /* ignore */ }
  document.documentElement.dataset.theme = saved;
  return saved;
}
export default function ThemeToggle() {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme || initTheme());
  useEffect(() => { applyTheme(theme); }, [theme]);
  return (
    <button type="button" className="btn btn--ghost btn--sm theme-toggle" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} aria-label="Toggle dark mode" title="Toggle dark mode">
      {theme === 'dark' ? '☀️' : '🌙'}
    </button>
  );
}
