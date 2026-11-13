'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { api, ApiClientError, type PortfolioView } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { SimulatorDisclaimer } from './disclaimer';

/** Portfolio view — virtual cash, holdings at simulated prices, total equity. */
export default function SimulatorPage(): JSX.Element {
  const { accessToken, user, loading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<PortfolioView | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const d = await api<PortfolioView>('/simulator/portfolio', { token: accessToken });
        if (!cancelled) setData(d);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiClientError ? err.message : 'Failed to load portfolio.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, accessToken, router]);

  if (error) return <p className="text-red-400 py-10">{error}</p>;
  if (!data) return <p className="text-slate-400 py-10">Loading portfolio…</p>;

  return (
    <div className="py-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Simulator portfolio</h1>
        <div className="flex gap-3 text-sm">
          <Link
            href="/simulator/trade"
            className="text-amber-300 hover:text-amber-200 underline underline-offset-2"
          >
            Trade
          </Link>
          <Link
            href="/simulator/orders"
            className="text-amber-300 hover:text-amber-200 underline underline-offset-2"
          >
            Order history
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="border border-slate-800 rounded p-4 bg-slate-900/50">
          <p className="text-xs text-slate-500 uppercase">Virtual cash</p>
          <p className="text-3xl font-bold text-slate-100">₹{data.cash}</p>
        </div>
        <div className="border border-slate-800 rounded p-4 bg-slate-900/50">
          <p className="text-xs text-slate-500 uppercase">Total equity</p>
          <p className="text-3xl font-bold text-amber-300">₹{data.totalEquity}</p>
        </div>
      </div>

      <h2 className="mt-8 text-lg font-semibold">Holdings</h2>
      {data.holdings.length === 0 ? (
        <p className="mt-3 text-slate-500">
          No positions yet.{' '}
          <Link href="/simulator/trade" className="text-amber-300 underline underline-offset-2">
            Place your first simulated trade
          </Link>
          .
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 uppercase">
                <th className="py-2 pr-4">Ticker</th>
                <th className="py-2 pr-4 text-right">Qty</th>
                <th className="py-2 pr-4 text-right">Avg cost</th>
                <th className="py-2 pr-4 text-right">Price</th>
                <th className="py-2 pr-4 text-right">Value</th>
                <th className="py-2 text-right">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h) => {
                const pnl = Number(h.unrealizedPnl);
                return (
                  <tr key={h.instrumentId} className="border-t border-slate-800">
                    <td className="py-2 pr-4">
                      <span className="font-semibold text-amber-200">{h.symbol}</span>
                      <span className="ml-2 text-slate-500">{h.name}</span>
                    </td>
                    <td className="py-2 pr-4 text-right">{h.quantity}</td>
                    <td className="py-2 pr-4 text-right">₹{h.avgCost}</td>
                    <td className="py-2 pr-4 text-right">₹{h.currentPrice}</td>
                    <td className="py-2 pr-4 text-right">₹{h.marketValue}</td>
                    <td
                      className={`py-2 text-right ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {pnl >= 0 ? '+' : ''}₹{h.unrealizedPnl}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <SimulatorDisclaimer />
    </div>
  );
}
