import type { JSX } from 'react';

/**
 * SimulatorDisclaimer — the educational disclaimer, in the product
 * (blueprint §16, ADR 0003/1). Shown on every simulator screen.
 */
export function SimulatorDisclaimer(): JSX.Element {
  return (
    <p className="mt-8 rounded border border-amber-400/30 bg-amber-400/5 px-4 py-3 text-xs text-amber-200/80">
      Educational purpose only — this is not investment advice. All tickers are fictional and all
      money is virtual.
    </p>
  );
}
