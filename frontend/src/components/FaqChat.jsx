import { useState } from 'react';

// Rule-based FAQ assistant — keyword matching only, no AI. Honest labelling.
const QA = [
  { keys: ['sunscreen', 'spf', 'sun protection', 'सनस्क्रीन', 'धूप'], a: 'Use a broad-spectrum SPF 30+ sunscreen, apply generously 15–20 minutes before going out, and reapply every 2 hours (and after sweating or swimming).' },
  { keys: ['mole', 'moles', 'तिल', 'मस्सा'], a: 'Most moles are harmless. Watch for change using ABCDE: Asymmetry, Border irregularity, Colour variation, Diameter over 6mm, and Evolving (changing). Any changing mole should be seen by a dermatologist.' },
  { keys: ['abcde'], a: 'ABCDE stands for Asymmetry, Border, Colour, Diameter and Evolving — five warning signs to check on a mole. Try our guided ABCDE checklist page for a step-by-step self-assessment (not a diagnosis).' },
  { keys: ['doctor', 'dermatologist', 'when to see', 'डॉक्टर', 'दिखाना'], a: 'See a dermatologist promptly if a spot is new and growing, changing in shape or colour, bleeding, itching, not healing, or simply looks very different from your other spots ("ugly duckling").' },
  { keys: ['how does', 'how it works', 'analyze', 'analysis', 'जांच', 'कैसे काम'], a: 'Upload a clear, well-lit close-up photo on the Analyze page. A neural network (MobileNetV2 or EfficientNet-B0, trained on the HAM10000 dataset) returns its three most likely categories with probabilities. It is an educational signal only.' },
  { keys: ['accuracy', 'accurate', 'reliable', 'trust'], a: 'The model is a student demo trained on HAM10000. Its validation accuracy and per-class scores are shown honestly on the Model page — some classes (like melanoma) are much harder and the model misses many. Never rely on it alone.' },
  { keys: ['melanoma', 'skin cancer', 'cancer', 'कैंसर'], a: 'Melanoma is the most dangerous skin cancer and needs urgent dermatologist review. Early detection matters a lot — a changing, irregular dark spot should always be checked in person.' },
  { keys: ['photo', 'picture', 'upload', 'तस्वीर', 'फोटो'], a: 'For the best result: use good natural light, keep the lesion in sharp focus, fill the frame with the spot, avoid flash glare, and include a clean ruler/coin nearby only if you want a size reference.' },
  { keys: ['uv', 'sunburn', 'tan', 'sun'], a: 'UV is strongest between 11am and 3pm. Seek shade, wear a hat and protective clothing, and check the UV card on your Dashboard for today\'s index and advice.' },
  { keys: ['data', 'privacy', 'private', 'history', 'saved'], a: 'Your analyses are saved to your account history so you can track spots over time. You can delete any analysis from the History page. Shared links are only created when you tap Share.' },
  { keys: ['itch', 'bleed', 'bleeding', 'pain', 'खुजली', 'खून'], a: 'A spot that itches persistently, bleeds, crusts or does not heal within a few weeks should be examined by a doctor in person — please do not rely on this app for that.' },
];

const FALLBACK = 'I can only answer common questions — try asking about sunscreen, moles, or when to see a doctor.';

export default function FaqChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([{ from: 'bot', text: 'Hi! Ask me a common question about skin care or how this app works.' }]);
  const [input, setInput] = useState('');

  const ask = (e) => {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    const lower = q.toLowerCase();
    const hit = QA.find((entry) => entry.keys.some((k) => lower.includes(k)));
    setMessages((m) => [...m, { from: 'user', text: q }, { from: 'bot', text: hit ? hit.a : FALLBACK }]);
    setInput('');
  };

  return (
    <>
      <button type="button" className="faq-fab" onClick={() => setOpen((o) => !o)} aria-label="Open FAQ assistant">?</button>
      {open && (
        <div className="faq-panel">
          <div className="faq-panel__head">
            <strong>FAQ assistant (rule-based)</strong>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>Close</button>
          </div>
          <div className="faq-panel__messages">
            {messages.map((m, i) => <p key={i} className={`faq-msg faq-msg--${m.from}`}>{m.text}</p>)}
          </div>
          <form onSubmit={ask} className="faq-panel__form">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about sunscreen, moles…" aria-label="Your question" />
            <button type="submit" className="btn btn--primary btn--sm">Ask</button>
          </form>
          <p className="faq-panel__disclaimer">Educational demo — not a medical device. This assistant matches keywords to fixed answers; it is not AI and not a diagnosis.</p>
        </div>
      )}
    </>
  );
}
