'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  api,
  ApiClientError,
  type DuelResultResponse,
  type DuelWaitingResponse,
} from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';
import { DuelsDisclaimer } from '../../disclaimer';
import { DuelResultView } from '../../result-view';

/**
 * Duel result page — reads the stored post-game result (never
 * recomputed on page view). Unsettled duels show their status.
 */
export default function DuelResultPage(): JSX.Element {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const duelId = typeof params.id === 'string' ? params.id : '';
  const [result, setResult] = useState<DuelResultResponse | null>(null);
  const [waiting, setWaiting] = useState<DuelWaitingResponse | null>(null);
  const [inProgress, setInProgress] = useState(false);
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
        const res = await api<DuelResultResponse | DuelWaitingResponse | { status: 'IN_PROGRESS' }>(
          `/duels/${duelId}/result`,
          { token: accessToken }
        );
        if (cancelled) return;
        if (res.status === 'SETTLED') setResult(res);
        else if (res.status === 'WAITING_OPPONENT') setWaiting(res);
        else setInProgress(true);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiClientError ? err.message : 'Could not load the result.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, accessToken, router, duelId]);

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Duel result</h1>
      {error && (
        <p className="mt-4 rounded border border-rose-400/40 bg-rose-400/5 p-3 text-sm text-rose-200">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-6">
          <DuelResultView result={result} />
        </div>
      )}
      {waiting && (
        <div className="mt-6 rounded border border-slate-800 bg-slate-900/50 p-4">
          <h2 className="font-medium">Finished — waiting for an opponent</h2>
          <p className="mt-1 text-sm text-slate-400">{waiting.message}</p>
          <p className="mt-2 text-sm">
            Your score: {waiting.myScore} points ({waiting.myCorrect}/{waiting.totalQuestions}{' '}
            correct).
          </p>
        </div>
      )}
      {inProgress && (
        <p className="mt-6 text-sm text-slate-400">
          This duel is still in progress. Finish it to see the result.
        </p>
      )}
      <Link href="/duels" className="mt-6 inline-block text-sm text-slate-400 underline">
        Back to duels
      </Link>
      <DuelsDisclaimer />
    </main>
  );
}
