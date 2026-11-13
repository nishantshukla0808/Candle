'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { api, ApiClientError } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

interface AdminTrack {
  id: string;
  slug: string;
  title: string;
  description: string;
  order: number;
  status: string;
}

export default function AdminTracksPage(): JSX.Element {
  const { accessToken, user, loading, isAdmin } = useAuth();
  const router = useRouter();
  const [tracks, setTracks] = useState<AdminTrack[]>([]);
  const [error, setError] = useState('');
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await api<AdminTrack[]>('/admin/tracks', { token: accessToken });
      setTracks(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load.');
    }
  }, [accessToken]);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.push('/');
    void load();
  }, [loading, user, isAdmin, router, load]);

  async function create(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!accessToken) return;
    setError('');
    try {
      await api('/admin/tracks', {
        method: 'POST',
        token: accessToken,
        body: {
          slug: slug.trim(),
          title: title.trim(),
          description: description.trim(),
          order: tracks.length,
        },
      });
      setSlug('');
      setTitle('');
      setDescription('');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Create failed.');
    }
  }

  async function publish(id: string): Promise<void> {
    if (!accessToken) return;
    try {
      await api(`/admin/tracks/${id}/publish`, { method: 'POST', token: accessToken });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Publish failed.');
    }
  }

  if (loading) return <p className="text-slate-400 py-10">Loading…</p>;

  return (
    <div className="py-6">
      <Link href="/admin" className="text-sm text-slate-400 hover:text-white">
        ← Admin
      </Link>
      <h1 className="mt-2 text-2xl font-bold">Tracks</h1>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <form
        onSubmit={(e) => void create(e)}
        className="mt-6 border border-slate-800 rounded p-4 bg-slate-900/50 space-y-3 max-w-lg"
      >
        <h2 className="font-semibold">New track</h2>
        <input
          placeholder="slug (e.g. foundations)"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
          required
        />
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
          required
        />
        <textarea
          placeholder="Description (min 10 chars)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
          required
        />
        <button
          type="submit"
          className="bg-violet-500 text-white px-4 py-1.5 rounded text-sm hover:bg-violet-400"
        >
          Create track
        </button>
      </form>

      <div className="mt-6 space-y-2">
        {tracks.map((t) => (
          <div
            key={t.id}
            className="flex items-center gap-3 border border-slate-800 rounded px-4 py-3"
          >
            <div>
              <p className="font-medium">
                {t.title} <span className="text-xs text-slate-500">({t.slug})</span>
              </p>
              <p className="text-xs text-slate-500">
                Status:{' '}
                <span className={t.status === 'PUBLISHED' ? 'text-emerald-400' : 'text-amber-300'}>
                  {t.status}
                </span>
              </p>
            </div>
            <div className="ml-auto flex gap-2">
              {t.status !== 'PUBLISHED' && (
                <button
                  onClick={() => void publish(t.id)}
                  className="text-xs border border-slate-600 px-3 py-1 rounded hover:border-slate-400"
                >
                  Publish
                </button>
              )}
              <Link
                href={`/admin/tracks/${t.id}`}
                className="text-xs border border-slate-600 px-3 py-1 rounded hover:border-slate-400"
              >
                Manage
              </Link>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
