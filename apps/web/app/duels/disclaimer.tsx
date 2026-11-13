import type { JSX } from 'react';

/**
 * DuelsDisclaimer — the educational disclaimer, in the product
 * (blueprint §16, docs/07). Shown on every duels screen.
 */
export function DuelsDisclaimer(): JSX.Element {
  return (
    <p className="mt-8 rounded border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-xs text-amber-200/80">
      Educational purpose only — this is not investment advice. All questions are original Candle
      content. All companies, tickers, and numbers are fictional illustrations.
    </p>
  );
}
