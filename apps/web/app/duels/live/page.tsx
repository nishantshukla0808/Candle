'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, api, type DuelQuestionView, type DuelResultResponse } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { DuelsDisclaimer } from '../disclaimer';
import { DuelResultView } from '../result-view';

/**
 * Live Speed Quiz Duel (L1, docs/09 Phase 5) — Socket.IO page.
 *
 * Flow: queue → matched (Mira hosts) → 3-2-1 countdown → one question
 * at a time (server timer, 15 s) → reveal after each question →
 * result + rematch. The client timer is display only; the server owns
 * every deadline, grades every answer, and reveals the correct answer.
 *
 * Question UIs are the predeclared ones from doc 08: MCQ_4 is a
 * 1-column list on mobile / 2×2 grid on desktop, tap = answer;
 * TRUE_FALSE is two big buttons, TRUE left (green tint), FALSE right
 * (red tint). Mira speaks before and after the duel, never during a
 * question (doc 08 §2.2).
 */

type Stage = 'idle' | 'queued' | 'countdown' | 'playing' | 'revealed' | 'done';

interface LiveScores {
  playerA: { userId: string; score: number; correct: number };
  playerB: { userId: string; score: number; correct: number } | null;
}

interface RevealPayload {
  duelId: string;
  index: number;
  questionId: string;
  correctOptionId: string | null;
  correctOptionText: string | null;
  explanation: string;
  myCorrect: boolean;
  mySkipped: boolean;
  myPoints: number;
  scores: LiveScores;
}

interface FinishedPayload extends DuelResultResponse {
  host?: { name: string; line: string };
  forfeitedBy?: string | null;
}

const QUESTION_MS = 15_000;

/** GET /duels/live/active — the summary the play page resumes from (Phase 12). */
interface LiveActiveSummary {
  duelId: string;
  variant: string;
  totalQuestions: number;
  opponent: { userId: string; displayName: string; kind: string; rating: number } | null;
}

