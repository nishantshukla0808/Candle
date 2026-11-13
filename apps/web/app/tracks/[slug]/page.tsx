'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { api, ApiClientError, type TrackDetail } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

export default function TrackPage(): JSX.Element {
  const { slug } = useParams<{ slug: string }>();
  const { accessToken } = useAuth();
  const [track, setTrack] = useState<TrackDetail | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<TrackDetail>(`/learning/tracks/${slug}`, { token: accessToken });
        if (!cancelled) setTrack(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiClientError ? err.message : 'Failed to load track.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slug, accessToken]);

  if (error) return <p className="text-red-400 py-10">{error}</p>;
  if (!track) return <p className="text-slate-400 py-10">Loading…</p>;

  const pct =
    track.totalLessons > 0 ? Math.round((track.completedLessons / track.totalLessons) * 100) : 0;

  return (
    <div className="py-6">
      <Link href="/tracks" className="text-sm text-slate-400 hover:text-white">
        ← All tracks
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{track.title}</h1>
      <p className="mt-1 text-slate-400">{track.description}</p>
      <div className="mt-3 h-2 bg-slate-800 rounded overflow-hidden max-w-md">
        <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {track.completedLessons} of {track.totalLessons} lessons complete
      </p>

      {track.modules.map((m) => (
        <section key={m.id} className="mt-8">
          <h2 className="text-lg font-semibold text-slate-200">{m.title}</h2>
          {m.description && <p className="text-sm text-slate-500">{m.description}</p>}
          <ol className="mt-3 space-y-2">
            {m.lessons.map((l) => (
              <li key={l.id}>
                {l.locked ? (
                  <div className="flex items-center gap-3 border border-slate-800 rounded px-4 py-3 opacity-50">
                    <span className="text-slate-500">🔒</span>
                    <span className="text-slate-400">{l.title}</span>
                    <span className="ml-auto text-xs text-slate-600">
                      Complete the previous lesson
                    </span>
                  </div>
                ) : (
                  <Link
                    href={`/lessons/${l.id}`}
                    className="flex items-center gap-3 border border-slate-800 rounded px-4 py-3 hover:border-amber-400/50 bg-slate-900/50"
                  >
                    <span className={l.completed ? 'text-emerald-400' : 'text-slate-500'}>
                      {l.completed ? '✓' : '○'}
                    </span>
                    <span>{l.title}</span>
                    {l.published && l.published.questionCount > 0 && (
                      <span className="ml-auto text-xs text-slate-500">
                        {l.published.questionCount} questions
                      </span>
                    )}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
