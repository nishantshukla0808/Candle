'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { api, ApiClientError, type KnowledgeProfile } from '../../lib/api';
import { useAuth } from '../../lib/auth';

/**
 * Onboarding welcome — "Let's find your starting line."
 * First run after registration. Skippable: "Skip for now" records the
 * dismissal and the dashboard shows a gentle nudge card instead.
 */
export default function OnboardingWelcomePage(): JSX.Element {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const [checking, setChecking] = useState(true);
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
        const profile = await api<KnowledgeProfile | null>('/onboarding/profile', {
          token: accessToken,
        });
        if (cancelled) return;
        if (profile !== null) {
          router.push('/dashboard');
          return;
        }
        if (
          typeof window !== 'undefined' &&
          window.localStorage.getItem('candle:onboarding-dismissed') === '1'
        ) {
          router.push('/dashboard');
          return;
        }
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiClientError ? err.message : 'Could not load onboarding.');
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, user, accessToken, router]);

  async function start(): Promise<void> {
    setError('');
    try {
      const attempt = await api<{ attemptId: string }>('/onboarding/assessment/start', {
        method: 'POST',
        token: accessToken,
      });
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('candle:assessment-attempt', attempt.attemptId);
      }
      router.push('/onboarding/assessment');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not start the assessment.');
    }
  }

  function skip(): void {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('candle:onboarding-dismissed', '1');
    }
    router.push('/dashboard');
  }

  if (checking) return <p className="text-slate-400 py-10">Loading…</p>;

  return (
    <div className="py-10 max-w-2xl">
      <p className="text-sm text-amber-300 font-medium">Mira · your daily coach</p>
      <h1 className="mt-2 text-3xl font-bold">Let&apos;s find your starting line.</h1>
      <p className="mt-4 text-slate-300">
        Answer 12 short questions — about 3 minutes. There are no grades here. Skip any question you
        are unsure about. This only decides where you start learning, so you never repeat what you
        already know.
      </p>
      <ul className="mt-6 space-y-2 text-slate-400 text-sm">
        <li>· One question per screen, 4 topics</li>
        <li>· Tell us if you know it, are unsure, or want to skip</li>
        <li>· You get a personal starting point at the end</li>
      </ul>
      {error && <p className="mt-4 text-red-400">{error}</p>}
      <div className="mt-8 flex items-center gap-4">
        <button
          onClick={() => void start()}
          className="bg-amber-400 text-slate-950 px-6 py-2.5 rounded font-medium hover:bg-amber-300"
        >
          Start
        </button>
        <button onClick={skip} className="text-slate-400 text-sm hover:text-slate-200">
          Skip for now
        </button>
      </div>
      <p className="mt-10 text-xs text-slate-600">
        <Link href="/dashboard" className="hover:text-slate-400">
          Back to dashboard
        </Link>
      </p>
      <p className="mt-4 text-xs text-slate-600">
        Educational purpose only — this is not investment advice.
      </p>
    </div>
  );
}
