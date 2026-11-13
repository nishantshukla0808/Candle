'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  api,
  newIdempotencyKey,
  ApiClientError,
  type AttemptView,
  type CompletionResponse,
  type LessonDetail,
  type SubmitResponse,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

/**
 * Minimal markdown renderer for lesson content (headers, bold, italic,
 * lists, rules, paragraphs). Keeps the web bundle free of a markdown dep.
 */
function renderMarkdown(md: string): JSX.Element[] {
  const blocks = md.split(/\n{2,}/);
  return blocks.map((block, i) => {
    const trimmed = block.trim();
    if (/^---+$/.test(trimmed)) return <hr key={i} className="border-slate-700 my-4" />;
    const h = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (h?.[1] && h[2] !== undefined) {
      const level = h[1].length;
      const text = inline(h[2]);
      const cls =
        'font-bold text-slate-100 ' +
        (level === 1 ? 'text-xl mt-6' : level === 2 ? 'text-lg mt-5' : 'mt-4');
      return (
        <div key={i} className={cls}>
          {text}
        </div>
      );
    }
    if (/^(\d+\.\s+|-\s+|\*\s+)/m.test(trimmed)) {
      const items = trimmed.split('\n').map((line) => line.replace(/^(\d+\.\s+|-\s+|\*\s+)/, ''));
      return (
        <ul key={i} className="list-disc pl-6 space-y-1 my-3 text-slate-300">
          {items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>
      );
    }
    return (
      <p key={i} className="my-3 text-slate-300 leading-relaxed">
        {inline(trimmed)}
      </p>
    );
  });
}

function inline(text: string): (string | JSX.Element)[] {
  // **bold** and *italic*
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('**') && p.endsWith('**')) {
      return (
        <strong key={i} className="text-slate-100">
          {p.slice(2, -2)}
        </strong>
      );
    }
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) {
      return <em key={i}>{p.slice(1, -1)}</em>;
    }
    return p;
  });
}

type QuizPhase = 'idle' | 'answering' | 'submitted';

