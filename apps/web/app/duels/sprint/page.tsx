'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  API_URL,
  api,
  newIdempotencyKey,
  type SprintActiveSummary,
  type SprintHistoryItem,
  type SprintInstrumentView,
  type SprintMatchedPayload,
  type SprintPortfolioView,
  type SprintResultResponse,
  type SprintStartedPayload,
  type SprintTickPayload,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { DuelsDisclaimer } from '../disclaimer';
import { SprintResultView } from './sprint-result';

/**
 * Paper Trading Sprint (T1, docs/14 Phase 9) — Socket.IO page.
 *
 * Flow: queue (own Trading Rating queue) → matched (Tara hosts) → 3-2-1
 * countdown → 15 minutes of trading on one fictional market (same
 * prices for both players, virtual ₹100,000 each) → settlement on
 * risk-adjusted return, not highest return. The client timer is display
 * only; the server owns the clock, prices every order, and settles.
 *
 * Tara speaks before and after the sprint, never during it, and never
 * gives trading advice (doc 08 §2.2). Live values show both players'
 * TOTAL equity only — never the opponent's holdings or orders.
 */

type Stage = 'idle' | 'queued' | 'countdown' | 'trading' | 'done';

const START_CASH = 100000;
const SPRINT_MS = 15 * 60 * 1000;

