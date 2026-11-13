'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { api, ApiClientError, type OrderHistory } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { SimulatorDisclaimer } from '../disclaimer';

/** Order history — the caller's simulated trades, newest first. */
export default function OrdersPage(): JSX.Element {
  const { accessToken, user, loading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<OrderHistory | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const d = await api<OrderHistory>(`/simulator/orders?page=${page}&limit=20`, {
          token: accessToken,
        });
        if (!cancelled) setData(d);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiClientError ? err.message : 'Failed to load orders.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, accessToken, router, page]);

  if (error) return <p className="text-red-400 py-10">{error}</p>;
  if (!data) return <p className="text-slate-400 py-10">Loading orders…</p>;

  return (
    <div className="py-6">
      <h1 className="text-2xl font-bold">Order history</h1>

      {data.items.length === 0 ? (
        <p className="mt-4 text-slate-500">No simulated trades yet.</p>
      ) : (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 uppercase">
                  <th className="py-2 pr-4">Time</th>
                  <th className="py-2 pr-4">Ticker</th>
                  <th className="py-2 pr-4">Side</th>
                  <th className="py-2 pr-4 text-right">Qty</th>
                  <th className="py-2 pr-4 text-right">Price</th>
                  <th className="py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((o) => (
                  <tr key={o.id} className="border-t border-slate-800">
                    <td className="py-2 pr-4 text-slate-400">
                      {new Date(o.executedAt).toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 font-semibold text-amber-200">{o.symbol}</td>
                    <td
                      className={`py-2 pr-4 font-medium ${o.side === 'BUY' ? 'text-emerald-400' : 'text-red-400'}`}
                    >
                      {o.side}
                    </td>
                    <td className="py-2 pr-4 text-right">{o.quantity}</td>
                    <td className="py-2 pr-4 text-right">₹{o.price}</td>
                    <td className="py-2 text-right">₹{o.totalValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center gap-4 text-sm text-slate-400">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              className="underline underline-offset-2 disabled:opacity-40"
            >
              Previous
            </button>
            <span>
              Page {data.meta.page} of {Math.max(1, data.meta.totalPages)}
            </span>
            <button
              type="button"
              disabled={page >= data.meta.totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="underline underline-offset-2 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </>
      )}

      <SimulatorDisclaimer />
    </div>
  );
}
