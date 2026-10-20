// Static metadata for the 7 HAM10000 lesion categories the model is trained
// on, plus a coarse risk-tier mapping used for the advisory callout.
//
// Risk tiers are deliberately coarse and educational — they describe how a
// clinician would prioritise a lesion class, not a diagnosis.

export const LESION_TYPES = [
  {
    id: 'akiec',
    name: 'Actinic Keratosis',
    description: 'Rough, scaly patch from long-term sun exposure; can rarely progress, so it is usually monitored or removed.',
  },
  {
    id: 'bcc',
    name: 'Basal Cell Carcinoma',
    description: 'The most common skin cancer — a slow-growing pearly or waxy bump that needs medical treatment.',
  },
  {
    id: 'bkl',
    name: 'Benign Keratosis',
    description: 'A non-cancerous, often waxy or stuck-on growth (seborrheic keratosis); harmless but sometimes biopsied to be sure.',
  },
  {
    id: 'df',
    name: 'Dermatofibroma',
    description: 'A small, firm, harmless nodule that dimples inward when pinched; no treatment needed unless it bothers you.',
  },
  {
    id: 'mel',
    name: 'Melanoma',
    description: 'The most dangerous skin cancer — an irregular, changing dark spot that demands urgent dermatologist review.',
  },
  {
    id: 'nv',
    name: 'Melanocytic Nevus',
    description: 'An ordinary mole; benign, but any change in size, shape or colour deserves a professional look.',
  },
  {
    id: 'vasc',
    name: 'Vascular Lesion',
    description: 'A red or purple mark made of blood vessels (e.g. cherry angioma); almost always benign.',
  },
];

// Maps a predicted class id/name to a coarse risk tier for the UI callout.
export function riskTierFor(classId) {
  const id = String(classId || '').toLowerCase();
  if (['mel', 'melanoma'].some((k) => id.includes(k))) return 'High';
  if (['bcc', 'basal'].some((k) => id.includes(k))) return 'High';
  if (['akiec', 'actinic'].some((k) => id.includes(k))) return 'Moderate';
  return 'Low';
}
