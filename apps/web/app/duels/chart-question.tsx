'use client';

import { useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';

/**
 * CHART_CHOICE question renderer (docs/08 §3.4, Phase 8 Stage 1).
 *
 * Renders by the question's `type` code only: it renders a question if
 * and only if `question.type === 'CHART_CHOICE'` — any other type shows
 * an error instead of guessing a layout. The Chart Detective duel
 * itself (Stage 2) dispatches on `type` and hands CHART_CHOICE
 * questions to this component.
 *
 * Predeclared UI (doc 08 §3.4), exactly:
 * - Chart at top, full width, with a clear title and axis labels,
 *   drawn from the data (SVG line chart — never an image, no chart
 *   library, no network).
 * - Below it, the question in one line, then 4 option cards.
 * - One tap selects (0.5 s confirm state, no separate Submit button).
 * - 30-second timer bar at top (display only — the server owns the
 *   deadline in a real duel).
 * - On reveal: the chart is annotated (trend line / risk zone
 *   highlighted, from the `annotation` the server sends at reveal),
 *   correct interpretation in green, chosen wrong interpretation in
 *   red, explanation below.
 *
 * No host dialogue lives inside this component (doc 08 §2.2): Kabir
 * speaks before/after the duel only, never during a question. The
 * host line belongs on the duel page, outside this component.
 */

export interface ChartQuestionOptionView {
  id: string;
  text: string;
  order: number;
}

/** Public chart data: everything except the reveal-only annotation. */
export interface ChartQuestionChartView {
  title: string;
  instrument: string;
  template: string;
  xLabel: string;
  yLabel: string;
  xLabels: string[];
  series: number[];
}

export interface ChartQuestionView {
  id: string;
  stem: string;
  options: ChartQuestionOptionView[];
  type: string;
  topic: string;
  skill: string;
  difficulty: number;
  chart?: ChartQuestionChartView | null;
}

/** Reveal-only annotation: the trend + the zone the renderer highlights. */
export interface ChartAnnotationView {
  trend: 'rising' | 'falling' | 'flat' | 'volatile';
  zoneStart: number;
  zoneEnd: number;
}

/** What the server sends at reveal (never before): the correct
 *  interpretation, the explanation, and the chart annotation. */
export interface ChartReveal {
  correctOptionId: string | null;
  correctOptionText?: string | null;
  explanation: string;
  annotation?: ChartAnnotationView | null;
  myOptionId?: string | null;
}

/** Seconds allowed per CHART_CHOICE question (doc 08 §3.4: 30 s). */
export const CHART_QUESTION_SECONDS = 30;

const TREND_LABEL: Record<ChartAnnotationView['trend'], string> = {
  rising: 'Rising trend — the line climbs most of the way',
  falling: 'Falling trend — the line drops most of the way',
  flat: 'Flat overall — the line ends near where it started',
  volatile: 'Volatile — big swings up and down',
};

/** Plain-words trend label for a reveal annotation (shared with the result view). */
export { TREND_LABEL };

/**
 * SVG line chart drawn from the chart data (no image, no library).
 * Exported so the shared result view can draw the same annotated
 * chart from a stored per-question stat (Phase 8 Stage 2) instead
 * of duplicating the SVG.
 */
export function ChartSvg({
  chart,
  annotation,
}: {
  chart: ChartQuestionChartView;
  annotation?: ChartAnnotationView | null;
}): JSX.Element {
  const width = 600;
  const height = 260;
  const padLeft = 48;
  const padRight = 12;
  const padTop = 16;
  const padBottom = 32;
  const series = chart.series;
  const n = series.length;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = Math.max(max - min, 1);
  const yMin = min - span * 0.15;
  const yMax = max + span * 0.15;
  const xAt = (i: number): number =>
    padLeft + (i / Math.max(n - 1, 1)) * (width - padLeft - padRight);
  const yAt = (v: number): number =>
    padTop + (1 - (v - yMin) / (yMax - yMin)) * (height - padTop - padBottom);
  const points = series.map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(' ');
  const area = `${padLeft},${height - padBottom} ${points} ${xAt(n - 1).toFixed(1)},${height - padBottom}`;
  const zone =
    annotation && n > 1
      ? {
          x: xAt(annotation.zoneStart),
          width: Math.max(xAt(annotation.zoneEnd) - xAt(annotation.zoneStart), 8),
        }
      : null;
  const yTicks = [min, (min + max) / 2, max];

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full"
      role="img"
      aria-label={`${chart.title}. Values from ${chart.xLabels[0] ?? ''} to ${chart.xLabels[n - 1] ?? ''}: ${series.join(', ')}.`}
    >
      {zone && (
        <rect
          x={zone.x - 8}
          y={padTop}
          width={zone.width + 16}
          height={height - padTop - padBottom}
          rx={6}
          className="fill-amber-400/10 stroke-amber-400/50"
          strokeDasharray="4 3"
        />
      )}
      {yTicks.map((t) => (
        <g key={t}>
          <line
            x1={padLeft}
            x2={width - padRight}
            y1={yAt(t)}
            y2={yAt(t)}
            className="stroke-slate-800"
          />
          <text
            x={padLeft - 6}
            y={yAt(t) + 4}
            textAnchor="end"
            className="fill-slate-400 text-[11px]"
          >
            ₹{Math.round(t).toLocaleString('en-IN')}
          </text>
        </g>
      ))}
      <polygon points={area} className="fill-amber-400/10" />
      <polyline points={points} fill="none" className="stroke-amber-400" strokeWidth={2.5} />
      {series.map((v, i) => (
        <circle key={i} cx={xAt(i)} cy={yAt(v)} r={4} className="fill-amber-400 stroke-slate-900" />
      ))}
      {chart.xLabels.map((label, i) => (
        <text
          key={label}
          x={xAt(i)}
          y={height - 10}
          textAnchor="middle"
          className="fill-slate-400 text-[11px]"
        >
          {label}
        </text>
      ))}
    </svg>
  );
}

