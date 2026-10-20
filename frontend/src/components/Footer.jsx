import { Link } from 'react-router-dom';
import { DISCLAIMER_TEXT } from './Disclaimer.jsx';

// Site footer: quiet ink band with the mandatory disclaimer, nav and credit.
export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__inner">
        <div className="footer__brand">
          <span className="footer__wordmark">DermaScan</span>
          <p className="footer__tagline">
            Early skin-lesion awareness, presented as an educational demo.
          </p>
        </div>
        <nav className="footer__nav" aria-label="Footer">
          <Link to="/">Home</Link>
          <Link to="/analyze">Analyze</Link>
          <Link to="/learn">Learn</Link>
          <Link to="/history">History</Link>
        </nav>
        <p className="footer__disclaimer">{DISCLAIMER_TEXT}</p>
        <p className="footer__credit">
          A final-year BTech project demo. Built with a fine-tuned MobileNetV2
          model.
        </p>
      </div>
    </footer>
  );
}
