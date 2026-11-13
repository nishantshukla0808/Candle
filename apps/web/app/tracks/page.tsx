'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { JSX } from 'react';
import { api, ApiClientError, type TrackSummary } from '../../lib/api';

export default function TracksPage(): JSX.Element {
  const [tracks, setTracks] = useState<TrackSummary[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await api<TrackSummary[]>('/learning/tracks');
        if (!cancelled) setTracks(data);
      } catch (err) {
        if (!cancelled)
          setError(err instanceof ApiClientError ? err.message : 'Failed to load tracks.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-red-400 py-10">{error}</p>;
  if (!tracks) return <p className="text-slate-400 py-10">Loading tracks…</p>;

  return (
    <div className="py-6">
      <h1 className="text-2xl font-bold">Learning tracks</h1>
      <div className="mt-6 grid gap-4">
        {tracks.map((t) => (
          <Link
            key={t.id}
            href={`/tracks/${t.slug}`}
            className="block border border-slate-800 rounded p-5 bg-slate-900/50 hover:border-amber-400/50"
          >
            <h2 className="text-lg font-semibold text-amber-200">{t.title}</h2>
            <p className="mt-1 text-sm text-slate-400">{t.description}</p>
          </Link>
        ))}
        {tracks.length === 0 && <p className="text-slate-500">No tracks published yet.</p>}
      </div>
    </div>
  );
}