export function ChartQuestion({
  question,
  timeLimitMs = CHART_QUESTION_SECONDS * 1000,
  reveal = null,
  onAnswer,
  onTimeout,
}: {
  question: ChartQuestionView;
  timeLimitMs?: number;
  reveal?: ChartReveal | null;
  /** Called once the player picks an interpretation (after the 0.5 s confirm). */
  onAnswer: (optionId: string) => void;
  onTimeout?: () => void;
}): JSX.Element {
  const [selected, setSelected] = useState('');
  const [confirming, setConfirming] = useState(false);
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

  if (question.type !== 'CHART_CHOICE') {
    return (
      <p className="rounded border border-rose-400/40 bg-rose-400/5 p-3 text-sm text-rose-200">
        This question is not a chart ({question.type}) — the chart renderer cannot show it.
      </p>
    );
  }

  const chart = question.chart;
  const secondsLeft = deadlineMs ? Math.max(0, (deadlineMs - nowMs) / 1000) : timeLimitMs / 1000;
  const timePct = Math.max(0, Math.min(100, (secondsLeft / (timeLimitMs / 1000)) * 100));

  function pick(optionId: string): void {
    if (selected || reveal || timedOut) return;
    setSelected(optionId);
    setConfirming(true);
    confirmTimerRef.current = window.setTimeout(() => {
      setConfirming(false);
      if (answeredRef.current) return;
      answeredRef.current = true;
      onAnswer(optionId);
    }, 500);
  }

  return (
    <div className="rounded border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex justify-between text-sm text-slate-400">
        <span>Chart · {question.topic}</span>
        <span>{reveal ? 'Revealed' : `${secondsLeft.toFixed(1)}s left`}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded bg-slate-800">
        <div
          className="h-full bg-amber-400 transition-[width] duration-100"
          style={{ width: `${timePct}%` }}
        />
      </div>

      {!chart ? (
        <p className="mt-4 rounded border border-rose-400/40 bg-rose-400/5 p-3 text-sm text-rose-200">
          This chart question has no chart data — it cannot be answered.
        </p>
      ) : (
        <div className="mt-4 rounded border border-slate-700 bg-slate-900 p-3">
          <p className="font-medium">{chart.title}</p>
          <p className="mt-0.5 text-sm text-slate-400">
            {chart.instrument} · {chart.yLabel} by {chart.xLabel.toLowerCase()}
          </p>
          <div className="mt-2">
            <ChartSvg chart={chart} annotation={reveal?.annotation ?? null} />
          </div>
          {reveal?.annotation && (
            <p className="mt-1 rounded border border-amber-400/40 bg-amber-400/5 px-2 py-1 text-sm text-amber-200">
              {TREND_LABEL[reveal.annotation.trend]}
            </p>
          )}
        </div>
      )}

      <p className="mt-4 font-medium">{question.stem}</p>

      {timedOut && !reveal && (
        <p className="mt-4 rounded border border-amber-400/40 bg-amber-400/5 p-3 text-sm text-amber-200">
          Time ran out — no interpretation was picked for this chart.
        </p>
      )}

      <div className="mt-4 space-y-2">
        {question.options.map((opt) => {
          const isCorrect = reveal?.correctOptionId === opt.id;
          const isMineWrong = reveal && selected === opt.id && !isCorrect;
          const isSelected = selected === opt.id;
          if (reveal) {
            return (
              <div
                key={opt.id}
                className={`rounded border px-3 py-2 text-left ${
                  isCorrect
                    ? 'border-emerald-400 bg-emerald-400/15'
                    : isMineWrong
                      ? 'border-rose-400 bg-rose-400/10 line-through'
                      : 'border-slate-700 bg-slate-900 opacity-60'
                }`}
              >
                <p className="font-medium">{opt.text}</p>
                {isCorrect && (
                  <p className="mt-1 text-sm font-medium text-emerald-300">Correct reading</p>
                )}
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
              {isSelected && confirming && (
                <span className="mt-1 block text-sm text-amber-300">Confirming…</span>
              )}
            </button>
          );
        })}
      </div>

      {reveal && (
        <div className="mt-4">
          <p className="text-sm font-medium">
            {reveal.myOptionId
              ? reveal.myOptionId === reveal.correctOptionId
                ? 'Correct — you read the chart right.'
                : 'Not the right reading — see the chart annotation.'
              : 'No interpretation picked.'}
          </p>
          <p className="mt-3 rounded border border-slate-800 bg-slate-900/50 p-3 text-sm text-slate-300">
            {reveal.explanation}
          </p>
        </div>
      )}
    </div>
  );
}