export default function LessonPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const { accessToken, user } = useAuth();
  const router = useRouter();

  const [lesson, setLesson] = useState<LessonDetail | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState<AttemptView | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [phase, setPhase] = useState<QuizPhase>('idle');
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [completion, setCompletion] = useState<CompletionResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    try {
      const data = await api<LessonDetail>(`/learning/lessons/${id}`, { token: accessToken });
      setLesson(data);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Failed to load lesson.');
    }
  }, [id, accessToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const requireAuth = (): string | null => {
    if (!accessToken || !user) {
      router.push('/login');
      return null;
    }
    return accessToken;
  };

  async function startQuiz(): Promise<void> {
    const token = requireAuth();
    if (!token) return;
    setBusy(true);
    setNotice('');
    try {
      const view = await api<AttemptView>(`/quiz/lessons/${id}/attempts`, {
        method: 'POST',
        token,
      });
      setAttempt(view);
      setAnswers({});
      setResult(null);
      setPhase('answering');
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : 'Could not start quiz.');
    } finally {
      setBusy(false);
    }
  }

  function toggle(questionId: string, optionId: string, multi: boolean): void {
    setAnswers((prev) => {
      const current = prev[questionId] ?? [];
      if (multi) {
        return {
          ...prev,
          [questionId]: current.includes(optionId)
            ? current.filter((o) => o !== optionId)
            : [...current, optionId],
        };
      }
      return { ...prev, [questionId]: [optionId] };
    });
  }

  async function submitQuiz(): Promise<void> {
    const token = requireAuth();
    if (!token || !attempt) return;
    setBusy(true);
    try {
      const payload = {
        answers: attempt.questions.map((q) => ({
          questionId: q.id,
          selectedOptionIds: answers[q.id] ?? [],
        })),
      };
      const res = await api<SubmitResponse>(`/quiz/attempts/${attempt.attemptId}/submit`, {
        method: 'POST',
        token,
        body: payload,
        idempotencyKey: newIdempotencyKey(),
      });
      setResult(res);
      setPhase('submitted');
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : 'Submit failed.');
    } finally {
      setBusy(false);
    }
  }

  async function completeLesson(): Promise<void> {
    const token = requireAuth();
    if (!token) return;
    setBusy(true);
    try {
      const res = await api<CompletionResponse>(`/learning/lessons/${id}/complete`, {
        method: 'POST',
        token,
        idempotencyKey: newIdempotencyKey(),
      });
      setCompletion(res);
      void load();
    } catch (err) {
      setNotice(err instanceof ApiClientError ? err.message : 'Completion failed.');
    } finally {
      setBusy(false);
    }
  }

  const quizPassed = useMemo(() => result?.passed ?? false, [result]);

  if (error) return <p className="text-red-400 py-10">{error}</p>;
  if (!lesson) return <p className="text-slate-400 py-10">Loading lesson…</p>;

  return (
    <div className="py-6">
      <Link
        href={`/tracks/${lesson.trackSlug}`}
        className="text-sm text-slate-400 hover:text-white"
      >
        ← {lesson.moduleTitle}
      </Link>
      <h1 className="mt-2 text-2xl font-bold">{lesson.title}</h1>
      <p className="text-xs text-slate-500 mt-1">
        Version {lesson.version} · {lesson.questionCount} quiz questions
        {lesson.completed && <span className="text-emerald-400"> · Completed ✓</span>}
      </p>

      <article className="mt-6 border border-slate-800 rounded p-6 bg-slate-900/50">
        {renderMarkdown(lesson.contentMarkdown)}
      </article>
      <p className="mt-4 text-xs text-slate-500 border-l-2 border-amber-400/50 pl-3">
        {lesson.disclaimer}
      </p>

      {notice && <p className="mt-4 text-sm text-red-400">{notice}</p>}

      {/* Quiz + completion */}
      <section className="mt-8">
        {!user && (
          <p className="text-slate-400">
            <Link href="/login" className="text-amber-300 hover:underline">
              Log in
            </Link>{' '}
            to take the quiz and earn XP.
          </p>
        )}

        {user &&
          !lesson.completed &&
          phase === 'idle' &&
          lesson.questionCount > 0 &&
          !completion && (
            <button
              onClick={() => void startQuiz()}
              disabled={busy || lesson.locked}
              className="bg-amber-400 text-slate-950 px-5 py-2 rounded font-medium hover:bg-amber-300 disabled:opacity-50"
            >
              {busy
                ? 'Starting…'
                : lesson.locked
                  ? 'Locked — complete the previous lesson'
                  : 'Start quiz'}
            </button>
          )}

        {user &&
          !lesson.completed &&
          phase === 'idle' &&
          lesson.questionCount === 0 &&
          !completion && (
            <button
              onClick={() => void completeLesson()}
              disabled={busy || lesson.locked}
              className="bg-amber-400 text-slate-950 px-5 py-2 rounded font-medium hover:bg-amber-300 disabled:opacity-50"
            >
              {busy ? 'Completing…' : 'Mark as complete'}
            </button>
          )}

        {phase !== 'idle' && attempt && (
          <div className="mt-4 space-y-6">
            <h2 className="text-lg font-semibold">Quiz</h2>
            {attempt.questions.map((q, qi) => {
              const feedback = result?.feedback.find((f) => f.questionId === q.id);
              const multi = q.kind === 'MULTI';
              return (
                <div key={q.id} className="border border-slate-800 rounded p-4 bg-slate-900/50">
                  <p className="font-medium">
                    {qi + 1}. {q.text}{' '}
                    <span className="text-xs text-slate-500">
                      ({q.points} pts{multi ? ', select all that apply' : ''})
                    </span>
                  </p>
                  <div className="mt-3 space-y-2">
                    {q.options.map((o) => {
                      const selected = (answers[q.id] ?? []).includes(o.id);
                      const isCorrectOption = feedback?.correctOptionIds.includes(o.id) ?? false;
                      return (
                        <label
                          key={o.id}
                          className={`flex items-center gap-2 px-3 py-2 rounded border cursor-pointer ${
                            feedback
                              ? isCorrectOption
                                ? 'border-emerald-500/60 bg-emerald-500/10'
                                : selected
                                  ? 'border-red-500/60 bg-red-500/10'
                                  : 'border-slate-700'
                              : selected
                                ? 'border-amber-400/60 bg-amber-400/10'
                                : 'border-slate-700 hover:border-slate-500'
                          }`}
                        >
                          <input
                            type={multi ? 'checkbox' : 'radio'}
                            name={q.id}
                            checked={selected}
                            disabled={phase === 'submitted'}
                            onChange={() => toggle(q.id, o.id, multi)}
                            className="accent-amber-400"
                          />
                          <span className="text-sm">{o.text}</span>
                        </label>
                      );
                    })}
                  </div>
                  {feedback && (
                    <div className="mt-3 text-sm">
                      <p className={feedback.correct ? 'text-emerald-300' : 'text-red-300'}>
                        {feedback.correct
                          ? `✓ Correct (+${feedback.pointsAwarded})`
                          : '✗ Incorrect'}
                      </p>
                      <p className="mt-1 text-slate-400">{feedback.explanation}</p>
                    </div>
                  )}
                </div>
              );
            })}

            {phase === 'answering' && (
              <button
                onClick={() => void submitQuiz()}
                disabled={busy}
                className="bg-amber-400 text-slate-950 px-5 py-2 rounded font-medium hover:bg-amber-300 disabled:opacity-50"
              >
                {busy ? 'Grading…' : 'Submit answers'}
              </button>
            )}

            {phase === 'submitted' && result && (
              <div className="border border-slate-700 rounded p-4 bg-slate-900">
                <p className="font-semibold">
                  Score: {result.score}/{result.totalPoints} —{' '}
                  <span className={result.passed ? 'text-emerald-300' : 'text-red-300'}>
                    {result.passed ? 'Passed!' : 'Not passed yet'}
                  </span>
                </p>
                {result.rewards.xpAwarded > 0 && (
                  <p className="text-sm text-amber-300 mt-1">+{result.rewards.xpAwarded} XP</p>
                )}
                {!result.passed && (
                  <button
                    onClick={() => void startQuiz()}
                    disabled={busy}
                    className="mt-3 border border-slate-600 px-4 py-1.5 rounded text-sm hover:border-slate-400"
                  >
                    Try again
                  </button>
                )}
                {quizPassed && !lesson.completed && !completion && (
                  <button
                    onClick={() => void completeLesson()}
                    disabled={busy}
                    className="mt-3 ml-3 bg-amber-400 text-slate-950 px-5 py-1.5 rounded font-medium hover:bg-amber-300 disabled:opacity-50"
                  >
                    {busy ? 'Completing…' : 'Complete lesson'}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {completion && (
          <div className="mt-6 border border-emerald-500/40 bg-emerald-500/10 rounded p-5">
            <h3 className="font-bold text-emerald-300 text-lg">Lesson complete! 🎉</h3>
            <p className="mt-2 text-sm">
              +{completion.rewards.xpAwarded} XP · Level {completion.rewards.level}
              {completion.rewards.levelUp && ' — level up!'} · 🔥 {completion.rewards.currentStreak}
              -day streak
            </p>
            {completion.rewards.newBadges.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-medium">New badges:</p>
                <ul className="mt-1 space-y-1">
                  {completion.rewards.newBadges.map((b) => (
                    <li key={b.id} className="text-sm text-amber-200">
                      🏅 {b.name} — {b.description}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link
              href={`/tracks/${lesson.trackSlug}`}
              className="inline-block mt-4 text-sm text-amber-300 hover:underline"
            >
              Continue to next lesson →
            </Link>
          </div>
        )}
      </section>
    </div>
  );
}
