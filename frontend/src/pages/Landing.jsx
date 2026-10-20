import { Link } from 'react-router-dom';
import Disclaimer from '../components/Disclaimer.jsx';
import { LESION_TYPES } from '../utils/lesions.js';
import { useLang } from '../i18n.jsx';

// Public landing page: editorial hero, 3-step explainer, the 7 lesion types,
// and the prominent medical disclaimer banner.
export default function Landing() {
  const { t } = useLang();
  return (
    <div>
      {/* Hero */}
      <section className="hero">
        <p className="eyebrow">{t('landing_eyebrow')}</p>
        <h1 className="hero__title">
          {t('landing_title_1')}
          <br />
          <span className="hero__title--accent">{t('landing_title_2')}</span>
        </h1>
        <p className="hero__sub">
{t('landing_sub')}
        </p>
        <div className="hero__cta">
          <Link to="/analyze" className="btn btn--primary btn--lg">
            {t('analyze_title')}
          </Link>
          <Link to="/learn" className="btn btn--ghost btn--lg">
            Learn the ABCDE rule
          </Link>
        </div>
      </section>

      <Disclaimer />

      {/* How it works */}
      <section className="section">
        <div className="container">
          <p className="eyebrow">How it works</p>
          <h2 className="section__title">{t('how_it_works')}</h2>
          <div className="steps">
            <article className="step">
              <p className="step__number">01</p>
              <h3 className="step__title">Photograph the lesion</h3>
              <p className="step__text">
                Take a clear, well-lit close-up photo of the spot you want to
                understand better. Good light and sharp focus matter more than
                any camera.
              </p>
            </article>
            <article className="step">
              <p className="step__number">02</p>
              <h3 className="step__title">The model studies it</h3>
              <p className="step__text">
                A MobileNetV2 neural network, fine-tuned on the public HAM10000
                dermatology dataset, compares your image against seven known
                lesion categories.
              </p>
            </article>
            <article className="step">
              <p className="step__number">03</p>
              <h3 className="step__title">Read the signal</h3>
              <p className="step__text">
                You get the three most likely categories with probability bars
                and a plain-language risk tier — a starting point for a
                conversation with a doctor, not a conclusion.
              </p>
            </article>
          </div>
        </div>
      </section>

      {/* The 7 lesion types */}
      <section className="section section--tint">
        <div className="container">
          <p className="eyebrow">What the model knows</p>
          <h2 className="section__title">The 7 lesion types</h2>
          <p className="section__lede">
            These are the categories of the HAM10000 dataset. Some are
            harmless, some are common cancers, one is dangerous — knowing the
            difference is the whole point.
          </p>
          <div className="lesion-grid">
            {LESION_TYPES.map((lesion) => (
              <article key={lesion.id} className="lesion-card">
                <h3 className="lesion-card__name">{lesion.name}</h3>
                <p className="lesion-card__desc">{lesion.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section className="section">
        <div className="container container--narrow">
          <h2 className="section__title section__title--centered">
            Curiosity is the first screening
          </h2>
          <p className="section__lede section__lede--centered">
            Create a free account to analyze a photo and keep a personal
            history of the spots you are watching.
          </p>
          <div className="hero__cta hero__cta--centered">
            <Link to="/register" className="btn btn--primary btn--lg">
              Analyze a lesion
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
