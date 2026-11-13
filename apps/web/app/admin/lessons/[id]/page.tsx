'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { api, ApiClientError } from '../../../../lib/api';
import { useAuth } from '../../../../lib/auth';

interface DraftVersion {
  id: string;
  lessonId: string;
  version: number;
  title: string;
  contentMarkdown: string;
  status: string;
}

interface AdminQuestion {
  id: string;
  text: string;
  explanation: string;
  kind: 'SINGLE' | 'MULTI';
  order: number;
  points: number;
  options: Array<{ id: string; text: string; isCorrect: boolean; order: number }>;
}

export default function AdminLessonPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { accessToken, user, loading, isAdmin } = useAuth();
  const router = useRouter();

  const [draft, setDraft] = useState<DraftVersion | null>(null);
  const [versions, setVersions] = useState<DraftVersion[]>([]);
  const [questions, setQuestions] = useState<AdminQuestion[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Draft editor state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  // Question form state
  const [qText, setQText] = useState('');
  const [qExplanation, setQExplanation] = useState('');
  const [qKind, setQKind] = useState<'SINGLE' | 'MULTI'>('SINGLE');
  const [qOptions, setQOptions] = useState('Correct answer\nWrong answer');

  const load = useCallback(async () => {
    if (!accessToken) return;
    try {
      const d = await api<DraftVersion>(`/admin/lessons/${id}/draft`, { token: accessToken });
      setDraft(d);
      setTitle(d.title);
      setContent(d.contentMarkdown);
      const vs = await api<DraftVersion[]>(`/admin/lessons/${id}/versions`, { token: accessToken });
      setVersions(vs);
      const qs = await api<AdminQuestion[]>(`/admin/lessons/${id}/questions`, {
        token: accessToken,
      }).catch(() => [] as AdminQuestion[]);
      setQuestions(qs);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load.');
    }
  }, [accessToken, id]);

  useEffect(() => {
    if (!loading && (!user || !isAdmin)) router.push('/');
    void load();
  }, [loading, user, isAdmin, router, load]);

  async function saveDraft(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!accessToken) return;
    setNotice('');
    try {
      await api(`/admin/lessons/${id}/draft`, {
        method: 'PATCH',
        token: accessToken,
        body: { title: title.trim(), contentMarkdown: content },
      });
      setNotice('Draft saved.');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Save failed.');
    }
  }

  async function publish(): Promise<void> {
    if (!accessToken) return;
    setNotice('');
    try {
      await api(`/admin/lessons/${id}/publish`, { method: 'POST', token: accessToken });
      setNotice('Published.');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Publish failed.');
    }
  }

  async function addQuestion(e: FormEvent): Promise<void> {
    e.preventDefault();
    if (!accessToken) return;
    const lines = qOptions
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length < 2) {
      setError('Provide at least two options, one per line. Prefix correct ones with "* ".');
      return;
    }
    const options = lines.map((line, i) => {
      const isCorrect = line.startsWith('* ');
      return { text: isCorrect ? line.slice(2) : line, isCorrect, order: i };
    });
    if (!options.some((o) => o.isCorrect)) {
      setError('Mark at least one correct option with "* ".');
      return;
    }
    try {
      await api(`/admin/lessons/${id}/questions`, {
        method: 'POST',
        token: accessToken,
        body: {
          text: qText.trim(),
          explanation: qExplanation.trim(),
          kind: qKind,
          order: questions.length,
          points: 10,
          options,
        },
      });
      setQText('');
      setQExplanation('');
      setQOptions('Correct answer\nWrong answer');
      setNotice('Question added to the draft.');
      await load();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Add failed.');
    }
  }

  async function deleteQuestion(questionId: string): Promise<void> {
    if (!accessToken) return;
    try {
      await api(`/admin/questions/${questionId}`, { method: 'DELETE', token: accessToken });
      await load();
    } catch (err) {
      setError(
        err instanceof ApiClientError
          ? err.message
          : 'Delete failed (published versions are immutable).'
      );
    }
  }

  if (loading) return <p className="text-slate-400 py-10">Loading…</p>;

  return (
    <div className="py-6">
      <Link href="/admin/tracks" className="text-sm text-slate-400 hover:text-white">
        ← Tracks
      </Link>
      <h1 className="mt-2 text-2xl font-bold">Lesson editor</h1>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      {notice && <p className="mt-2 text-sm text-emerald-300">{notice}</p>}

      {draft && (
        <form onSubmit={(e) => void saveDraft(e)} className="mt-6 space-y-3 max-w-2xl">
          <p className="text-sm text-slate-400">
            Editing draft <span className="text-amber-300">v{draft.version}</span> ({draft.status})
          </p>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Lesson title"
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2"
            required
          />
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Markdown content"
            rows={12}
            className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 font-mono text-sm"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="bg-violet-500 text-white px-4 py-1.5 rounded text-sm hover:bg-violet-400"
            >
              Save draft
            </button>
            <button
              type="button"
              onClick={() => void publish()}
              className="bg-emerald-600 text-white px-4 py-1.5 rounded text-sm hover:bg-emerald-500"
            >
              Publish v{draft.version}
            </button>
          </div>
        </form>
      )}

      <h2 className="mt-10 text-lg font-semibold">Questions (draft only)</h2>
      <div className="mt-3 space-y-2 max-w-2xl">
        {questions.map((q, i) => (
          <div key={q.id} className="border border-slate-800 rounded p-3 text-sm">
            <p className="font-medium">
              {i + 1}. {q.text}{' '}
              <span className="text-xs text-slate-500">
                ({q.kind}, {q.points} pts)
              </span>
            </p>
            <ul className="mt-1 text-slate-400">
              {q.options.map((o) => (
                <li key={o.id}>
                  {o.isCorrect ? '✓' : '·'} {o.text}
                </li>
              ))}
            </ul>
            <button
              onClick={() => void deleteQuestion(q.id)}
              className="mt-2 text-xs text-red-400 hover:underline"
            >
              Delete
            </button>
          </div>
        ))}
        {questions.length === 0 && (
          <p className="text-sm text-slate-600">No questions on this draft.</p>
        )}
      </div>

      <form
        onSubmit={(e) => void addQuestion(e)}
        className="mt-4 space-y-3 max-w-2xl border border-slate-800 rounded p-4"
      >
        <h3 className="font-medium">Add question</h3>
        <input
          value={qText}
          onChange={(e) => setQText(e.target.value)}
          placeholder="Question text"
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
          required
        />
        <input
          value={qExplanation}
          onChange={(e) => setQExplanation(e.target.value)}
          placeholder="Explanation (shown after answering)"
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm"
          required
        />
        <select
          value={qKind}
          onChange={(e) => setQKind(e.target.value as 'SINGLE' | 'MULTI')}
          className="bg-slate-900 border border-slate-700 rounded px-2 py-1.5 text-sm"
        >
          <option value="SINGLE">Single correct</option>
          <option value="MULTI">Multiple correct</option>
        </select>
        <textarea
          value={qOptions}
          onChange={(e) => setQOptions(e.target.value)}
          rows={4}
          placeholder={'One option per line. Prefix correct ones with "* "'}
          className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-sm font-mono"
        />
        <button
          type="submit"
          className="bg-violet-500 text-white px-4 py-1.5 rounded text-sm hover:bg-violet-400"
        >
          Add question
        </button>
      </form>

      <h2 className="mt-10 text-lg font-semibold">Versions</h2>
      <ul className="mt-2 space-y-1 text-sm">
        {versions.map((v) => (
          <li key={v.id} className="text-slate-400">
            v{v.version} — {v.status} — {v.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
