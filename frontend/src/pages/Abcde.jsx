import { useState } from 'react';
import { Link } from 'react-router-dom';
import Disclaimer from '../components/Disclaimer.jsx';
import { useLang } from '../i18n.jsx';

const GROUPS = [
  { letter: 'A', name: 'Asymmetry', q: 'If you draw a line through the middle, do the two halves match?', options: [{ label: 'Halves look similar', score: 0 }, { label: 'Halves look different', score: 2 }, { label: 'Not sure', score: 1 }] },
  { letter: 'B', name: 'Border', q: 'How do the edges look?', options: [{ label: 'Smooth and even', score: 0 }, { label: 'Irregular, jagged or blurred', score: 2 }, { label: 'Not sure', score: 1 }] },
  { letter: 'C', name: 'Colour', q: 'How many colours are in the spot?', options: [{ label: 'One even colour', score: 0 }, { label: 'Two or more colours / uneven shades', score: 2 }, { label: 'Not sure', score: 1 }] },
  { letter: 'D', name: 'Diameter', q: 'Is it bigger than a pencil eraser (about 6 mm)?', options: [{ label: 'Smaller than 6 mm', score: 0 }, { label: '6 mm or larger', score: 2 }, { label: 'Not sure', score: 1 }] },
  { letter: 'E', name: 'Evolving', q: 'Has the spot changed in size, shape, colour, or started itching/bleeding?', options: [{ label: 'No change', score: 0 }, { label: 'Yes, it has changed', score: 3 }, { label: 'Not sure', score: 1 }] },
];

export default function Abcde() {
  const { t } = useLang();
  const [answers, setAnswers] = useState({});
  const done = GROUPS.every((g) => answers[g.letter] != null);
  const score = GROUPS.reduce((a, g) => a + (answers[g.letter] || 0), 0);
  const higher = score >= 4;
  return (
    <div className="container"><section className="section">
      <p className="eyebrow">Self-check</p>
      <h1 className="section__title">{t('abcde_title')}</h1>
      <p className="section__lede">{t('abcde_lede')}</p>
      <div className="alert" role="note"><p className="alert__title">Self-assessment checklist — this is NOT a diagnosis</p><p>Only a dermatologist can diagnose a skin lesion. When in doubt, get checked in person.</p></div>
      {GROUPS.map((g) => (
        <fieldset key={g.letter} className="abcde-group">
          <legend><span className="abcde__letter">{g.letter}</span> <strong>{g.name}</strong> — {g.q}</legend>
          {g.options.map((o) => (
            <label key={o.label} className="radio-row">
              <input type="radio" name={g.letter} checked={answers[g.letter] === o.score && answers[`${g.letter}_label`] === o.label} onChange={() => setAnswers((a) => ({ ...a, [g.letter]: o.score, [`${g.letter}_label`]: o.label }))} /> {o.label}
            </label>
          ))}
        </fieldset>
      ))}
      {done && (
        <div className={`risk-callout risk-callout--${higher ? 'high' : 'low'}`}>
          <p className="risk-callout__tier">{higher ? 'Higher concern — please see a dermatologist' : 'Lower concern on this checklist'}</p>
          <p className="risk-callout__text">{higher ? 'Your answers include one or more warning signs. Book an in-person dermatologist appointment soon — do not wait on an app result.' : 'No strong warning signs in your answers. Keep watching the spot, repeat this check if anything changes, and mention it at your next skin check. This checklist can miss things — trust your eyes and a doctor over this score.'} (Score: {score})</p>
        </div>
      )}
      <p style={{ marginTop: 24 }}><Link to="/analyze" className="btn btn--primary btn--lg">{t('analyze')}</Link></p>
      <Disclaimer compact />
    </section></div>
  );
}
