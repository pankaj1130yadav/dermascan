// The standing medical disclaimer, rendered verbatim everywhere it matters.
export const DISCLAIMER_TEXT =
  'Educational demo — not a medical device. Model predictions are experimental.';

export default function Disclaimer({ compact = false }) {
  return (
    <div className={compact ? 'disclaimer disclaimer--compact' : 'disclaimer'}>
      <p>
        <strong>Medical disclaimer:</strong> {DISCLAIMER_TEXT} This app is for
        learning and awareness only — it is not a diagnosis, and it never
        replaces a qualified dermatologist.
      </p>
    </div>
  );
}
