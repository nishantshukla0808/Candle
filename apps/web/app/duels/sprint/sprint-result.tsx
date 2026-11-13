import type { JSX } from 'react';
import type { SprintResultResponse } from '../../../lib/api';

/** Stored Paper Trading Sprint result (docs/14 §3/§7) — risk, not just return. */
export function SprintResultView({ result }: { result: SprintResultResponse }): JSX.Element {
  const headline =
    result.result === 'WIN' ? 'You won' : result.result === 'DRAW' ? 'Draw' : 'You lost';
  const score = result.riskAdjustedScore;
  return (
    <div className="space-y-4">
      <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-xl font-bold">
          {headline} — risk-adjusted score {score}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {result.opponent.name} ({result.opponent.kind === 'BOT' ? 'Mira, bot' : 'opponent'})
          scored {result.opponent.riskAdjustedScore} · final equity ₹
          {result.opponent.finalEquity ?? '—'} · {result.opponent.tradeCount} trades.
        </p>
        <p className="mt-2 text-sm">
          Final equity ₹{result.finalEquity} · return {result.returnPct >= 0 ? '+' : ''}
          {result.returnPct}% · {result.tradeCount} trades
        </p>
        <p className="mt-1 text-sm text-slate-400">
          Realised volatility {result.realisedVolPct}% · max drawdown {result.maxDrawdownPct}% — the
          winner is the best risk-adjusted return, not the highest return.
        </p>
        <p className="mt-2 text-sm">{result.ratingReason}</p>
        <p className="mt-1 text-sm text-slate-400">
          +{result.xp.awarded} XP · {result.xp.totalXp} total XP · level {result.xp.level}
          {result.xp.levelUp ? ' — level up!' : ''} · streak {result.xp.currentStreak}
        </p>
      </div>

      <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="font-medium">Per instrument</h3>
        {result.perInstrument.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No trades this sprint.</p>
        ) : (
          <ul className="mt-2 space-y-1 text-sm">
            {result.perInstrument.map((p) => (
              <li key={p.instrumentId} className="flex justify-between gap-2">
                <span>
                  {p.symbol} · {p.trades} trades · bought {p.buyQty} · sold {p.sellQty}
                </span>
                <span className="text-slate-400">
                  realised {p.realisedPnl >= 0 ? '+' : ''}₹{p.realisedPnl}
                  {p.finalQty > 0 ? ` · holding ${p.finalQty} (₹${p.finalValue})` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
