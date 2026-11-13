'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { api, ApiClientError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';

interface AdminLesson {
  id: string;
  title: string;
  order: number;
  latestVersion: { id: string; version: number; status: string } | null;
}

interface AdminModule {
  id: string;
  title: string;
  order: number;
  status: string;
  lessons: AdminLesson[];
}

interface AdminTrackTree {
  id: string;
  slug: string;
  title: string;
  status: string;
  modules: AdminModule[];
}

export default function AdminTrackManagePage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { accessToken, user, loading, isAdmin } = useAuth();
  const router = useRouter();
  const [tree, setTree] = useState<AdminTrackTree | null>(null);
  const [error, setError] = useState('');
  const [moduleTitle, setModuleTitle] = useState('');
  const [lessonModuleId, setLessonModuleId] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await api<AdminTrackTree>(`/admin/tracks/${id}`, { token: accessToken });
      setTree(data);
      if (!lessonModuleId && data.modules.length > 0) {
        const first = data.modules[0];
        if (first) setLessonModuleId(first.id);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load.');
    }
  }, [accessToken, id]);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.push('/');
    void load();
  }, [loading, user, isAdmin, router, load]);

  async function createModule(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!accessToken || !tree) return;
    try {
      await api('/admin/modules', {
        method: 'POST',
        token: accessToken,
        body: { trackId: tree.id, title: moduleTitle.trim(), order: tree.modules.length },
      });
      setModuleTitle('');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Create failed.');
    }
  }

  async function publishModule(moduleId: string): Promise<void> {
    if (!accessToken) return;
    try {
      await api(`/admin/modules/${moduleId}/publish`, { method: 'POST', token: accessToken });
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Publish failed.');
    }
  }

  async function createLesson(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!accessToken || !lessonModuleId) return;
    try {
      const mod = tree?.modules.find((m) => m.id === lessonModuleId);
      await api('/admin/lessons', {
        method: 'POST',
        token: accessToken,
        body: {
          moduleId: lessonModuleId,
          title: lessonTitle.trim(),
          order: mod?.lessons.length ?? 0,
        },
      });
      setLessonTitle('');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Create failed.');
    }
  }

  if (loading || !tree) return <p className="text-slate-400 py-10">Loading…</p>;

  return (
    <div className="py-6">
      <Link href="/admin/tracks" className="text-sm text-slate-400 hover:text-white">
        ← Tracks
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{tree.title}</h1>
      <p className="text-sm text-slate-500">
        {tree.slug} · {tree.status}
      </p>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <form onSubmit={(e) => void createModule(e)} className="mt-6 flex gap-2 max-w-lg">
        <input
          placeholder="New module title"
          value={moduleTitle}
          onChange={(e) => setModuleTitle(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm"
          required
        />
        <button
          type="submit"
          className="bg-violet-500 text-white px-4 py-1.5 rounded text-sm hover:bg-violet-400"
        >
          Add module
        </button>
      </form>

      <form onSubmit={(e) => void createLesson(e)} className="mt-3 flex gap-2 max-w-lg">
        <select
          value={lessonModuleId}
          onChange={(e) => setLessonModuleId(e.target.value)}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm"
        >
          {tree.modules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
        <input
          placeholder="New lesson title"
          value={lessonTitle}
          onChange={(e) => setLessonTitle(e.target.value)}
          className="flex-1 bg-slate-900 border border-slate-700 rounded px-3 py-1.5 text-sm"
          required
        />
        <button
          type="submit"
          className="bg-violet-500 text-white px-4 py-1.5 rounded text-sm hover:bg-violet-400"
        >
          Add lesson
        </button>
      </form>

      <div className="mt-8 space-y-6">
        {tree.modules.map((m) => (
          <section key={m.id} className="border border-slate-800 rounded p-4">
            <div className="flex items-center gap-3">
              <h2 className="font-semibold">{m.title}</h2>
              <span
                className={`text-xs ${m.status === 'PUBLISHED' ? 'text-emerald-400' : 'text-amber-300'}`}
              >
                {m.status}
              </span>
              {m.status !== 'PUBLISHED' && (
                <button
                  onClick={() => void publishModule(m.id)}
                  className="ml-auto text-xs border border-slate-600 px-3 py-1 rounded hover:border-slate-400"
                >
                  Publish module
                </button>
              )}
            </div>
            <ul className="mt-3 space-y-1">
              {m.lessons.map((l) => (
                <li key={l.id} className="flex items-center gap-2 text-sm">
                  <Link href={`/admin/lessons/${l.id}`} className="text-violet-300 hover:underline">
                    {l.title}
                  </Link>
                  <span className="text-xs text-slate-500">
                    {l.latestVersion
                      ? `v${l.latestVersion.version} ${l.latestVersion.status}`
                      : 'no version'}
                  </span>
                </li>
              ))}
              {m.lessons.length === 0 && (
                <li className="text-xs text-slate-600">No lessons yet.</li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
