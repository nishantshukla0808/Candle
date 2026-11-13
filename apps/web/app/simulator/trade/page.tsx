'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  api,
  ApiClientError,
  type InstrumentQuote,
  type PlaceOrderResponse,
  type PortfolioView,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { SimulatorDisclaimer } from '../disclaimer';

/** Trade ticket — buy/sell fictional instruments with virtual cash. */
export default function TradePage(): JSX.Element {
  const { accessToken, user, loading } = useAuth();
  const router = useRouter();
  const [instruments, setInstruments] = useState<InstrumentQuote[] | null>(null);
  const [cash, setCash] = useState('');
  const [instrumentId, setInstrumentId] = useState('');
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY');
  const [quantity, setQuantity] = useState('10');
  const [error, setError] = useState('');
  const [result, setResult] = useState<PlaceOrderResponse | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [quotes, portfolio] = await Promise.all([
          api<InstrumentQuote[]>('/simulator/instruments', { token: accessToken }),
          api<PortfolioView>('/simulator/portfolio', { token: accessToken }),
        ]);
        if (cancelled) return;
        setInstruments(quotes);
        setCash(portfolio.cash);
        const first = quotes[0];
        if (first) setInstrumentId(first.id);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiClientError ? err.message : 'Failed to load trade data.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, accessToken, router]);

  const selected = instruments?.find((i) => i.id === instrumentId) ?? null;
  const qty = Number(quantity);
  const estimate = selected && Number.isFinite(qty) && qty > 0 ? Number(selected.price) * qty : 0;

  async function submit(): Promise<void> {
    setError('');
    setResult(null);
    if (!selected || !Number.isFinite(qty) || qty <= 0) {
      setError('Enter a positive quantity.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await api<PlaceOrderResponse>('/simulator/orders', {
        method: 'POST',
        token: accessToken,
        // Fresh key per click; double-clicks must not double-spend (ADR 0003/4).
        idempotencyKey: crypto.randomUUID(),
        body: { instrumentId: selected.id, side, quantity: qty },
      });
      setResult(res);
      const portfolio = await api<PortfolioView>('/simulator/portfolio', { token: accessToken });
      setCash(portfolio.cash);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Order failed.');
    } finally {
      setSubmitting(false);
    }
  }

  if (error && !instruments) return <p className="text-red-400 py-10">{error}</p>;
  if (!instruments) return <p className="text-slate-400 py-10">Loading trade ticket…</p>;

  return (
    <div className="py-6">
      <h1 className="text-2xl font-bold">Trade</h1>
      <p className="mt-2 text-sm text-slate-400">
        Virtual cash available: <span className="text-slate-200 font-semibold">₹{cash}</span>
      </p>

      <div className="mt-6 max-w-md space-y-4">
        <div>
          <label htmlFor="instrument" className="block text-sm text-slate-400 mb-1">
            Instrument (fictional)
          </label>
          <select
            id="instrument"
            value={instrumentId}
            onChange={(e) => setInstrumentId(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2"
          >
            {instruments.map((i) => (
              <option key={i.id} value={i.id}>
                {i.symbol} — {i.name} (₹{i.price})
              </option>
            ))}
          </select>
          {selected && <p className="mt-1 text-xs text-slate-500">{selected.description}</p>}
        </div>

        <div>
          <span className="block text-sm text-slate-400 mb-1">Side</span>
          <div className="flex gap-2">
            {(['BUY', 'SELL'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSide(s)}
                className={`flex-1 rounded px-3 py-2 font-medium border ${
                  side === s
                    ? s === 'BUY'
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                      : 'bg-red-500/20 border-red-400 text-red-300'
                    : 'border-slate-700 text-slate-400 hover:border-slate-500'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="quantity" className="block text-sm text-slate-400 mb-1">
            Quantity
          </label>
          <input
            id="quantity"
            type="number"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2"
          />
          {estimate > 0 && (
            <p className="mt-1 text-xs text-slate-500">
              Estimated {side === 'BUY' ? 'cost' : 'proceeds'}: ₹{estimate.toFixed(2)} (simulated
              price)
            </p>
          )}
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={submitting}
          className="w-full bg-amber-400 text-slate-950 px-5 py-2.5 rounded font-medium hover:bg-amber-300 disabled:opacity-50"
        >
          {submitting ? 'Placing order…' : `Place ${side} order (virtual)`}
        </button>

        {result && (
          <div className="rounded border border-emerald-400/40 bg-emerald-400/5 p-4 text-sm">
            <p className="text-emerald-300 font-semibold">
              {result.order.side} {result.order.quantity} {result.order.symbol} @ ₹
              {result.order.price}
            </p>
            <p className="mt-1 text-slate-400">
              Total ₹{result.order.totalValue}
              {result.rewards.applied && (
                <span className="text-amber-300"> · +{result.rewards.xpAwarded} XP</span>
              )}
            </p>
          </div>
        )}
      </div>

      <SimulatorDisclaimer />
    </div>
  );
}
