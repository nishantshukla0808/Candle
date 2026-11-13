'use client';

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

/**
 * CASE_CHOICE question renderer (docs/08 §3.3, Phase 7 Stage 1).
 *
 * Renders by the question's `type` code only: it renders a question if
 * and only if `question.type === 'CASE_CHOICE'` — any other type shows
 * an error instead of guessing a layout. The Case Duel itself (Stage 2)
 * dispatches on `type` and hands CASE_CHOICE questions to this component.
 *
 * Predeclared UI (doc 08 §3.3), exactly:
 * - Case card at top with the numbers from `context` in a small table
 *   (income / goal / deadline) and the stem in 3–5 short lines.
 * - Options as action cards with a one-line consequence each.
 * - One tap selects (0.5 s confirm state, no separate Submit for the
 *   action), then an optional "Why did you pick this?" step with 3
 *   short reason chips (10 s extra for the reason step). The reason is
 *   recorded with the answer, is optional, and does NOT affect points.
 * - 45-second timer bar at top (display only — the server owns the
 *   deadline in a real duel).
 * - On reveal: best action highlighted green, chosen wrong action
 *   marked red, rubric shown line by line, explanation below.
 *
 * No host dialogue lives inside this component (doc 08 §2.2): Kabir
 * speaks before/after the duel only, never during a question. The
 * host line belongs on the duel page, outside this component.
 */

export interface CaseQuestionOptionView {
  id: string;
  text: string;
  order: number;
  consequence: string | null;
}

export interface CaseQuestionView {
  id: string;
  stem: string;
  options: CaseQuestionOptionView[];
  type: string;
  topic: string;
  skill: string;
  difficulty: number;
  context?: Record<string, string | number> | null;
}

/** What the server sends at reveal (never before): the best action, the
 *  rubric line by line, the explanation, and the player's own result. */
export interface CaseReveal {
  correctOptionId: string | null;
  correctOptionText?: string | null;
  rubric: string;
  explanation: string;
  myOptionId?: string | null;
  myPoints?: number;
  /** Plain-words points breakdown, e.g. "Best action +100, your action +50 — second-best". */
  pointsBreakdown?: string | null;
  /** The reason the player gave for this case (null when skipped). */
  myReason?: string | null;
}

/** The 3 short reason chips for "Why did you pick this?". The reason is
 *  recorded with the answer; it is optional and does NOT affect points. */
export const CASE_REASON_CHIPS = [
  'Safest for my goal',
  'Best long-term value',
  'Fits my budget',
] as const;

export type CaseReason = (typeof CASE_REASON_CHIPS)[number];

/** Seconds allowed per CASE_CHOICE question (doc 08 §3.3: 45 s). */
export const CASE_QUESTION_SECONDS = 45;

