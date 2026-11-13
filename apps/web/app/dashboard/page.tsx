'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { api, ApiClientError, type Dashboard, type KnowledgeProfile } from '../../lib/api';
import { useAuth } from '../../lib/auth';

export default function DashboardPage(): JSX.Element {
  const { accessToken, user, loading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
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
        const d = await api<Dashboard>('/gamification/dashboard', { token: accessToken });
        if (!cancelled) setData(d);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiClientError ? err.message : 'Failed to load dashboard.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, accessToken, router]);

  if (error) return <p className="text-red-400 py-10">{error}</p>;
  if (!data) return <p className="text-slate-400 py-10">Loading dashboard…</p>;

  const { stats } = data;

  return (
    <div className="py-6">
      <h1 className="text-2xl font-bold">Your progress</h1>

      <OnboardingNudge accessToken={accessToken} />

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <div className="border border-slate-800 rounded p-4 bg-slate-900/50">
          <p className="text-xs text-slate-500 uppercase">Level</p>
          <p className="text-3xl font-bold text-amber-300">{stats.level}</p>
          {stats.xpToNextLevel !== null && (
            <p className="text-xs text-slate-500 mt-1">{stats.xpToNextLevel} XP to next level</p>
          )}
        </div>
        <div className="border border-slate-800 rounded p-4 bg-slate-900/50">
          <p className="text-xs text-slate-500 uppercase">Total XP</p>
          <p className="text-3xl font-bold">{stats.totalXp}</p>
        </div>
        <div className="border border-slate-800 rounded p-4 bg-slate-900/50">
          <p className="text-xs text-slate-500 uppercase">Streak</p>
          <p className="text-3xl font-bold">🔥 {stats.currentStreak}</p>
          <p className="text-xs text-slate-500 mt-1">Best: {stats.longestStreak} days</p>
        </div>
        <div className="border border-slate-800 rounded p-4 bg-slate-900/50">
          <p className="text-xs text-slate-500 uppercase">Badges</p>
          <p className="text-3xl font-bold">{data.badges.length}</p>
        </div>
      </div>

      <h2 className="mt-10 text-lg font-semibold">Tracks</h2>
      <div className="mt-3 space-y-3">
        {data.tracks.map((t) => {
          const pct =
            t.totalLessons > 0 ? Math.round((t.completedLessons / t.totalLessons) * 100) : 0;
          return (
            <Link
              key={t.id}
              href={`/tracks/${t.slug}`}
              className="block border border-slate-800 rounded p-4 bg-slate-900/50 hover:border-amber-400/50"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium">{t.title}</span>
                <span className="text-sm text-slate-400">
                  {t.completedLessons}/{t.totalLessons}
                </span>
              </div>
              <div className="mt-2 h-2 bg-slate-800 rounded overflow-hidden">
                <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
              </div>
            </Link>
          );
        })}
      </div>

      <h2 className="mt-10 text-lg font-semibold">Badges</h2>
      {data.badges.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">
          No badges yet — complete a lesson to earn your first.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {data.badges.map((b) => (
            <div key={b.id} className="border border-slate-800 rounded p-4 bg-slate-900/50">
              <p className="font-medium text-amber-200">🏅 {b.name}</p>
              <p className="text-sm text-slate-400 mt-1">{b.description}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Gentle nudge card — shown until the assessment is completed or
 * explicitly dismissed (spec §2: "Skip for now" → nudge on dashboard).
 */
function OnboardingNudge({ accessToken }: { accessToken: string | null }): JSX.Element | null {
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (
        typeof window !== 'undefined' &&
        window.localStorage.getItem('candle:onboarding-dismissed') === '1'
      ) {
        return;
      }
      try {
        const profile = await api<KnowledgeProfile | null>('/onboarding/profile', {
          token: accessToken,
        });
        if (!cancelled && profile === null) setShow(true);
      } catch {
        // The nudge is optional; never break the dashboard.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  if (!show) return null;

  function dismiss(): void {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('candle:onboarding-dismissed', '1');
    }
    setShow(false);
  }

  return (
    <div className="mt-6 border border-amber-400/30 rounded p-5 bg-amber-400/5 flex items-center justify-between gap-4">
      <div>
        <p className="font-semibold">Find your starting line</p>
        <p className="mt-1 text-sm text-slate-400">
          12 quick questions, 3 minutes — we will place you where you should start.
        </p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <Link
          href="/onboarding"
          className="bg-amber-400 text-slate-950 px-4 py-2 rounded font-medium hover:bg-amber-300 text-sm"
        >
          Start
        </Link>
        <button onClick={dismiss} className="text-sm text-slate-500 hover:text-slate-300">
          Dismiss
        </button>
      </div>
    </div>
  );
}
