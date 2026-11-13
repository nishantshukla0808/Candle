'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import {
  api,
  ApiClientError,
  newIdempotencyKey,
  type AssessmentAttemptView,
  type AssessmentQuestionView,
  type AssessmentResultView,
} from '../../../lib/api';
import { useAuth } from '../../../lib/auth';

type Confidence = 'CONFIDENT' | 'GUESSING' | 'SKIPPED';

interface AnswerState {
  selected: string[];
  confidence: Confidence | null;
}

/**
 * Assessment questions — one per screen, topic-mixed and shuffled by the API.
 * Correct answers and explanations are never shown: this is a diagnostic.
 */
export default function AssessmentPage(): JSX.Element {
  const { user, accessToken, loading } = useAuth();
  const router = useRouter();
  const [attempt, setAttempt] = useState<AssessmentAttemptView | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerState>>({});
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const loadAttempt = useCallback(async (): Promise<void> => {
    setError('');
    try {
      const data = await api<AssessmentAttemptView>('/onboarding/assessment/start', {
        method: 'POST',
        token: accessToken,
      });
      setAttempt(data);
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('candle:assessment-attempt', data.attemptId);
      }
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not load questions.');
    }
  }, [accessToken]);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.push('/login');
      return;
    }
    void loadAttempt();
  }, [loading, user, router, loadAttempt]);

  if (!attempt) {
    return (
      <div className="py-10">
        {error ? (
          <p className="text-red-400">{error}</p>
        ) : (
          <p className="text-slate-400">Loading questions…</p>
        )}
      </div>
    );
  }

  const question: AssessmentQuestionView | undefined = attempt.questions[index];
  if (!question) return <p className="text-slate-400 py-10">No questions in this attempt.</p>;

  // Non-optional aliases: narrowing does not survive into the closures below.
  const activeAttempt: AssessmentAttemptView = attempt;
  const activeQuestion: AssessmentQuestionView = question;

  const current: AnswerState = answers[activeQuestion.id] ?? { selected: [], confidence: null };

  function toggleOption(optionId: string): void {
    setAnswers((prev) => {
      const prevAnswer: AnswerState = prev[activeQuestion.id] ?? { selected: [], confidence: null };
      const selected =
        activeQuestion.kind === 'SINGLE'
          ? [optionId]
          : prevAnswer.selected.includes(optionId)
            ? prevAnswer.selected.filter((id) => id !== optionId)
            : [...prevAnswer.selected, optionId];
      return { ...prev, [activeQuestion.id]: { selected, confidence: prevAnswer.confidence } };
    });
  }

  function setConfidence(confidence: Confidence): void {
    setAnswers((prev) => {
      const prevAnswer: AnswerState = prev[activeQuestion.id] ?? { selected: [], confidence: null };
      // Skip is first-class and shame-free: it clears any selection.
      const selected = confidence === 'SKIPPED' ? [] : prevAnswer.selected;
      return { ...prev, [activeQuestion.id]: { selected, confidence } };
    });
  }

  const canContinue =
    current.confidence !== null &&
    (current.confidence === 'SKIPPED' || current.selected.length > 0);
  const isLast = index === activeAttempt.questions.length - 1;

  async function submit(): Promise<void> {
    setError('');
    setSubmitting(true);
    try {
      const body = {
        answers: activeAttempt.questions.map((q) => {
          const a: AnswerState = answers[q.id] ?? { selected: [], confidence: 'SKIPPED' };
          return {
            questionId: q.id,
            selectedOptionIds: a.selected,
            confidence: a.confidence ?? 'SKIPPED',
          };
        }),
      };
      const result = await api<AssessmentResultView>(
        `/onboarding/assessment/attempts/${activeAttempt.attemptId}/submit`,
        { method: 'POST', token: accessToken, body, idempotencyKey: newIdempotencyKey() }
      );
      if (typeof window !== 'undefined') {
        window.sessionStorage.setItem('candle:assessment-result', JSON.stringify(result));
        window.sessionStorage.removeItem('candle:assessment-attempt');
      }
      router.push('/onboarding/result');
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Could not submit the assessment.');
    } finally {
      setSubmitting(false);
    }
  }

  async function exit(): Promise<void> {
    try {
      await api(`/onboarding/assessment/attempts/${activeAttempt.attemptId}/abandon`, {
        method: 'POST',
        token: accessToken,
      });
    } catch {
      // Abandon is best-effort; the attempt simply expires.
    } finally {
      router.push('/dashboard');
    }
  }

  return (
    <div className="py-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          Question {index + 1} of {attempt.questions.length}
        </p>
        <button onClick={() => void exit()} className="text-sm text-slate-500 hover:text-slate-300">
          Exit
        </button>
      </div>
      <div className="mt-2 h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className="h-full bg-amber-400 rounded-full transition-all"
          style={{ width: `${((index + 1) / attempt.questions.length) * 100}%` }}
        />
      </div>

      <h2 className="mt-6 text-xl font-semibold">{question.text}</h2>
      {question.kind === 'MULTI' && (
        <p className="mt-1 text-sm text-slate-500">Select all that apply.</p>
      )}

      <div className="mt-4 space-y-2">
        {question.options.map((o) => {
          const active = current.selected.includes(o.id);
          return (
            <button
              key={o.id}
              onClick={() => toggleOption(o.id)}
              className={`w-full text-left border rounded p-3 transition-colors ${
                active
                  ? 'border-amber-400 bg-amber-400/10 text-slate-100'
                  : 'border-slate-800 bg-slate-900/50 text-slate-300 hover:border-slate-600'
              }`}
            >
              {o.text}
            </button>
          );
        })}
      </div>

      <p className="mt-6 text-sm text-slate-500">How sure are you?</p>
      <div className="mt-2 flex gap-2">
        {(
          [
            ['CONFIDENT', 'Know it'],
            ['GUESSING', 'Unsure'],
            ['SKIPPED', 'Skip'],
          ] as Array<[Confidence, string]>
        ).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setConfidence(value)}
            className={`px-4 py-2 rounded border text-sm ${
              current.confidence === value
                ? 'border-amber-400 text-amber-200 bg-amber-400/10'
                : 'border-slate-700 text-slate-400 hover:border-slate-500'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && <p className="mt-4 text-red-400">{error}</p>}

      <div className="mt-8 flex justify-between">
        <button
          onClick={() => setIndex((i) => Math.max(0, i - 1))}
          disabled={index === 0}
          className="text-slate-400 text-sm disabled:opacity-30 hover:text-slate-200"
        >
          ← Back
        </button>
        {isLast ? (
          <button
            onClick={() => void submit()}
            disabled={!canContinue || submitting}
            className="bg-amber-400 text-slate-950 px-6 py-2.5 rounded font-medium hover:bg-amber-300 disabled:opacity-40"
          >
            {submitting ? 'Submitting…' : 'See my results'}
          </button>
        ) : (
          <button
            onClick={() => canContinue && setIndex((i) => i + 1)}
            disabled={!canContinue}
            className="bg-amber-400 text-slate-950 px-6 py-2.5 rounded font-medium hover:bg-amber-300 disabled:opacity-40"
          >
            Next →
          </button>
        )}
      </div>

      <p className="mt-10 text-xs text-slate-600">
        Educational purpose only — this is not investment advice.
      </p>
    </div>
  );
}