function fmtClock(ms: number): string {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

export default function SprintPage(): JSX.Element {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const duelIdRef = useRef('');
  const [stage, setStage] = useState<Stage>('idle');
  const [opponent, setOpponent] = useState<{ name: string; rating: number; kind: string } | null>(
    null
  );
  const [hostLine, setHostLine] = useState('');
  const [instruments, setInstruments] = useState<SprintInstrumentView[]>([]);
  const [portfolio, setPortfolio] = useState<SprintPortfolioView | null>(null);
  const [myEquity, setMyEquity] = useState<string | null>(null);
  const [oppEquity, setOppEquity] = useState<string | null>(null);
  const [endsAtMs, setEndsAtMs] = useState(0);
  const [countdownEndsAtMs, setCountdownEndsAtMs] = useState(0);
  const [queuedAtMs, setQueuedAtMs] = useState(0);
  const [ratingWindow, setRatingWindow] = useState(50);
  const [botOffer, setBotOffer] = useState(false);
  const [result, setResult] = useState<SprintResultResponse | null>(null);
  const [history, setHistory] = useState<SprintHistoryItem[]>([]);
  const [opponentGone, setOpponentGone] = useState(false);
  const [rematchState, setRematchState] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  // Order form.
  const [orderInstrumentId, setOrderInstrumentId] = useState('');
  const [orderSide, setOrderSide] = useState<'BUY' | 'SELL'>('BUY');
  const [orderQty, setOrderQty] = useState('10');
  const [orderNote, setOrderNote] = useState('');

  useEffect(() => {
    if (loading) return;
    if (!user) router.push('/login');
  }, [loading, user, router]);

  // Resume an active sprint + load history on the idle screen.
  useEffect(() => {
    if (loading || !user || !accessToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const [active, hist] = await Promise.all([
          api<SprintActiveSummary | null>('/sprint/active', { token: accessToken }),
          api<{ items: SprintHistoryItem[] }>('/sprint/history', { token: accessToken }),
        ]);
        if (cancelled) return;
        setHistory(hist.items ?? []);
        if (active) {
          duelIdRef.current = active.duelId;
          setMyEquity(active.myEquity);
          setOppEquity(active.opponentEquity);
          setEndsAtMs(active.endsAtMs ?? 0);
          setOpponent(
            active.opponent
              ? { name: active.opponent.displayName, rating: 0, kind: active.opponent.kind }
              : null
          );
          setStage(active.phase === 'COUNTDOWN' ? 'countdown' : 'trading');
          const state = await api<{
            instruments: SprintInstrumentView[];
            myPortfolio: SprintPortfolioView;
          }>(`/sprint/${active.duelId}/state`, { token: accessToken });
          if (!cancelled) {
            setInstruments(state.instruments);
            setPortfolio(state.myPortfolio);
            if (state.instruments.length > 0) setOrderInstrumentId(state.instruments[0]?.id ?? '');
          }
          connect();
        }
      } catch {
        // No active sprint (or history unavailable) — the idle screen stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, accessToken]);

  // Display clock (1 s in queue/countdown, 500 ms while trading).
  useEffect(() => {
    if (stage !== 'trading' && stage !== 'countdown' && stage !== 'queued') return;
    const step = stage === 'trading' ? 500 : 1000;
    const timer = window.setInterval(() => setNowMs(Date.now()), step);
    return () => window.clearInterval(timer);
  }, [stage]);

  const disconnectSocket = useCallback(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, []);

  useEffect(() => disconnectSocket, [disconnectSocket]);

  function connect(): Socket | null {
    if (!accessToken) return null;
    if (socketRef.current) return socketRef.current;
    const socket = io(`${API_URL}/sprint`, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('sprint:queued', (payload: { ratingWindow: number }) => {
      setRatingWindow(payload.ratingWindow ?? 50);
      setQueuedAtMs(Date.now());
      setStage('queued');
    });
    socket.on('sprint:queue-left', () => setStage('idle'));
    socket.on('sprint:bot-offer', () => setBotOffer(true));
    socket.on('sprint:matched', (payload: SprintMatchedPayload) => {
      duelIdRef.current = payload.duelId;
      setOpponent({
        name: payload.opponent.displayName,
        rating: payload.opponent.rating,
        kind: payload.opponent.kind,
      });
      setHostLine(payload.host.line);
      setCountdownEndsAtMs(payload.countdownEndsAtMs);
      setBotOffer(false);
      setResult(null);
      setPortfolio(null);
      setMyEquity(null);
      setOppEquity(null);
      setStage('countdown');
    });
    socket.on('sprint:countdown', (payload: { countdownEndsAtMs: number }) => {
      setCountdownEndsAtMs(payload.countdownEndsAtMs);
      setStage('countdown');
    });
    socket.on('sprint:started', (payload: SprintStartedPayload) => {
      duelIdRef.current = payload.duelId;
      setInstruments(payload.instruments);
      setPortfolio(payload.portfolio);
      setMyEquity(payload.portfolio.totalEquity);
      setEndsAtMs(payload.endsAtMs ?? 0);
      if (payload.instruments.length > 0) setOrderInstrumentId(payload.instruments[0]?.id ?? '');
      setStage('trading');
    });
    socket.on('sprint:tick', (payload: SprintTickPayload) => {
      setInstruments(
        payload.prices.map((p) => ({
          id: p.instrumentId,
          symbol: p.symbol,
          name: '',
          price: p.price,
        }))
      );
      const me = user?.id ? payload.equities[user.id] : undefined;
      if (me) setMyEquity(me.equity);
      const others = Object.values(payload.equities).filter((e) => e.userId !== user?.id);
      if (others[0]) setOppEquity(others[0].equity);
      if (payload.endsAtMs) setEndsAtMs(payload.endsAtMs);
    });
    socket.on(
      'sprint:order-accepted',
      (payload: { order: { instrumentId: string }; portfolio: SprintPortfolioView }) => {
        setPortfolio(payload.portfolio);
        setMyEquity(payload.portfolio.totalEquity);
      }
    );
    socket.on('sprint:opponent-disconnected', () => setOpponentGone(true));
    socket.on('sprint:opponent-reconnected', () => setOpponentGone(false));
    socket.on('sprint:rematch-requested', () =>
      setRematchState('Your opponent wants a rematch. Tap Rematch to accept.')
    );
    socket.on('sprint:finished', (payload: SprintResultResponse) => {
      setResult(payload);
      setHostLine(payload.host?.line ?? '');
      setStage('done');
      setOpponentGone(false);
      setEndsAtMs(0);
      void api<{ items: SprintHistoryItem[] }>('/sprint/history', { token: accessToken })
        .then((h) => setHistory(h.items ?? []))
        .catch(() => undefined);
    });
    socket.on('sprint:error', (payload: { message?: string }) => {
      setError(payload.message ?? 'Something went wrong.');
    });
    socket.on('connect_error', () => {
      setError('Could not connect to the sprint server. Check your connection and try again.');
      setBusy(false);
    });
    return socket;
  }

  async function joinQueue(): Promise<void> {
    setError('');
    setBotOffer(false);
    setRematchState('');
    setBusy(true);
    const socket = connect();
    if (!socket) {
      setError('You need to be signed in to play a sprint.');
      setBusy(false);
      return;
    }
    socket.emit('sprint:join-queue', {}, (ack: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!ack.ok) setError(ack.message ?? 'Could not join the queue.');
    });
  }

  function leaveQueue(): void {
    socketRef.current?.emit('sprint:leave-queue', {}, () => undefined);
    setStage('idle');
    setBotOffer(false);
  }

  function acceptBot(): void {
    setBusy(true);
    socketRef.current?.emit('sprint:accept-bot', {}, (ack: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!ack.ok) setError(ack.message ?? 'The bot offer is not available yet.');
    });
  }

  function placeOrder(): void {
    setError('');
    setOrderNote('');
    const qty = Number(orderQty);
    if (!orderInstrumentId || !Number.isInteger(qty) || qty < 1) {
      setError('Pick an instrument and a whole number of units (at least 1).');
      return;
    }
    setBusy(true);
    socketRef.current?.emit(
      'sprint:order',
      {
        duelId: duelIdRef.current,
        instrumentId: orderInstrumentId,
        side: orderSide,
        quantity: qty,
        clientOrderId: newIdempotencyKey(),
      },
      (ack: { ok: boolean; message?: string; order?: { symbol: string; quantity: string } }) => {
        setBusy(false);
        if (!ack.ok) {
          setError(ack.message ?? 'Could not place the order.');
          return;
        }
        setOrderNote(
          `${orderSide} ${ack.order?.quantity ?? qty} ${ack.order?.symbol ?? ''} — order accepted.`
        );
      }
    );
  }

  function leaveSprint(): void {
    socketRef.current?.emit('sprint:leave-sprint', { duelId: duelIdRef.current }, () => undefined);
  }

  function rematch(): void {
    setRematchState('Rematch requested — waiting for your opponent…');
    socketRef.current?.emit(
      'sprint:rematch',
      { duelId: duelIdRef.current },
      (ack: {
        ok: boolean;
        matched?: boolean;
        reason?: string;
        retryAfterMs?: number;
        message?: string;
      }) => {
        if (!ack.ok) {
          setRematchState('');
          setError(ack.message ?? 'Could not request a rematch.');
          return;
        }
        if (!ack.matched && ack.reason === 'REMATCH_COOLDOWN') {
          const secs = Math.ceil((ack.retryAfterMs ?? 0) / 1000);
          setRematchState(
            `Rematch opens in ${secs}s — the same pair needs a 5-minute gap between rated sprints.`
          );
        }
      }
    );
  }

  const waitedSec = queuedAtMs ? Math.floor((nowMs - queuedAtMs) / 1000) : 0;
  const countdownSec = countdownEndsAtMs
    ? Math.max(0, Math.ceil((countdownEndsAtMs - nowMs) / 1000))
    : 3;
  const msLeft = endsAtMs ? endsAtMs - nowMs : SPRINT_MS;
  const timePct = Math.max(0, Math.min(100, (msLeft / SPRINT_MS) * 100));
  const myReturnPct =
    myEquity !== null ? ((Number(myEquity) - START_CASH) / START_CASH) * 100 : null;
  const myName = user?.displayName ?? 'You';
  const oppName = opponent?.name ?? 'Opponent';
  const selectedInstrument = instruments.find((i) => i.id === orderInstrumentId);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Paper Trading Sprint</h1>
      <p className="mt-2 text-sm text-slate-400">
        15 minutes, same fictional market for both players, virtual ₹100,000 each. The winner is the
        best risk-adjusted return — a steady gain beats a wild one, and a risky loss scores worse
        than a calm one. Rated — your Trading Rating moves with the result. Hosted by Tara.
      </p>
      {hostLine && stage !== 'done' && (
        <p className="mt-3 rounded border border-slate-800 bg-slate-900/50 p-3 text-sm">
          <span className="font-medium text-amber-300">Tara · </span>
          {hostLine}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded border border-rose-400/40 bg-rose-400/5 p-3 text-sm text-rose-200">
          {error}
        </p>
      )}
      {opponentGone && stage !== 'done' && (
        <p className="mt-4 rounded border border-amber-400/40 bg-amber-400/5 p-3 text-sm text-amber-200">
          Your opponent lost connection — they have 15 seconds to reconnect, or you win by forfeit.
        </p>
      )}

      {stage === 'idle' && (
        <div className="mt-6">
          <button
            onClick={() => void joinQueue()}
            disabled={busy || loading}
            className="w-full rounded bg-amber-400 px-5 py-2.5 font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-50"
          >
            {busy ? 'Joining…' : 'Find an opponent'}
          </button>
          {history.length > 0 && (
            <div className="mt-6">
              <h2 className="font-medium">Your recent sprints</h2>
              <ul className="mt-2 space-y-2 text-sm">
                {history.slice(0, 5).map((h) => (
                  <li
                    key={h.duelId}
                    className="flex justify-between rounded border border-slate-800 bg-slate-900/50 px-3 py-2"
                  >
                    <span>
                      {h.result === 'WIN' ? 'Won' : h.result === 'DRAW' ? 'Drew' : 'Lost'} vs{' '}
                      {h.opponentName ?? 'Mira'} · score {h.riskAdjustedScore}
                    </span>
                    <span className="text-slate-400">
                      {h.ratingDelta === null
                        ? 'no Rating change'
                        : `${h.ratingDelta >= 0 ? '+' : ''}${h.ratingDelta} Trading Rating`}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {stage === 'queued' && (
        <div className="mt-6 rounded border border-slate-800 bg-slate-900/50 p-4">
          <p className="font-medium">Finding you an opponent…</p>
          <p className="mt-1 text-sm text-slate-400">
            Waiting {waitedSec}s · matching within ±{ratingWindow} Trading Rating · your Trading
            Rating decides the window.
          </p>
          {botOffer && (
            <div className="mt-4 rounded border border-amber-400/40 bg-amber-400/5 p-3">
              <p className="text-sm">
                No opponent at your Trading Rating yet. Play Mira (bot) instead — rated at your own
                Trading Rating.
              </p>
              <button
                onClick={acceptBot}
                disabled={busy}
                className="mt-2 rounded bg-amber-400 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-50"
              >
                Play Mira instead
              </button>
            </div>
          )}
          <button
            onClick={leaveQueue}
            className="mt-4 rounded border border-slate-700 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
          >
            Leave queue
          </button>
        </div>
      )}

      {stage === 'countdown' && (
        <div className="mt-6 rounded border border-slate-800 bg-slate-900/50 p-6 text-center">
          <p className="text-sm text-slate-400">
            You vs {oppName}
            {opponent ? ` (Trading Rating ${opponent.rating})` : ''}
          </p>
          <p className="mt-4 text-6xl font-bold text-amber-300">{countdownSec}</p>
          <p className="mt-2 text-sm text-slate-400">
            Get ready — the market opens for 15 minutes.
          </p>
        </div>
      )}

      {stage === 'trading' && (
        <div className="mt-6 space-y-4">
          <div className="flex justify-between text-sm text-slate-400">
            <span>
              {myName} vs {oppName}
            </span>
            <span>{fmtClock(msLeft)} left</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-slate-800">
            <div
              className="h-full bg-amber-400 transition-[width] duration-500"
              style={{ width: `${timePct}%` }}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
              <p className="text-xs uppercase text-slate-500">Your equity</p>
              <p className="text-3xl font-bold text-amber-300">
                ₹{myEquity ?? portfolio?.totalEquity ?? '100000.00'}
              </p>
              <p className="mt-1 text-sm text-slate-400">
                Return{' '}
                {myReturnPct === null
                  ? '—'
                  : `${myReturnPct >= 0 ? '+' : ''}${myReturnPct.toFixed(2)}%`}
                {myReturnPct !== null && myReturnPct < 0
                  ? ' — a risky loss scores worse than a calm one'
                  : ''}
              </p>
            </div>
            <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
              <p className="text-xs uppercase text-slate-500">{oppName}&rsquo;s equity</p>
              <p className="text-3xl font-bold text-slate-100">₹{oppEquity ?? '100000.00'}</p>
              <p className="mt-1 text-sm text-slate-400">
                Total equity only — their holdings and orders stay hidden.
              </p>
            </div>
          </div>

          <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-xs uppercase text-slate-500">Virtual cash</p>
            <p className="text-2xl font-bold text-slate-100">₹{portfolio?.cash ?? '100000.00'}</p>
          </div>

          <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
            <h2 className="font-medium">Place an order</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <label className="block text-sm">
                <span className="text-slate-400">Instrument</span>
                <select
                  value={orderInstrumentId}
                  onChange={(e) => setOrderInstrumentId(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100"
                >
                  {instruments.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.symbol} — ₹{i.price}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-400">Side</span>
                <select
                  value={orderSide}
                  onChange={(e) => setOrderSide(e.target.value as 'BUY' | 'SELL')}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100"
                >
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </label>
              <label className="block text-sm">
                <span className="text-slate-400">Units</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={orderQty}
                  onChange={(e) => setOrderQty(e.target.value)}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100"
                />
              </label>
            </div>
            <button
              onClick={placeOrder}
              disabled={busy || !orderInstrumentId}
              className="mt-3 w-full rounded bg-amber-400 px-5 py-2.5 font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-50"
            >
              {busy
                ? 'Placing…'
                : `${orderSide} ${orderQty || '—'} ${selectedInstrument?.symbol ?? ''}`}
            </button>
            {orderNote && <p className="mt-2 text-sm text-emerald-300">{orderNote}</p>}
            <p className="mt-2 text-xs text-slate-500">
              Whole units only, 1–100,000 per order, at most 120 orders per sprint. No leverage, no
              shorting — and no XP per trade; XP comes only from the result.
            </p>
          </div>

          <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
            <h2 className="font-medium">Holdings</h2>
            {!portfolio || portfolio.holdings.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">
                No positions yet — place your first simulated trade above.
              </p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-slate-500">
                      <th className="py-2 pr-4">Ticker</th>
                      <th className="py-2 pr-4 text-right">Qty</th>
                      <th className="py-2 pr-4 text-right">Avg cost</th>
                      <th className="py-2 pr-4 text-right">Price</th>
                      <th className="py-2 pr-4 text-right">Value</th>
                      <th className="py-2 text-right">P&amp;L</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.holdings.map((h) => {
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
          </div>

          <button onClick={leaveSprint} className="text-sm text-slate-400 underline">
            Leave sprint (counts as a loss)
          </button>
        </div>
      )}

      {stage === 'done' && result && (
        <div className="mt-6 space-y-4">
          {result.host && (
            <p className="rounded border border-slate-800 bg-slate-900/50 p-3 text-sm">
              <span className="font-medium text-amber-300">Tara · </span>
              {result.host.line}
            </p>
          )}
          {result.forfeitedBy && (
            <p className="rounded border border-amber-400/40 bg-amber-400/5 p-3 text-sm text-amber-200">
              This sprint ended by forfeit (a player left or lost connection for over 15 seconds).
            </p>
          )}
          <SprintResultView result={result} />
          {rematchState && <p className="text-sm text-slate-400">{rematchState}</p>}
          <div className="flex gap-3">
            <button
              onClick={rematch}
              className="rounded bg-amber-400 px-5 py-2.5 font-medium text-slate-950 hover:bg-amber-300"
            >
              Rematch
            </button>
            <button
              onClick={() => {
                disconnectSocket();
                setStage('idle');
                setResult(null);
              }}
              className="rounded border border-slate-700 px-5 py-2.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Back to duels
            </button>
          </div>
        </div>
      )}

      <DuelsDisclaimer />
    </main>
  );
}
