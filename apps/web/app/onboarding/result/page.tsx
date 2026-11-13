'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  api,
  ApiClientError,
  type AcceptPlacementResponse,
  type AssessmentResultView,
  type TrackDetail,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

/**
 * Assessment results — per-topic levels revealed one by one (levels only,
 * never scores), then the placement choice: start where placed, or from
 * the beginning.
 */
export default function AssessmentResultPage(): JSX.Element {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const [result, setResult] = useState<AssessmentResultView | null>(null);
  const [moduleTitle, setModuleTitle] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    let cancelled = false;
    const raw =
      typeof window !== 'undefined'
        ? window.sessionStorage.getItem('candle:assessment-result')
        : null;
    if (!raw) {
      router.push('/onboarding');
      return;
    }
    const parsed = JSON.parse(raw) as AssessmentResultView;
    if (!cancelled) setResult(parsed);
    void (async () => {
      try {
        const track = await api<TrackDetail>('/learning/tracks/foundations', {
          token: accessToken,
        });
        if (cancelled) return;
        const mod = track.modules.find(
          (m) => m.order === parsed.placement.recommendedStartModuleOrder
        );
        setModuleTitle(mod ? mod.title : null);
      } catch {
        // Module title is a nicety; placement still works without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, accessToken, router]);

  async function accept(choice: 'RECOMMENDED' | 'FROM_BEGINNING'): Promise<void> {
    setError('');
    setBusy(true);
    try {
      await api<AcceptPlacementResponse>('/onboarding/placement/accept', {
        method: 'POST',
        token: accessToken,
        body: { choice },
      });
      if (typeof window !== 'undefined') {
        window.sessionStorage.removeItem('candle:assessment-result');
        window.localStorage.removeItem('candle:onboarding-dismissed');
      }
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not save your choice.');
    } finally {
      setBusy(false);
    }
  }

  if (!result) return <p className="text-slate-400 py-10">Loading results…</p>;

  return (
    <div className="py-10 max-w-2xl">
      <p className="text-sm text-amber-300 font-medium">Mira · your daily coach</p>
      <h1 className="mt-2 text-3xl font-bold">Here is your starting line.</h1>
      <p className="mt-3 text-slate-400">
        These levels show where you stand today — not a grade, just a map.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {result.topics.map((t, i) => (
          <div
            key={t.topicKey}
            className="border border-slate-800 rounded p-4 bg-slate-900/50 animate-[fadeUp_0.5s_ease-out_both]"
            style={{ animationDelay: `${i * 0.15}s` }}
          >
            <p className="text-sm text-slate-500 capitalize">{t.topicKey.replace('-', ' ')}</p>
            <p className="mt-1 text-lg font-semibold text-amber-200">
              Level {t.level} · {t.label}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-8 border border-amber-400/30 rounded p-5 bg-amber-400/5">
        <h2 className="font-semibold text-lg">Your recommended start</h2>
        <p className="mt-2 text-slate-300">
          {result.placement.kind === 'FAST_TRACK'
            ? `You already know the basics well — start with “${moduleTitle ?? 'Think Like an Investor'}” as a refresher.`
            : `Start with “${moduleTitle ?? 'the recommended module'}”. Earlier modules will unlock as placed out.`}
        </p>
        {error && <p className="mt-3 text-red-400">{error}</p>}
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button
            onClick={() => void accept('RECOMMENDED')}
            disabled={busy}
            className="bg-amber-400 text-slate-950 px-5 py-2.5 rounded font-medium hover:bg-amber-300 disabled:opacity-40"
          >
            Start where I placed
          </button>
          <button
            onClick={() => void accept('FROM_BEGINNING')}
            disabled={busy}
            className="border border-slate-600 px-5 py-2.5 rounded font-medium hover:border-slate-400 disabled:opacity-40"
          >
            Start from the beginning
          </button>
        </div>
      </div>

      <p className="mt-10 text-xs text-slate-600">
        Educational purpose only — this is not investment advice.
      </p>
    </div>
  );
}
