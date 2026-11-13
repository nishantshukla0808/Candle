'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import {
  api,
  ApiClientError,
  type DuelQuestionView,
  type DuelResultResponse,
  type DuelStartResponse,
  type DuelWaitingResponse,
} from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { DuelsDisclaimer } from './disclaimer';
import { DuelResultView } from './result-view';

const SECONDS_PER_QUESTION = 15;

type Stage = 'idle' | 'playing' | 'waiting' | 'done';

/**
 * Shared duel player for the Bot Duel and the Daily Duel (docs/07).
 * One question at a time, 15-second display timer; unanswered
 * questions become skips at finish. Answers are sent one by one and
 * correctness is only revealed in the stored result.
 */
export function DuelPlay({
  kind,
  title,
  blurb,
}: {
  kind: 'bot' | 'daily';
  title: string;
  blurb: string;
}): JSX.Element {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const [stage, setStage] = useState<Stage>('idle');
  const [questions, setQuestions] = useState<DuelQuestionView[]>([]);
  const [duelId, setDuelId] = useState('');
  const [index, setIndex] = useState(0);
  const [selected, setSelected] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(SECONDS_PER_QUESTION);
  const [result, setResult] = useState<DuelResultResponse | null>(null);
  const [waiting, setWaiting] = useState<DuelWaitingResponse | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const startedAtRef = useRef(0);
  const questionRef = useRef(0);

  const question = questions[index] ?? null;

  useEffect(() => {
    if (loading) return;
    if (!user) router.push('/login');
  }, [loading, user, router]);

  // Display-only countdown; the server scores from the reported timeMs.
  useEffect(() => {
    if (stage !== 'playing' || !question) return;
    setSecondsLeft(SECONDS_PER_QUESTION);
    startedAtRef.current = Date.now();
    const timer = window.setInterval(() => {
      setSecondsLeft((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [stage, question]);

  // Time ran out: move on without answering (a skip at finish).
  useEffect(() => {
    if (stage === 'playing' && secondsLeft === 0 && question) {
      advance();
    }
  }, [secondsLeft, stage]);

  function advance(): void {
    questionRef.current += 1;
    setSelected('');
    if (questionRef.current >= questions.length) {
      void finish();
    } else {
      setIndex(questionRef.current);
    }
  }

  async function start(): Promise<void> {
    setError('');
    setBusy(true);
    try {
      const res = await api<DuelStartResponse>(`/duels/${kind}/start`, {
        method: 'POST',
        token: accessToken,
      });
      setDuelId(res.duelId);
      setQuestions(res.questions);
      questionRef.current = 0;
      setIndex(0);
      setStage('playing');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not start the duel.');
    } finally {
      setBusy(false);
    }
  }

  async function answer(optionId: string): Promise<void> {
    if (!question || busy) return;
    setSelected(optionId);
    setBusy(true);
    try {
      const timeMs = Math.min(15000, Date.now() - startedAtRef.current);
      await api(`/duels/${kind}/${duelId}/answer`, {
        method: 'POST',
        token: accessToken,
        body: { questionId: question.id, optionId, timeMs },
      });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not send the answer.');
      setBusy(false);
      return;
    }
    setBusy(false);
    advance();
  }

  async function finish(): Promise<void> {
    setBusy(true);
    try {
      const res = await api<DuelResultResponse | DuelWaitingResponse>(
        `/duels/${kind}/${duelId}/finish`,
        { method: 'POST', token: accessToken }
      );
      if (res.status === 'WAITING_OPPONENT') {
        setWaiting(res);
        setStage('waiting');
      } else {
        setResult(res);
        setStage('done');
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not finish the duel.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-2 text-sm text-slate-400">{blurb}</p>
      {error && (
        <p className="mt-4 rounded border border-rose-400/40 bg-rose-400/5 p-3 text-sm text-rose-200">
          {error}
        </p>
      )}

      {stage === 'idle' && (
        <button
          onClick={() => void start()}
          disabled={busy}
          className="mt-6 w-full rounded bg-amber-400 px-5 py-2.5 font-medium text-slate-950 hover:bg-amber-300 disabled:opacity-50"
        >
          {busy ? 'Starting…' : 'Start'}
        </button>
      )}

      {stage === 'playing' && question && (
        <div className="mt-6 rounded border border-slate-800 bg-slate-900/50 p-4">
          <div className="flex justify-between text-sm text-slate-400">
            <span>
              Question {index + 1} of {questions.length}
            </span>
            <span>{secondsLeft}s left</span>
          </div>
          <p className="mt-3 font-medium">{question.stem}</p>
          <div className="mt-4 space-y-2">
            {question.options.map((o) => (
              <button
                key={o.id}
                onClick={() => void answer(o.id)}
                disabled={busy || selected !== ''}
                className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-left hover:border-amber-400 disabled:opacity-50"
              >
                {o.text}
              </button>
            ))}
          </div>
          <button
            onClick={() => advance()}
            disabled={busy}
            className="mt-4 text-sm text-slate-400 underline disabled:opacity-50"
          >
            Skip this question
          </button>
        </div>
      )}

      {stage === 'waiting' && waiting && (
        <div className="mt-6 rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-medium">Finished — waiting for an opponent</h2>
          <p className="mt-1 text-sm text-slate-400">{waiting.message}</p>
          <p className="mt-2 text-sm">
            Your score: {waiting.myScore} points ({waiting.myCorrect}/{waiting.totalQuestions}{' '}
            correct).
          </p>
          <Link
            href={`/duels/${waiting.duelId}/result`}
            className="mt-3 inline-block rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            View result
          </Link>
        </div>
      )}

      {stage === 'done' && result && (
        <div className="mt-6">
          <DuelResultView result={result} />
          <Link href="/duels" className="mt-4 inline-block text-sm text-slate-400 underline">
            Back to duels
          </Link>
        </div>
      )}

      <DuelsDisclaimer />
    </main>
  );
}