export function CaseQuestion({
  question,
  timeLimitMs = CASE_QUESTION_SECONDS * 1000,
  reveal = null,
  onAnswer,
  onActionPicked,
  onTimeout,
}: {
  question: CaseQuestionView;
  timeLimitMs?: number;
  reveal?: CaseReveal | null;
  /** Called once the player picks an action (and a reason, or skips it). */
  onAnswer: (optionId: string, reason: CaseReason | null) => void;
  /**
   * Called as soon as the action is picked (after the 0.5 s confirm),
   * BEFORE the reason step. A live duel page uses this to send the
   * action to the server immediately — the action is graded on the
   * 45 s timer, so it must not wait for the player to choose a reason.
   * The reason then travels separately (see `onAnswer`). Optional:
   * the format test page does not need it.
   */
  onActionPicked?: (optionId: string) => void;
  onTimeout?: () => void;
}): JSX.Element {
  const [selected, setSelected] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [reasonStep, setReasonStep] = useState(false);
  const [deadlineMs, setDeadlineMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [timedOut, setTimedOut] = useState(false);
  const confirmTimerRef = useRef<number | null>(null);
  const answeredRef = useRef(false);

  // Display-only countdown; the server owns the deadline in a real duel.
  useEffect(() => {
    setDeadlineMs(Date.now() + timeLimitMs);
    setSelected('');
    setConfirming(false);
    setReasonStep(false);
    setTimedOut(false);
    answeredRef.current = false;
  }, [question.id, timeLimitMs]);

  useEffect(() => {
    if (!deadlineMs || reveal) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [deadlineMs, reveal]);

  useEffect(() => {
    if (!deadlineMs || reveal || timedOut || answeredRef.current) return;
    if (nowMs >= deadlineMs) {
      setTimedOut(true);
      onTimeout?.();
    }
  }, [nowMs, deadlineMs, reveal, timedOut, onTimeout]);

  useEffect(
    () => () => {
      if (confirmTimerRef.current) window.clearTimeout(confirmTimerRef.current);
    },
    []
  );

  if (question.type !== 'CASE_CHOICE') {
    return (
      <p className="rounded border border-rose-400/40 bg-rose-400/5 p-3 text-sm text-rose-200">
        This question is not a case ({question.type}) — the case renderer cannot show it.
      </p>
    );
  }

  const secondsLeft = deadlineMs ? Math.max(0, (deadlineMs - nowMs) / 1000) : timeLimitMs / 1000;
  const timePct = Math.max(0, Math.min(100, (secondsLeft / (timeLimitMs / 1000)) * 100));
  const stemLines = question.stem
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const contextEntries = Object.entries(question.context ?? {}).filter(
    ([k, v]) => k.trim().length > 0 && v !== null && v !== undefined && String(v).trim().length > 0
  );
  const rubricLines = (reveal?.rubric ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  function pick(optionId: string): void {
    if (selected || reveal || timedOut) return;
    setSelected(optionId);
    setConfirming(true);
    confirmTimerRef.current = window.setTimeout(() => {
      setConfirming(false);
      setReasonStep(true);
      // The reason step gets 10 s extra (doc 08 §3.3): the player
      // picked an action in time and must not lose the answer while
      // choosing an optional reason.
      setDeadlineMs((d) => d + 10_000);
      // The action itself is sent now (live duel): it is graded on
      // the 45 s timer and must not wait for the reason step.
      onActionPicked?.(optionId);
    }, 500);
  }

  function answer(reason: CaseReason | null): void {
    if (answeredRef.current || !selected) return;
    answeredRef.current = true;
    setReasonStep(false);
    onAnswer(selected, reason);
  }

  return (
    <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex justify-between text-sm text-slate-400">
        <span>Case · {question.topic}</span>
        <span>{reveal ? 'Revealed' : `${secondsLeft.toFixed(1)}s left`}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-800">
        <div
          className="h-full bg-amber-400 transition-[width] duration-100"
          style={{ width: `${timePct}%` }}
        />
      </div>

      <div className="mt-4 rounded border border-slate-700 bg-slate-900 p-3">
        {stemLines.map((line, i) => (
          <p key={i} className={i === 0 ? 'font-medium' : 'mt-1 text-sm text-slate-300'}>
            {line}
          </p>
        ))}
        {contextEntries.length > 0 && (
          <table className="mt-3 w-full text-sm">
            <tbody>
              {contextEntries.map(([label, value]) => (
                <tr key={label} className="border-t border-slate-800">
                  <td className="py-1 pr-2 text-slate-400">{label}</td>
                  <td className="py-1 text-right font-medium">{String(value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {timedOut && !reveal && (
        <p className="mt-4 rounded border border-amber-400/40 bg-amber-400/5 p-3 text-sm text-amber-200">
          Time ran out — no action was picked for this case.
        </p>
      )}

      <div className="mt-4 space-y-2">
        {question.options.map((opt) => {
          const isBest = reveal?.correctOptionId === opt.id;
          const isMineWrong = reveal && selected === opt.id && !isBest;
          const isSelected = selected === opt.id;
          if (reveal) {
            return (
              <div
                key={opt.id}
                className={`rounded border px-3 py-2 text-left ${
                  isBest
                    ? 'border-emerald-400 bg-emerald-400/15'
                    : isMineWrong
                      ? 'border-rose-400 bg-rose-400/10 line-through'
                      : 'border-slate-700 bg-slate-900 opacity-60'
                }`}
              >
                <p className="font-medium">{opt.text}</p>
                <p className="mt-0.5 text-sm text-slate-400">{opt.consequence}</p>
                {isBest && <p className="mt-1 text-sm font-medium text-emerald-300">Best action</p>}
                {isMineWrong && <p className="mt-1 text-sm text-rose-300">Your pick</p>}
              </div>
            );
          }
          return (
            <button
              key={opt.id}
              onClick={() => pick(opt.id)}
              disabled={Boolean(selected) || timedOut}
              className={`w-full rounded border px-3 py-2 text-left disabled:opacity-60 ${
                isSelected
                  ? 'border-amber-400 bg-amber-400/10 ring-2 ring-amber-300'
                  : 'border-slate-700 bg-slate-900 hover:border-amber-400'
              }`}
            >
              <span className="font-medium">{opt.text}</span>
              <span className="mt-0.5 block text-sm text-slate-400">{opt.consequence}</span>
              {isSelected && confirming && (
                <span className="mt-1 block text-sm text-amber-300">Confirming…</span>
              )}
            </button>
          );
        })}
      </div>

      {!reveal && reasonStep && selected && (
        <div className="mt-4 rounded border border-slate-700 bg-slate-900 p-3">
          <p className="text-sm font-medium">Why did you pick this?</p>
          <p className="mt-0.5 text-sm text-slate-400">
            Optional — your reason is recorded with the answer and does not affect points.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {CASE_REASON_CHIPS.map((chip) => (
              <button
                key={chip}
                onClick={() => answer(chip)}
                className="rounded-full border border-slate-600 px-3 py-1 text-sm hover:border-amber-400"
              >
                {chip}
              </button>
            ))}
            <button
              onClick={() => answer(null)}
              className="rounded-full border border-slate-700 px-3 py-1 text-sm text-slate-400 hover:border-amber-400"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {reveal && (
        <div className="mt-4">
          <p className="text-sm font-medium">
            {reveal.myOptionId
              ? reveal.myOptionId === reveal.correctOptionId
                ? `Best action — +${reveal.myPoints ?? 100} points.`
                : `Not the best action — +${reveal.myPoints ?? 0} points. See the rubric.`
              : 'No action picked.'}
          </p>
          {reveal.pointsBreakdown && (
            <p className="mt-1 text-sm text-slate-400">{reveal.pointsBreakdown}</p>
          )}
          {reveal.myReason && (
            <p className="mt-1 text-sm text-slate-400">Your reason: {reveal.myReason}</p>
          )}
          <ul className="mt-2 space-y-1">
            {rubricLines.map((line, i) => (
              <li
                key={i}
                className="rounded border border-slate-800 bg-slate-900/50 p-2 text-sm text-slate-300"
              >
                {line}
              </li>
            ))}
          </ul>
          <p className="mt-3 rounded border border-slate-800 bg-slate-900/50 p-3 text-sm text-slate-300">
            {reveal.explanation}
          </p>
        </div>
      )}
    </div>
  );
}
