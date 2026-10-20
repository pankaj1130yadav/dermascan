import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useLang } from '../i18n.jsx';
import Notifications from './Notifications.jsx';
import ThemeToggle from './ThemeToggle.jsx';

// Site header: serif wordmark, editorial nav, language + theme toggles,
// notification bell (authenticated), admin / review-queue links by role.
export default function Navbar() {
  const { isAuthenticated, user, logout } = useAuth();
  const { lang, setLang, t } = useLang();
  const navigate = useNavigate();
  const handleLogout = () => { logout(); navigate('/'); };
  const role = user?.role;
  return (
    <header className="navbar">
      <div className="navbar__inner">
        <Link to="/" className="navbar__wordmark">DermaScan</Link>
        <nav className="navbar__nav" aria-label="Primary">
          <NavLink to="/" className="navbar__link">{t('home')}</NavLink>
          <NavLink to="/analyze" className="navbar__link">{t('analyze')}</NavLink>
          <NavLink to="/learn" className="navbar__link">{t('learn')}</NavLink>
          <NavLink to="/model" className="navbar__link">{t('model')}</NavLink>
          <NavLink to="/gallery" className="navbar__link">{t('gallery')}</NavLink>
          <NavLink to="/abcde" className="navbar__link">{t('abcde')}</NavLink>
          {isAuthenticated && <>
            <NavLink to="/dashboard" className="navbar__link">{t('dashboard')}</NavLink>
            <NavLink to="/history" className="navbar__link">{t('history')}</NavLink>
            <NavLink to="/bodymap" className="navbar__link">{t('bodymap')}</NavLink>
            <NavLink to="/consult" className="navbar__link">{t('consult')}</NavLink>
            <NavLink to="/profiles" className="navbar__link">{t('profiles')}</NavLink>
            {(role === 'doctor' || role === 'admin') && <NavLink to="/reviews" className="navbar__link">Review queue</NavLink>}
            {role === 'admin' && <NavLink to="/admin" className="navbar__link">{t('admin')}</NavLink>}
          </>}
          <button type="button" className="btn btn--ghost btn--sm lang-toggle" onClick={() => setLang(lang === 'hi' ? 'en' : 'hi')} aria-label="Switch language">{lang === 'hi' ? 'EN' : 'हिं'}</button>
          <ThemeToggle />
          <Notifications />
          {isAuthenticated ? (
            <>
              <span className="navbar__user" title={user?.email || ''}>{user?.name || user?.email || 'Account'}</span>
              <button type="button" className="btn btn--ghost btn--sm" onClick={handleLogout}>{t('logout')}</button>
            </>
          ) : (
            <>
              <NavLink to="/login" className="navbar__link">{t('login')}</NavLink>
              <Link to="/register" className="btn btn--primary btn--sm">{t('signup')}</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