export default function LiveDuelPage(): JSX.Element {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const socketRef = useRef<Socket | null>(null);
  const duelIdRef = useRef('');
  const [stage, setStage] = useState<Stage>('idle');
  const [opponent, setOpponent] = useState<{ name: string; rating: number; kind: string } | null>(
    null
  );
  const [hostLine, setHostLine] = useState('');
  const [question, setQuestion] = useState<DuelQuestionView | null>(null);
  const [index, setIndex] = useState(0);
  const [total, setTotal] = useState(7);
  const [deadlineMs, setDeadlineMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [countdownEndsAtMs, setCountdownEndsAtMs] = useState(0);
  const [queuedAtMs, setQueuedAtMs] = useState(0);
  const [ratingWindow, setRatingWindow] = useState(50);
  const [botOffer, setBotOffer] = useState(false);
  const [scores, setScores] = useState<LiveScores | null>(null);
  const [selected, setSelected] = useState('');
  const [reveal, setReveal] = useState<RevealPayload | null>(null);
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
        if (cancelled || !active || active.variant !== 'LIVE') return;
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

  // Display clock (1 s in queue/countdown, 100 ms during a question).
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

    socket.on('live:queued', (payload: { ratingWindow: number }) => {
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
        opponent: { displayName: string; rating: number; kind: string };
        host: { name: string; line: string };
        questionCount: number;
        countdownEndsAtMs: number;
      }) => {
        duelIdRef.current = payload.duelId;
        setOpponent({
          name: payload.opponent.displayName,
          rating: payload.opponent.rating,
          kind: payload.opponent.kind,
        });
        setHostLine(payload.host.line);
        setTotal(payload.questionCount);
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
      }) => {
        duelIdRef.current = payload.duelId;
        setIndex(payload.index);
        setTotal(payload.total);
        setQuestion(payload.question);
        setDeadlineMs(payload.deadlineMs);
        setSelected('');
        setReveal(null);
        setStage('playing');
      }
    );
    socket.on('live:score', (payload: { scores: LiveScores }) => setScores(payload.scores));
    socket.on('live:answer-accepted', () => {
      // Correctness arrives only at reveal — nothing to show yet.
    });
    socket.on('live:reveal', (payload: RevealPayload) => {
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
    socket.emit('live:join-queue', {}, (ack: { ok: boolean; message?: string }) => {
      setBusy(false);
      if (!ack.ok) setError(ack.message ?? 'Could not join the queue.');
    });
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

  function answer(optionId: string): void {
    if (!question || selected) return;
    setSelected(optionId);
    socketRef.current?.emit(
      'live:answer',
      { duelId: duelIdRef.current, questionId: question.id, optionId },
      (ack: { ok: boolean; message?: string }) => {
        if (!ack.ok) {
          setError(ack.message ?? 'Could not send the answer.');
          setSelected('');
        }
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
            `Rematch opens in ${secs}s — the same pair needs a 5-minute gap between rated duels.`
          );
        }
      }
    );
  }

  const waitedSec = queuedAtMs ? Math.floor((nowMs - queuedAtMs) / 1000) : 0;
  const countdownSec = countdownEndsAtMs
    ? Math.max(0, Math.ceil((countdownEndsAtMs - nowMs) / 1000))
    : 3;
  const secondsLeft = deadlineMs ? Math.max(0, (deadlineMs - nowMs) / 1000) : QUESTION_MS / 1000;
  const timePct = Math.max(0, Math.min(100, (secondsLeft / (QUESTION_MS / 1000)) * 100));

  const myScore = scores?.playerA.score ?? 0;
  const oppScore = scores?.playerB?.score ?? 0;
  const myName = user?.displayName ?? 'You';
  const oppName = opponent?.name ?? 'Opponent';

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Live Speed Quiz Duel</h1>
      <p className="mt-2 text-sm text-slate-400">
        7 questions, 15 seconds each, same set for both players. Rated — your Learning Rating moves
        with the result. Hosted by Mira.
      </p>
      {hostLine && stage !== 'done' && (
        <p className="mt-3 rounded border border-slate-800 bg-slate-900/50 p-3 text-sm">
          <span className="font-medium text-amber-300">Mira · </span>
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
                No opponent at your Rating yet. Play Mira (bot) instead — rated at your own Rating.
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
          <p className="mt-2 text-sm text-slate-400">Get ready — the first question is coming.</p>
        </div>
      )}

      {(stage === 'playing' || stage === 'revealed') && question && (
        <div className="mt-6">
          <div className="flex justify-between text-sm text-slate-400">
            <span>
              Question {index + 1} of {total} · {oppName} vs {myName}
            </span>
            <span>{secondsLeft.toFixed(1)}s left</span>
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-800">
            <div
              className="h-full bg-amber-400 transition-[width] duration-100"
              style={{ width: `${timePct}%` }}
            />
          </div>
          <div className="mt-3 flex justify-between rounded border border-slate-800 bg-slate-900/50 px-3 py-2 text-sm">
            <span>
              {myName}: <strong>{myScore}</strong> pts
            </span>
            <span>
              {oppName}: <strong>{oppScore}</strong> pts
            </span>
          </div>

          <div className="mt-4 rounded border border-slate-800 bg-slate-900/50 p-4">
            <p className="font-medium">{question.stem}</p>
            {stage === 'playing' && question.type === 'TRUE_FALSE' ? (
              <div className="mt-4 grid grid-cols-2 gap-3">
                {question.options.map((opt) => {
                  const isTrue = opt.text.toLowerCase() === 'true';
                  return (
                    <button
                      key={opt.id}
                      onClick={() => answer(opt.id)}
                      disabled={Boolean(selected)}
                      className={`rounded px-4 py-6 text-lg font-bold disabled:opacity-60 ${
                        isTrue
                          ? 'border border-emerald-400/50 bg-emerald-400/10 text-emerald-200'
                          : 'border border-rose-400/50 bg-rose-400/10 text-rose-200'
                      } ${selected === opt.id ? 'ring-2 ring-amber-300' : ''}`}
                    >
                      {opt.text}
                    </button>
                  );
                })}
              </div>
            ) : stage === 'playing' ? (
              <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                {question.options.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => answer(opt.id)}
                    disabled={Boolean(selected)}
                    className={`rounded border border-slate-700 bg-slate-800/60 px-4 py-3 text-left text-sm hover:bg-slate-800 disabled:opacity-60 ${
                      selected === opt.id ? 'border-amber-300 ring-1 ring-amber-300' : ''
                    }`}
                  >
                    {opt.text}
                  </button>
                ))}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {question.options.map((opt) => {
                  const isCorrect = reveal?.correctOptionId === opt.id;
                  const isMineWrong = selected === opt.id && !isCorrect;
                  return (
                    <div
                      key={opt.id}
                      className={`rounded border px-4 py-3 text-sm ${
                        isCorrect
                          ? 'border-emerald-400 bg-emerald-400/10 text-emerald-200'
                          : isMineWrong
                            ? 'border-rose-400 bg-rose-400/10 text-rose-200'
                            : 'border-slate-700 bg-slate-800/60 text-slate-300'
                      }`}
                    >
                      {opt.text}
                      {isCorrect ? ' — correct' : ''}
                      {isMineWrong ? ' — your pick' : ''}
                    </div>
                  );
                })}
                {reveal && (
                  <p className="rounded border border-slate-800 bg-slate-900/50 p-3 text-sm text-slate-300">
                    {reveal.mySkipped
                      ? 'No answer — time ran out. '
                      : reveal.myCorrect
                        ? `Correct — +${reveal.myPoints} points. `
                        : 'Wrong — 0 points. '}
                    {reveal.explanation}
                  </p>
                )}
              </div>
            )}
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
              <span className="font-medium text-amber-300">Mira · </span>
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
