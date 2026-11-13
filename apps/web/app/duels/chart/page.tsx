'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, api, type DuelQuestionView, type DuelResultResponse } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { DuelsDisclaimer } from '../disclaimer';
import { DuelResultView } from '../result-view';
import { ChartQuestion, type ChartReveal } from '../chart-question';

/**
 * Chart Detective (L4, docs/13 Phase 8) — Socket.IO page.
 *
 * Same live engine, gateway, and matchmaking as the Speed Quiz Duel
 * (docs/09 Phase 5), Myth vs Fact Blitz (docs/10 Phase 6), and Case
 * Duel (docs/12 Phase 7), parameterised by variant: the client joins
 * the CHART queue (`live:join-queue { variant: 'CHART' }`) and the
 * server runs 5 CHART_CHOICE charts at 30 seconds each, scored by the
 * standard rule (docs/13 §6): 100 base + up to 50 speed bonus on the
 * 30 s timer. A wrong chart read is a wrong answer — no partial
 * credit, because the chart is the question (doc 08 §3.4). Kabir
 * hosts before and after the duel, never during a chart (doc 08 §2.2).
 * In a Chart bot duel the opponent is Mira; Kabir still hosts.
 *
 * The question UI is the CHART_CHOICE renderer from Stage 1 (docs/08
 * §3.4): the SVG line chart at top, the question in one line, 4
 * interpretation cards, the 30-second timer bar, and the reveal (the
 * chart annotated with the trend line / risk zone, correct reading
 * green, wrong pick red, explanation below). The annotation is
 * reveal-only data: the server sends it with `live:reveal`, never
 * before — the question payload carries the chart without it.
 *
 * The live score bar shows scores only — the opponent's readings are
 * never revealed before the result. The result screen is the shared
 * `DuelResultView`, extended with the annotated chart per question
 * (docs/13 §8).
 */

type Stage = 'idle' | 'queued' | 'countdown' | 'playing' | 'revealed' | 'done';

interface LiveScores {
  playerA: { userId: string; score: number; correct: number };
  playerB: { userId: string; score: number; correct: number } | null;
}

interface ChartRevealPayload extends ChartReveal {
  duelId: string;
  index: number;
  questionId: string;
  myCorrect: boolean;
  mySkipped: boolean;
  scores: LiveScores;
}

interface FinishedPayload extends DuelResultResponse {
  host?: { name: string; line: string };
  forfeitedBy?: string | null;
}

const CHART_QUESTION_MS = 30_000;
const CHART_QUESTION_COUNT = 5;
const CHART_INTRO =
  '5 charts, 30 seconds each. Same charts for both of you. Read the chart, then pick the best interpretation. Good luck.';

/** GET /duels/live/active — the summary the play page resumes from (Phase 12). */
interface LiveActiveSummary {
  duelId: string;
  variant: string;
  totalQuestions: number;
  opponent: { userId: string; displayName: string; kind: string; rating: number } | null;
}

