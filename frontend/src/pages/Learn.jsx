import Disclaimer from '../components/Disclaimer.jsx';
import { LESION_TYPES } from '../utils/lesions.js';

const ABCDE = [
  {
    letter: 'A',
    name: 'Asymmetry',
    text: 'Draw an imaginary line through the middle of the spot. Melanomas tend to be asymmetrical — the two halves do not match.',
  },
  {
    letter: 'B',
    name: 'Border',
    text: 'Ordinary moles usually have smooth, even borders. Melanomas often have ragged, blurred or irregular edges.',
  },
  {
    letter: 'C',
    name: 'Colour',
    text: 'A benign mole is usually one even shade of brown. Multiple colours — tan, brown, black, red, white or blue — are a warning sign.',
  },
  {
    letter: 'D',
    name: 'Diameter',
    text: 'Melanomas are often larger than 6 mm (about the size of a pencil eraser) when found — though they can be smaller.',
  },
  {
    letter: 'E',
    name: 'Evolving',
    text: 'The most important letter. Any change — in size, shape, colour, elevation, or new symptoms like itching or bleeding — deserves a dermatologist’s eyes.',
  },
];

// Educational page: the ABCDE rule, when to see a doctor, and a short note on
// the seven lesion types the model was trained on.
export default function Learn() {
  return (
    <div className="container">
      <section className="section">
        <p className="eyebrow">Know the signs</p>
        <h1 className="section__title">The ABCDE rule of melanoma</h1>
        <p className="section__lede">
          Dermatologists teach patients a five-letter checklist. It takes a
          minute to learn and it is the single most useful thing a non-expert
          can know about skin cancer.
        </p>

        <ol className="abcde">
          {ABCDE.map((item) => (
            <li key={item.letter} className="abcde__item">
              <span className="abcde__letter" aria-hidden="true">
                {item.letter}
              </span>
              <div>
                <h2 className="abcde__name">{item.name}</h2>
                <p className="abcde__text">{item.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <h2 className="section__subtitle">When to see a doctor</h2>
        <ul className="bullet-list">
          <li>A spot that is new, changing, or looks different from your other moles.</li>
          <li>Any sore that does not heal within a few weeks.</li>
          <li>A spot that itches, bleeds, crusts or becomes painful.</li>
          <li>A dark streak under a fingernail or toenail that you cannot explain.</li>
          <li>If you have many moles, very fair skin, or a family history of melanoma — ask about a full-body skin check.</li>
        </ul>

        <h2 className="section__subtitle">A note on the seven lesion types</h2>
        <p className="prose">
          The model behind DermaScan was trained on the HAM10000 dataset, which
          groups lesions into seven categories. Not all of them are cancer —
          benign keratoses, dermatofibromas and ordinary moles are harmless,
          vascular lesions are almost always harmless, and actinic keratoses
          sit in a watchful middle ground. Basal cell carcinoma and melanoma
          are the two cancers in the set, and melanoma is by far the more
          dangerous one. The model can sort a photograph into these buckets;
          only a dermatologist — usually with a biopsy — can say what a spot
          actually is.
        </p>

        <Disclaimer />
      </section>
    </div>
  );
}
