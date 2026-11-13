import type { JSX } from 'react';
import Link from 'next/link';
import type { DuelPerQuestion, DuelPerTopic, DuelResultResponse } from '../../lib/api';
import { ChartSvg, TREND_LABEL } from './chart-question';

/** Stored post-game result, shared by the play pages and the result page. */
export function DuelResultView({ result }: { result: DuelResultResponse }): JSX.Element {
  const headline =
    result.result === 'WIN' ? 'You won' : result.result === 'DRAW' ? 'Draw' : 'You lost';
  return (
    <div className="space-y-4">
      <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
        <h2 className="text-xl font-bold">
          {headline} — {result.score} points
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          {result.opponent.name} scored {result.opponent.score ?? '—'} points (
          {result.opponent.correct ?? '—'} correct).
        </p>
        <p className="mt-2 text-sm">
          {result.correct} correct · {result.wrong} wrong · {result.skipped} skipped ·{' '}
          {Math.round(result.accuracy * 100)}% accuracy · best streak {result.bestStreak}
        </p>
        <p className="mt-1 text-sm text-slate-400">
          Average answer time{' '}
          {result.avgTimeMs === null ? '—' : `${(result.avgTimeMs / 1000).toFixed(1)}s`} · fastest{' '}
          {result.fastestTimeMs === null ? '—' : `${(result.fastestTimeMs / 1000).toFixed(1)}s`} ·
          slowest{' '}
          {result.slowestTimeMs === null ? '—' : `${(result.slowestTimeMs / 1000).toFixed(1)}s`}
        </p>
        <p className="mt-2 text-sm">{result.ratingReason}</p>
        <p className="mt-1 text-sm text-slate-400">
          +{result.xp.awarded} XP · {result.xp.totalXp} total XP · level {result.xp.level}
          {result.xp.levelUp ? ' — level up!' : ''} · streak {result.xp.currentStreak}
        </p>
      </div>

      <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="font-medium">Per topic (weakest first)</h3>
        <ul className="mt-2 space-y-1 text-sm">
          {result.perTopic.map((t: DuelPerTopic) => (
            <li key={t.topic} className="flex justify-between">
              <span>{t.topic}</span>
              <span className="text-slate-400">
                {t.correct}/{t.total} · {Math.round(t.accuracy * 100)}%
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
        <h3 className="font-medium">Challenge a friend</h3>
        <p className="mt-1 text-sm text-slate-400">
          A rematch replays this duel type against the same opponent. A challenge is a new duel —
          pick any duel type and invite a player directly.
        </p>
        <Link
          href="/duels/challenge"
          className="mt-3 inline-block rounded bg-amber-400 px-4 py-2 font-medium text-slate-950 hover:bg-amber-300"
        >
          Challenge a friend to a new duel
        </Link>
      </div>

      <div className="space-y-3">
        <h3 className="font-medium">Your answers</h3>
        {result.perQuestion.map((q: DuelPerQuestion, i: number) => (
          <div key={q.questionId} className="rounded border border-slate-800 bg-slate-900/50 p-4">
            <p className="text-sm font-medium">
              {i + 1}. {q.stem}
            </p>
            <p className="mt-1 text-sm">
              {q.skipped ? (
                <span className="text-slate-400">Skipped — no answer.</span>
              ) : q.correct ? (
                <span className="text-emerald-300">
                  Correct — {q.selectedOptionText} (+{q.points} points)
                </span>
              ) : q.points > 0 ? (
                // Case Duel: a second-best action is not the best action,
                // but it still pays (50 + speed). Say so plainly.
                <span className="text-amber-300">
                  Not the best action — you picked &ldquo;{q.selectedOptionText}&rdquo; (+
                  {q.points} points). Best action: &ldquo;{q.correctOptionText}&rdquo;
                </span>
              ) : (
                <span className="text-rose-300">
                  Wrong — you picked &ldquo;{q.selectedOptionText}&rdquo;. Correct answer: &ldquo;
                  {q.correctOptionText}&rdquo;
                </span>
              )}
            </p>
            {q.rubric && (
              <div className="mt-2 rounded border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Rubric</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4 text-sm text-slate-300">
                  {q.rubric
                    .split('\n')
                    .map((line: string) => line.trim())
                    .filter(Boolean)
                    .map((line: string, j: number) => (
                      <li key={j}>{line}</li>
                    ))}
                </ul>
              </div>
            )}
            {q.chart && (
              <div className="mt-2 rounded border border-slate-800 bg-slate-900/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Chart — {q.chart.title}
                </p>
                <div className="mt-1">
                  <ChartSvg chart={q.chart} annotation={q.annotation ?? null} />
                </div>
                {q.annotation && (
                  <p className="mt-1 rounded border border-amber-400/40 bg-amber-400/5 px-2 py-1 text-sm text-amber-200">
                    {TREND_LABEL[q.annotation.trend]}
                  </p>
                )}
              </div>
            )}
            <p className="mt-1 text-sm text-slate-400">{q.explanation}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