export default function ChartDuelPage(): JSX.Element {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const duelIdRef = useRef('');
  const questionIdRef = useRef('');
  const [stage, setStage] = useState<Stage>('idle');
  const [opponent, setOpponent] = useState<{ name: string; rating: number; kind: string } | null>(
    null
  );
  const [hostLine, setHostLine] = useState('');
  const [question, setQuestion] = useState<DuelQuestionView | null>(null);
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(CHART_QUESTION_COUNT);
  const [timeLimitMs, setTimeLimitMs] = useState(CHART_QUESTION_MS);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [countdownEndsAtMs, setCountdownEndsAtMs] = useState(0);
  const [queuedAtMs, setQueuedAtMs] = useState(0);
  const [ratingWindow, setRatingWindow] = useState(50);
  const [botOffer, setBotOffer] = useState(false);
  const [scores, setScores] = useState<LiveScores | null>(null);
  const [reveal, setReveal] = useState<ChartRevealPayload | null>(null);
  const [result, setResult] = useState<FinishedPayload | null>(null);
  const [opponentGone, setOpponentGone] = useState(false);
  const [rematchState, setRematchState] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) router.push('/login');
  }, [loading, user, router]);

  // Resume a Friend Challenge duel (Phase 12): if I already have an
  // active duel of this variant, connect at once — the gateway rejoins
  // the room and resends the countdown / current question, so the duel
  // starts without joining the queue again.
  useEffect(() => {
    if (loading || !user || !accessToken) return;
    let cancelled = false;
    void (async () => {
      try {
        const active = await api<LiveActiveSummary | null>('/duels/live/active', {
          token: accessToken,
        });
        if (cancelled || !active || active.variant !== 'CHART') return;
        duelIdRef.current = active.duelId;
        setTotal(active.totalQuestions);
        if (active.opponent) {
          setOpponent({
            name: active.opponent.displayName,
            rating: active.opponent.rating,
            kind: active.opponent.kind,
          });
        }
        connect();
      } catch {
        // No active duel — the idle screen stands.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, accessToken]);

  // Display clock (0.5 s in queue/countdown, 100 ms during a question).
  useEffect(() => {
    if (stage !== 'playing' && stage !== 'countdown' && stage !== 'queued') return;
    const step = stage === 'playing' ? 100 : 500;
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
    const socket = io(`${API_URL}/duels-live`, {
      auth: { token: accessToken },
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('live:queued', (payload: { ratingWindow: number; variant?: string }) => {
      if (payload.variant && payload.variant !== 'CHART') {
        setError('You were placed in the wrong queue. Please leave and try again.');
        return;
      }
      setRatingWindow(payload.ratingWindow ?? 50);
      setQueuedAtMs(Date.now());
      setStage('queued');
    });
    socket.on('live:queue-left', () => setStage('idle'));
    socket.on('live:bot-offer', () => setBotOffer(true));
    socket.on(
      'live:matched',
      (payload: {
        duelId: string;
        variant?: string;
        opponent: { displayName: string; rating: number; kind: string };
        host: { name: string; line: string };
        questionCount: number;
        timeLimitMs?: number;
        countdownEndsAtMs: number;
      }) => {
        if (payload.variant && payload.variant !== 'CHART') {
          setError('This is not a Chart Detective duel. Please leave and try again.');
          return;
        }
        duelIdRef.current = payload.duelId;
        setOpponent({
          name: payload.opponent.displayName,
          rating: payload.opponent.rating,
          kind: payload.opponent.kind,
        });
        setHostLine(payload.host.line || CHART_INTRO);
        setTotal(payload.questionCount || CHART_QUESTION_COUNT);
        setTimeLimitMs(payload.timeLimitMs ?? CHART_QUESTION_MS);
        setCountdownEndsAtMs(payload.countdownEndsAtMs);
        setBotOffer(false);
        setResult(null);
        setReveal(null);
        setScores(null);
        setStage('countdown');
      }
    );
    socket.on('live:countdown', (payload: { countdownEndsAtMs: number }) => {
      setCountdownEndsAtMs(payload.countdownEndsAtMs);
      setStage('countdown');
    });
    socket.on(
      'live:question',
      (payload: {
        duelId: string;
        index: number;
        total: number;
        question: DuelQuestionView;
        deadlineMs: number;
        timeLimitMs?: number;
      }) => {
        duelIdRef.current = payload.duelId;
        questionIdRef.current = payload.question.id;
        setIndex(payload.index);
        setTotal(payload.total);
        setQuestion(payload.question);
        setTimeLimitMs(payload.timeLimitMs ?? CHART_QUESTION_MS);
        setReveal(null);
        setStage('playing');
      }
    );
    socket.on('live:score', (payload: { scores: LiveScores }) => setScores(payload.scores));
    socket.on('live:answer-accepted', () => {
      // Correctness arrives only at reveal — nothing to show yet.
    });
    socket.on('live:reveal', (payload: ChartRevealPayload) => {
      setReveal(payload);
      setScores(payload.scores);
      setStage('revealed');
    });
    socket.on('live:opponent-disconnected', () => setOpponentGone(true));
    socket.on('live:opponent-reconnected', () => setOpponentGone(false));
    socket.on('live:rematch-requested', () =>
      setRematchState('Your opponent wants a rematch. Tap Rematch to accept.')
    );
    socket.on('live:finished', (payload: FinishedPayload) => {
      setResult(payload);
      setHostLine(payload.host?.line ?? '');
      setStage('done');
      setOpponentGone(false);
    });
    socket.on('live:error', (payload: { message?: string }) => {
      setError(payload.message ?? 'Something went wrong.');
    });
    socket.on('connect_error', () => {
      setError('Could not connect to the live duel server. Check your connection and try again.');
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
      setError('You need to be signed in to play a live duel.');
      setBusy(false);
      return;
    }
    // CHART queue only — the server defaults an omitted variant to
    // LIVE, so the variant is always sent explicitly here.
    socket.emit(
      'live:join-queue',
      { variant: 'CHART' },
      (ack: { ok: boolean; message?: string }) => {
        setBusy(false);
        if (!ack.ok) setError(ack.message ?? 'Could not join the queue.');
      }
    );
  }

  function leaveQueue(): void {
    socketRef.current?.emit('live:leave-queue', {}, () => undefined);
    setStage('idle');
    setBotOffer(false);
  }

  function acceptBot(): void {
    setBusy(true);
    socketRef.current?.emit('live:accept-bot', {}, (ack: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!ack.ok) setError(ack.message ?? 'The bot offer is not available yet.');
    });
  }

  /** The interpretation is the answer: send it the moment it is picked. */
  function onAnswer(optionId: string): void {
    socketRef.current?.emit(
      'live:answer',
      { duelId: duelIdRef.current, questionId: questionIdRef.current, optionId },
      (ack: { ok: boolean; message?: string }) => {
        if (!ack.ok) setError(ack.message ?? 'Could not send the interpretation.');
      }
    );
  }

  function leaveDuel(): void {
    socketRef.current?.emit('live:leave-duel', { duelId: duelIdRef.current }, () => undefined);
  }

  function rematch(): void {
    setRematchState('Rematch requested — waiting for your opponent…');
    socketRef.current?.emit(
      'live:rematch',
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
            `Rematch opens in ${secs}s — the same pair needs a 5-minute gap between rated Chart duels.`
          );
        }
      }
    );
  }

  const waitedSec = queuedAtMs ? Math.floor((nowMs - queuedAtMs) / 1000) : 0;
  const countdownSec = countdownEndsAtMs
    ? Math.max(0, Math.ceil((countdownEndsAtMs - nowMs) / 1000))
    : 3;

  const myScore = scores?.playerA.score ?? 0;
  const oppScore = scores?.playerB?.score ?? 0;
  const myName = user?.displayName ?? 'You';
  const oppName = opponent?.name ?? 'Opponent';

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Chart Detective</h1>
      <p className="mt-2 text-sm text-slate-400">
        5 fictional charts, 30 seconds each, same charts for both players. Read the chart, then pick
        the best interpretation — a correct reading pays 100 points, and a fast answer adds up to 50
        more. A wrong reading pays nothing. Rated — your Learning Rating moves with the result.
        Hosted by Kabir.
      </p>
      {hostLine && stage !== 'done' && (
        <p className="mt-3 rounded border border-slate-800 bg-slate-900/50 p-3 text-sm">
          <span className="font-medium text-amber-300">Kabir · </span>
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
        <button
          onClick={() => void joinQueue()}
          disabled={busy || loading}
          className="mt-6 w-full rounded bg-amber-400 px-5 py-2.5 font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-50"
        >
          {busy ? 'Joining…' : 'Find an opponent'}
        </button>
      )}

      {stage === 'queued' && (
        <div className="mt-6 rounded border border-slate-800 bg-slate-900/50 p-4">
          <p className="font-medium">Finding you an opponent…</p>
          <p className="mt-1 text-sm text-slate-400">
            Waiting {waitedSec}s · matching within ±{ratingWindow} Rating · your Learning Rating
            decides the window.
          </p>
          {botOffer && (
            <div className="mt-4 rounded border border-amber-400/40 bg-amber-400/5 p-3">
              <p className="text-sm">
                No opponent at your Rating yet. Play Mira (bot) instead — rated at your own Rating,
                on the same 30-second timer with the same scoring.
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
            You vs {oppName} (rated {opponent?.rating ?? '—'})
          </p>
          <p className="mt-4 text-6xl font-bold text-amber-300">{countdownSec}</p>
          <p className="mt-2 text-sm text-slate-400">Get ready — the first chart is coming.</p>
        </div>
      )}

      {(stage === 'playing' || stage === 'revealed') && question && (
        <div className="mt-6">
          <div className="flex justify-between text-sm text-slate-400">
            <span>
              Chart {index + 1} of {total} · {oppName} vs {myName}
            </span>
          </div>
          <div className="mt-2 flex justify-between rounded border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm">
            <span>
              {myName}: <strong>{myScore}</strong> pts
            </span>
            <span>
              {oppName}: <strong>{oppScore}</strong> pts
            </span>
          </div>

          <div className="mt-4">
            <ChartQuestion
              question={question}
              timeLimitMs={timeLimitMs}
              reveal={
                reveal
                  ? {
                      correctOptionId: reveal.correctOptionId,
                      correctOptionText: reveal.correctOptionText,
                      explanation: reveal.explanation,
                      annotation: reveal.annotation,
                      myOptionId: reveal.myOptionId,
                    }
                  : null
              }
              onAnswer={onAnswer}
            />
          </div>
          {stage === 'playing' && (
            <button onClick={leaveDuel} className="mt-4 text-sm text-slate-400 underline">
              Leave duel (counts as a loss)
            </button>
          )}
        </div>
      )}

      {stage === 'done' && result && (
        <div className="mt-6 space-y-4">
          {result.host && (
            <p className="rounded border border-slate-800 bg-slate-900/50 p-3 text-sm">
              <span className="font-medium text-amber-300">Kabir · </span>
              {result.host.line}
            </p>
          )}
          {result.forfeitedBy && (
            <p className="rounded border border-amber-400/40 bg-amber-400/5 p-3 text-sm text-amber-200">
              This duel ended by forfeit (a player left or lost connection for over 15 seconds).
            </p>
          )}
          <DuelResultView result={result} />
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
