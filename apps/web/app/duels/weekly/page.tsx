'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  api,
  newIdempotencyKey,
  type WeeklyHistoryItem,
  type WeeklyPortfolioView,
  type WeeklyResultResponse,
  type WeeklySeasonView,
  type WeeklyStandingsResponse,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { DuelsDisclaimer } from '../disclaimer';

/**
 * Weekly Portfolio Battle (T3, docs/16 Phase 11) — REST page.
 *
 * A week-long ASYNC trading duel: join a season while it is OPEN,
 * trade all week once it is ACTIVE, and read the settled result after
 * the admin settles it. No live socket — standings are computed on
 * demand from stored trades + current prices, and refresh on load and
 * after each trade. Anaya (Portfolio Architect) hosts: she speaks
 * before and after the week, never during it, and never gives trading
 * advice (doc 08 §2.2). Standings show totals and scores only — never
 * another player's holdings or orders.
 */

function fmtCountdown(endsAt: string | null, nowMs: number): string {
  if (!endsAt) return '—';
  const ms = new Date(endsAt).getTime() - nowMs;
  if (ms <= 0) return 'Season ended — awaiting settlement';
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor((ms % 86_400_000) / 3_600_000);
  const mins = Math.floor((ms % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h left`;
  if (hours > 0) return `${hours}h ${mins}m left`;
  return `${mins}m left`;
}

export default function WeeklyPage(): JSX.Element {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const [seasons, setSeasons] = useState<WeeklySeasonView[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [standings, setStandings] = useState<WeeklyStandingsResponse | null>(null);
  const [portfolio, setPortfolio] = useState<WeeklyPortfolioView | null>(null);
  const [result, setResult] = useState<WeeklyResultResponse | null>(null);
  const [history, setHistory] = useState<WeeklyHistoryItem[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Order form.
  const [orderInstrumentId, setOrderInstrumentId] = useState('');
  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderQty, setOrderQty] = useState('10');
  const [orderNote, setOrderNote] = useState('');

  const selected = seasons.find((s) => s.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    if (!accessToken || !selectedId) return;
    try {
      const [st, hist] = await Promise.all([
        api<WeeklyStandingsResponse>(`/weekly/seasons/${selectedId}/standings`, {
          token: accessToken,
        }).catch(() => null),
        api<{ items: WeeklyHistoryItem[] }>('/weekly/history', { token: accessToken }),
      ]);
      setStandings(st);
      setHistory(hist.items ?? []);
      if (st?.status === 'ACTIVE') {
        const pf = await api<WeeklyPortfolioView>(`/weekly/seasons/${selectedId}/portfolio`, {
          token: accessToken,
        }).catch(() => null);
        setPortfolio(pf);
        if (pf && pf.prices.length > 0 && !orderInstrumentId) {
          setOrderInstrumentId(pf.prices[0]?.instrumentId ?? '');
        }
      } else {
        setPortfolio(null);
      }
      if (st?.status === 'SETTLED') {
        const res = await api<WeeklyResultResponse>(`/weekly/seasons/${selectedId}/result`, {
          token: accessToken,
        }).catch(() => null);
        setResult(res);
      } else {
        setResult(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the season.');
    }
  }, [accessToken, selectedId, orderInstrumentId]);

  useEffect(() => {
    if (loading) return;
    if (!user) router.push('/login');
  }, [loading, user, router]);

  // Load the season list once logged in; select the newest season.
  useEffect(() => {
    if (loading || !user || !accessToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await api<WeeklySeasonView[]>('/weekly/seasons', { token: accessToken });
        if (cancelled) return;
        setSeasons(list);
        if (list.length > 0) setSelectedId(list[0]?.id ?? '');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load seasons.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, accessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Display-only countdown clock.
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function join(): Promise<void> {
    if (!accessToken || !selectedId) return;
    setBusy(true);
    setError('');
    try {
      await api(`/weekly/seasons/${selectedId}/join`, { method: 'POST', token: accessToken });
      const list = await api<WeeklySeasonView[]>('/weekly/seasons', { token: accessToken });
      setSeasons(list);
      setOrderNote('Joined — good luck. Trading opens when the season starts on Monday.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join.');
    } finally {
      setBusy(false);
    }
  }

  async function placeOrder(): Promise<void> {
    if (!accessToken || !selectedId || !orderInstrumentId) return;
    setBusy(true);
    setError('');
    setOrderNote('');
    try {
      const trade = await api<{ portfolio: WeeklyPortfolioView }>(
        `/weekly/seasons/${selectedId}/trade`,
        {
          method: 'POST',
          token: accessToken,
          body: {
            instrumentId: orderInstrumentId,
            side: orderSide,
            quantity: Number(orderQty),
            clientOrderId: newIdempotencyKey(),
          },
        }
      );
      setPortfolio(trade.portfolio);
      setOrderNote(
        `Order placed at the server price. Cash ₹${trade.portfolio.cash} — equity ₹${trade.portfolio.totalEquity}.`
      );
      void refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order failed.');
    } finally {
      setBusy(false);
    }
  }

  const myEntry = standings?.leagues
    .flatMap((l) => l.entries.map((e) => ({ ...e, leagueNumber: l.leagueNumber, tier: l.tier })))
    .find((e) => e.userId === user?.id);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Weekly Portfolio Battle</h1>
      <p className="mt-2 text-sm text-slate-400">
        One week, same fictional market, same ₹1,00,000. Trade all week in a league of 30 — the
        winner is the best risk-adjusted return, not the highest return. Top 3 are promoted one
        tier, bottom 3 demoted. Your Trading Rating moves against the market index, not your rivals.
        Hosted by Anaya, Portfolio Architect.
      </p>
      <p className="mt-2 rounded border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm text-slate-300">
        <span className="font-medium text-amber-300">Anaya: </span>
        {selected?.status === 'SETTLED'
          ? 'The week is settled. Your league rank is yours; your Trading Rating moved against the index. Come back Monday for the next season.'
          : 'One week, same fictional market, same ₹1,00,000. Best risk-adjusted return wins your league — and your Trading Rating moves against the market index, not your rivals. Good luck.'}
      </p>

      {error ? (
        <p className="mt-4 rounded border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </p>
      ) : null}

      <label className="mt-6 block text-sm font-medium text-slate-300" htmlFor="weekly-season">
        Season
      </label>
      <select
        id="weekly-season"
        className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
        value={selectedId}
        onChange={(e) => setSelectedId(e.target.value)}
      >
        {seasons.length === 0 ? <option value="">No seasons yet</option> : null}
        {seasons.map((s) => (
          <option key={s.id} value={s.id}>
            Week of {s.weekStart} — {s.status} ({s.memberCount} joined, {s.leagueCount} leagues)
          </option>
        ))}
      </select>

      {selected ? (
        <div className="mt-4 rounded border border-slate-800 bg-slate-900/50 p-4 text-sm">
          <p>
            Status: <span className="font-medium">{selected.status}</span>
            {selected.status === 'ACTIVE' ? ` · ${fmtCountdown(selected.endsAt, nowMs)}` : null}
            {selected.indexReturnPct !== null
              ? ` · Index return: ${selected.indexReturnPct}%`
              : null}
          </p>
          {selected.status === 'OPEN' ? (
            <button
              type="button"
              onClick={() => void join()}
              disabled={busy}
              className="mt-3 rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-50"
            >
              Join this season
            </button>
          ) : null}
          {orderNote ? <p className="mt-3 text-slate-300">{orderNote}</p> : null}
        </div>
      ) : null}

      {myEntry ? (
        <p className="mt-4 rounded border border-slate-800 bg-slate-900/50 px-4 py-3 text-sm">
          You are #{myEntry.rank} in League {myEntry.leagueNumber} (tier {myEntry.tier}) — return{' '}
          {myEntry.returnPct}%, risk-adjusted score {myEntry.riskAdjustedScore}.
          {myEntry.promotionZone ? ' Promotion zone.' : ''}
          {myEntry.relegationZone ? ' Relegation zone.' : ''}
        </p>
      ) : null}

      {selected?.status === 'ACTIVE' && portfolio ? (
        <section className="mt-6">
          <h2 className="text-lg font-medium">My portfolio</h2>
          <p className="mt-1 text-sm text-slate-400">
            Cash ₹{portfolio.cash} · Total equity ₹{portfolio.totalEquity}
          </p>
          {portfolio.holdings.length === 0 ? (
            <p className="mt-2 text-sm text-slate-400">
              No holdings yet — place your first order below.
            </p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="text-left text-slate-400">
                  <th className="py-1">Instrument</th>
                  <th className="py-1">Qty</th>
                  <th className="py-1">Price</th>
                  <th className="py-1">Value</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.holdings.map((h) => (
                  <tr key={h.instrumentId} className="border-t border-slate-800">
                    <td className="py-1">{h.symbol}</td>
                    <td className="py-1">{h.quantity}</td>
                    <td className="py-1">₹{h.currentPrice}</td>
                    <td className="py-1">₹{h.marketValue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="mt-6 font-medium">Place an order</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              aria-label="Instrument"
              className="rounded border border-slate-700 bg-slate-900 px-3 py-2"
              value={orderInstrumentId}
              onChange={(e) => setOrderInstrumentId(e.target.value)}
            >
              {portfolio.prices.map((p) => (
                <option key={p.instrumentId} value={p.instrumentId}>
                  {p.symbol} — ₹{p.price}
                </option>
              ))}
            </select>
            <select
              aria-label="Side"
              className="rounded border border-slate-700 bg-slate-900 px-3 py-2"
              value={orderSide}
              onChange={(e) => setOrderSide(e.target.value as 'BUY' | 'SELL')}
            >
              <option value="BUY">BUY</option>
              <option value="SELL">SELL</option>
            </select>
            <input
              aria-label="Quantity"
              className="w-24 rounded border border-slate-700 bg-slate-900 px-3 py-2"
              value={orderQty}
              onChange={(e) => setOrderQty(e.target.value)}
              inputMode="numeric"
            />
            <button
              type="button"
              onClick={() => void placeOrder()}
              disabled={busy}
              className="rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-50"
            >
              Place order
            </button>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            className="mt-3 text-sm text-slate-400 underline"
          >
            Refresh standings
          </button>
        </section>
      ) : null}

      {standings && standings.leagues.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-lg font-medium">League standings</h2>
          <p className="mt-1 text-sm text-slate-400">
            Totals and scores only — holdings and orders are never shared between players.
          </p>
          {standings.leagues.map((league) => (
            <div key={league.leagueId} className="mt-4">
              <h3 className="font-medium">
                League {league.leagueNumber} (tier {league.tier})
              </h3>
              <table className="mt-2 w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-400">
                    <th className="py-1">#</th>
                    <th className="py-1">Player</th>
                    <th className="py-1">Return</th>
                    <th className="py-1">Score</th>
                    <th className="py-1">Trades</th>
                  </tr>
                </thead>
                <tbody>
                  {league.entries.map((e) => (
                    <tr
                      key={e.userId}
                      className={`border-t border-slate-800 ${e.userId === user?.id ? 'bg-amber-400/10' : ''}`}
                    >
                      <td className="py-1">
                        {e.rank}
                        {e.promotionZone ? ' ↑' : ''}
                        {e.relegationZone ? ' ↓' : ''}
                      </td>
                      <td className="py-1">{e.displayName ?? 'Player'}</td>
                      <td className="py-1">{e.returnPct}%</td>
                      <td className="py-1">{e.riskAdjustedScore}</td>
                      <td className="py-1">{e.tradeCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>
      ) : null}

      {result ? (
        <section className="mt-6 rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="text-lg font-medium">Your result</h2>
          <p className="mt-2 text-sm">
            #{result.rank} of {result.leagueSize} in League {result.leagueNumber} (tier{' '}
            {result.tier}) — next season you enter tier {result.nextTier}. Return {result.returnPct}
            %, risk-adjusted score {result.riskAdjustedScore}, {result.tradeCount} trades, +
            {result.xp.awarded} XP.
          </p>
          <p className="mt-2 text-sm text-slate-300">{result.ratingReason}</p>
        </section>
      ) : null}

      {history.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-lg font-medium">My weekly history</h2>
          <ul className="mt-2 space-y-2 text-sm">
            {history.slice(0, 5).map((h) => (
              <li
                key={h.seasonId}
                className="rounded border border-slate-800 bg-slate-900/50 px-4 py-3"
              >
                Week of {h.weekStart} — #{h.rank} of {h.leagueSize}, return {h.returnPct}%, score{' '}
                {h.riskAdjustedScore}
                {h.ratingDelta !== null
                  ? `, Trading Rating ${h.ratingDelta > 0 ? '+' : ''}${h.ratingDelta}`
                  : ', unrated week'}
                {`, +${h.xpAwarded} XP`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DuelsDisclaimer />
    </main>
  );
}
