'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { JSX } from 'react';
import {
  CaseQuestion,
  type CaseQuestionView,
  type CaseReason,
  type CaseReveal,
} from '../case-question';
import { DuelsDisclaimer } from '../disclaimer';

/**
 * CASE_CHOICE format test page (docs/08 §3.3, Phase 7 Stage 1).
 *
 * This is NOT a duel — it is the format preview for the CASE_CHOICE
 * renderer, so the Case Duel (Stage 2) can be built on a renderer that
 * already works. It shows one real seed item (qb-521) through the
 * `CaseQuestion` component, with buttons to simulate the reveal and
 * to reset. Kabir hosts the Case Duel (doc 08 §2.2): his line sits
 * here, outside the question component — he never speaks during a
 * question.
 */

const SAMPLE_QUESTION: CaseQuestionView = {
  id: 'qb-521',
  stem: 'Asha earns ₹45,000 a month and spends ₹25,000.\nShe has ₹20,000 saved and wants a ₹1,50,000 emergency fund.\nHer deadline is 6 months from now.\nShe has no debt and no other savings.',
  options: [
    {
      id: 'qb-521-opt-0',
      text: 'Save ₹22,000 a month in a separate savings account and cut one small habit',
      order: 0,
      consequence: 'Fund is ready in 6 months, with a small buffer.',
    },
    {
      id: 'qb-521-opt-1',
      text: 'Save ₹15,000 a month and use a credit card for surprises',
      order: 1,
      consequence: 'Fund falls short, and card debt adds stress.',
    },
    {
      id: 'qb-521-opt-2',
      text: 'Wait until a bonus comes, then save everything at once',
      order: 2,
      consequence: 'No fund for 6 months — one surprise breaks the plan.',
    },
    {
      id: 'qb-521-opt-3',
      text: 'Put the ₹20,000 in a 5-year lock-in deposit',
      order: 3,
      consequence: 'Money is locked away when an emergency hits.',
    },
  ],
  type: 'CASE_CHOICE',
  topic: 'money-basics',
  skill: 'JUDGEMENT',
  difficulty: 2,
  context: {
    'Monthly income': '₹45,000',
    'Monthly spending': '₹25,000',
    'Saved so far': '₹20,000',
    Goal: '₹1,50,000 in 6 months',
  },
};

const SAMPLE_REVEAL: CaseReveal = {
  correctOptionId: 'qb-521-opt-0',
  correctOptionText: 'Save ₹22,000 a month in a separate savings account and cut one small habit',
  rubric:
    'Best — saving ₹22,000 a month reaches ₹1,50,000 in 6 months with a small buffer, and the money stays reachable.\nSecond-best — saving ₹15,000 a month is a good habit, but the fund falls short and a credit card fills the gap at high cost.\nWeak — waiting for a bonus leaves no fund for 6 months, and locking the money away for 5 years hides it when an emergency hits.',
  explanation:
    'An emergency fund must be reachable and built on time. Saving a fixed amount each month in a separate account is the only option that does both.',
};

export default function CaseFormatTestPage(): JSX.Element {
  const [reveal, setReveal] = useState<CaseReveal | null>(null);
  const [picked, setPicked] = useState<{ optionId: string; reason: CaseReason | null } | null>(
    null
  );
  const [round, setRound] = useState(0);

  function onAnswer(optionId: string, reason: CaseReason | null): void {
    setPicked({ optionId, reason });
  }

  function showReveal(): void {
    if (!picked) return;
    // Points are the CASE_CHOICE scale (doc 08 §3.3): best 100,
    // second-best 50, the rest 0. The public question view never carries
    // points, so this preview maps them from the known seed item.
    const points =
      picked.optionId === SAMPLE_REVEAL.correctOptionId
        ? 100
        : picked.optionId === 'qb-521-opt-1'
          ? 50
          : 0;
    setReveal({ ...SAMPLE_REVEAL, myOptionId: picked.optionId, myPoints: points });
  }

  function reset(): void {
    setReveal(null);
    setPicked(null);
    setRound((r) => r + 1);
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-bold">Case format preview</h1>
      <p className="mt-2 text-sm text-slate-400">
        CASE_CHOICE format test page — not a duel. One seed case (qb-521) rendered by the
        CASE_CHOICE renderer. Pick an action, optionally give a reason, then reveal the best action.
        The reason is recorded with the answer and does not affect points.
      </p>
      <p className="mt-3 rounded border border-slate-800 bg-slate-900/50 p-3 text-sm">
        <span className="font-medium text-amber-300">Kabir · </span>
        One real-life case, four actions. Pick the best one — you have 45 seconds to think it
        through.
      </p>

      <div className="mt-6">
        <CaseQuestion
          key={`${SAMPLE_QUESTION.id}-${round}`}
          question={SAMPLE_QUESTION}
          reveal={reveal}
          onAnswer={onAnswer}
        />
      </div>

      {picked && !reveal && (
        <div className="mt-4 rounded border border-slate-800 bg-slate-900/50 p-3 text-sm">
          <p>
            Answer recorded: <span className="font-medium">{picked.optionId}</span>
            {picked.reason ? (
              <>
                {' '}
                — reason: <span className="font-medium">{picked.reason}</span>
              </>
            ) : (
              ' — no reason given (optional).'
            )}
          </p>
          <p className="mt-1 text-slate-400">
            The reason does not affect points — the best action is worth 100, the second-best 50,
            the rest 0.
          </p>
          <button
            onClick={showReveal}
            className="mt-3 rounded bg-amber-400 px-5 py-2 font-medium text-slate-950 hover:bg-amber-300"
          >
            Reveal the best action
          </button>
        </div>
      )}

      {reveal && (
        <button
          onClick={reset}
          className="mt-4 rounded border border-slate-700 px-5 py-2 text-sm text-slate-300 hover:bg-slate-800"
        >
          Try the case again
        </button>
      )}

      <Link href="/duels" className="mt-4 inline-block text-sm text-slate-400 underline">
        Back to duels
      </Link>
      <DuelsDisclaimer />
    </main>
  );
}
