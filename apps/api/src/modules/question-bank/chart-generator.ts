import { CHART_SERIES_LENGTH, CHART_TEMPLATES, type ChartTemplateKey } from '@candle/shared';

/** Re-exported so the seed file can type its chart templates (Phase 8 Stage 1). */
export type { ChartTemplateKey };

/**
 * Seeded chart generator — docs/08 §3.4, Phase 8 Stage 1.
 *
 * Pure, deterministic, replayable: the same (seed, template,
 * instrument) always produces the same chart, so any bank item can be
 * re-derived from its key and any duel can be re-simulated from its
 * stored seed. The RNG is mulberry32 (the same small seeded generator
 * the question-bank template engine and the bot simulation use),
 * keyed by an FNV-1a hash of the seed string.
 *
 * Chart data is STRUCTURED, never an image: { title, instrument,
 * template, xLabel, yLabel, xLabels, series, annotation }. The web
 * renderer draws the line from `series` + `xLabels`, so the chart is
 * accessible and identical for both players. All instruments are
 * fictional — invented names passed in by the caller; no real tickers.
 *
 * ## Templates (all series are CHART_SERIES_LENGTH = 6 points)
 *
 * | Template             | Shape                                                  | Annotation trend / zone              |
 * | -------------------- | ------------------------------------------------------ | ------------------------------------ |
 * | STEADY_RISE          | climbs most steps, ends clearly above the start        | rising, whole series (0–5)           |
 * | VOLATILE_FLAT        | swings up and down, ends near where it started         | volatile, min→max swing              |
 * | SHARP_FALL_RECOVERY  | falls sharply, then climbs back part-way               | volatile, the sharp fall (0–2)       |
 * | STEADY_FALL          | drops most steps, ends clearly below the start         | falling, whole series (0–5)          |
 * | SPIKE_THEN_FALL      | jumps to a peak mid-series, then falls below the start | volatile, peak ± 1                   |
 *
 * The annotation is REVEAL-ONLY data: it highlights the trend line /
 * risk zone on the chart after answering. The public question view
 * carries the chart WITHOUT the annotation (question-bank.service.ts).
 */

/** FNV-1a 32-bit hash — turns a seed string into a mulberry32 seed. */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small seeded RNG (mulberry32). Same seed ⇒ same sequence. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The trend a chart shows — what the reveal annotation highlights. */
export type ChartTrend = 'rising' | 'falling' | 'flat' | 'volatile';

/**
 * Reveal-only annotation: the trend direction plus the zone (inclusive
 * point indices) the renderer highlights on reveal. The zone is the
 * part of the chart the question is about — the whole trend for a
 * steady rise/fall, the sharp fall for a recovery, the peak for a
 * spike. Never sent before reveal.
 */
export interface ChartAnnotation {
  trend: ChartTrend;
  /** First point of the highlighted zone (0-based, 0..5). */
  zoneStart: number;
  /** Last point of the highlighted zone (0-based, zoneStart..5). */
  zoneEnd: number;
}

export interface ChartData {
  /** Chart title, e.g. "Meadow Foods — price over 6 months". */
  title: string;
  /** Fictional instrument name, e.g. "Meadow Foods". Never a real ticker. */
  instrument: string;
  template: ChartTemplateKey;
  /** X-axis label, e.g. "Month". */
  xLabel: string;
  /** Y-axis label, e.g. "Price (₹)". */
  yLabel: string;
  /** One label per series point (length = CHART_SERIES_LENGTH). */
  xLabels: string[];
  /** The values, one per xLabel (length = CHART_SERIES_LENGTH). */
  series: number[];
  /** Reveal-only: trend + highlighted zone. */
  annotation: ChartAnnotation;
}

/** The public chart shape: everything except the reveal-only annotation. */
export type PublicChartData = Omit<ChartData, 'annotation'>;

export const DEFAULT_CHART_X_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'] as const;

export interface GenerateChartOptions {
  /** Starting value in ₹ (default: 80–139, drawn from the seed). */
  start?: number;
  /** X-axis point labels (default: Jan..Jun). */
  xLabels?: string[];
  /** Chart title (default: "<instrument> — price over 6 months"). */
  title?: string;
  /** X-axis label (default: "Month"). */
  xLabel?: string;
  /** Y-axis label (default: "Price (₹)"). */
  yLabel?: string;
}

function roundRupee(n: number): number {
  return Math.max(10, Math.round(n));
}

function indexOfMin(values: number[]): number {
  let idx = 0;
  for (let i = 1; i < values.length; i++) {
    if ((values[i] as number) < (values[idx] as number)) idx = i;
  }
  return idx;
}

function indexOfMax(values: number[]): number {
  let idx = 0;
  for (let i = 1; i < values.length; i++) {
    if ((values[i] as number) > (values[idx] as number)) idx = i;
  }
  return idx;
}

/**
 * Builds one series per template. Every step is a percentage move off
 * the running value, so the shape holds at any starting value — and
 * every template's shape promise (see the table above) holds for every
 * seed, which the unit tests pin by sweeping seeds.
 */
function buildSeries(template: ChartTemplateKey, start: number, rng: () => number): number[] {
  const points = CHART_SERIES_LENGTH;
  const series: number[] = [roundRupee(start)];
  const step = (pct: number): void => {
    const prev = series[series.length - 1] as number;
    series.push(roundRupee(prev * (1 + pct / 100)));
  };
  // A percentage in [min, max), drawn from the seed.
  const pct = (min: number, max: number): number => min + rng() * (max - min);

  if (template === 'STEADY_RISE') {
    // Every step up 2–6%: ends clearly above the start.
    for (let i = 1; i < points; i++) step(pct(2, 6));
    return series;
  }
  if (template === 'STEADY_FALL') {
    // Every step down 2–6%: ends clearly below the start.
    for (let i = 1; i < points; i++) step(-pct(2, 6));
    return series;
  }
  if (template === 'VOLATILE_FLAT') {
    // Four alternating swings (4–9%), then a landing step that puts the
    // final value within ±5% of the start: volatile, but flat overall.
    const signs = [1, -1, 1, -1];
    for (const sign of signs) step(sign * pct(4, 9));
    const last = roundRupee(start * (1 + (rng() - 0.5) * 0.08));
    series.push(last);
    return series;
  }
  if (template === 'SHARP_FALL_RECOVERY') {
    // Three falling steps (total 18–28% down), then two rising steps
    // that win back 40–70% of the drop: the trough is point 3, the
    // end is above the trough but still below the start.
    const trough = start * (1 - pct(18, 28) / 100);
    const dropPerStep = (start - trough) / 3;
    for (let i = 1; i <= 3; i++) {
      series.push(roundRupee(start - dropPerStep * i));
    }
    const recovered = trough + ((start - trough) * pct(40, 70)) / 100;
    const risePerStep = (recovered - trough) / 2;
    series.push(roundRupee(trough + risePerStep));
    series.push(roundRupee(recovered));
    return series;
  }
  // SPIKE_THEN_FALL: rise 2–3 steps (+5–9% each) to a peak, then fall
  // steps that together drop more than the rise: the peak is mid-series
  // and the end is below the start.
  const peakIndex = rng() < 0.5 ? 2 : 3;
  let peak = start;
  for (let i = 1; i <= peakIndex; i++) {
    peak = peak * (1 + pct(5, 9) / 100);
    series.push(roundRupee(peak));
  }
  const totalFallPct = ((peak - start) / start) * 100 + pct(5, 15);
  const fallSteps = points - 1 - peakIndex;
  const fallPerStep = totalFallPct / fallSteps;
  for (let i = 1; i <= fallSteps; i++) {
    const prev = series[series.length - 1] as number;
    // Jitter each fall step (±20% of its size) but keep every step down.
    const thisFall = fallPerStep * (0.8 + rng() * 0.4);
    series.push(roundRupee(prev * (1 - thisFall / 100)));
  }
  return series;
}

function buildAnnotation(template: ChartTemplateKey, series: number[]): ChartAnnotation {
  if (template === 'STEADY_RISE') return { trend: 'rising', zoneStart: 0, zoneEnd: 5 };
  if (template === 'STEADY_FALL') return { trend: 'falling', zoneStart: 0, zoneEnd: 5 };
  if (template === 'SHARP_FALL_RECOVERY') return { trend: 'volatile', zoneStart: 0, zoneEnd: 2 };
  if (template === 'SPIKE_THEN_FALL') {
    const peak = indexOfMax(series);
    return {
      trend: 'volatile',
      zoneStart: Math.max(0, peak - 1),
      zoneEnd: Math.min(5, peak + 1),
    };
  }
  // VOLATILE_FLAT: highlight the swing, from the lowest to the highest point.
  const lo = indexOfMin(series);
  const hi = indexOfMax(series);
  return { trend: 'volatile', zoneStart: Math.min(lo, hi), zoneEnd: Math.max(lo, hi) };
}

/**
 * Generates one chart from a seed string + template + fictional
 * instrument. Deterministic: the same arguments always return the
 * same chart (deep-equal). Throws on an unknown template or a
 * non-positive start value.
 */
export function generateChart(
  seed: string,
  template: ChartTemplateKey,
  instrument: string,
  opts: GenerateChartOptions = {}
): ChartData {
  if (!(CHART_TEMPLATES as readonly string[]).includes(template)) {
    throw new Error(`Unknown chart template "${template}".`);
  }
  if (!instrument || instrument.trim().length === 0) {
    throw new Error('A chart needs a fictional instrument name.');
  }
  const rng = mulberry32(hashSeed(seed));
  const start = opts.start ?? 80 + Math.floor(rng() * 60);
  if (!Number.isFinite(start) || start <= 0) {
    throw new Error('Chart start value must be a positive number.');
  }
  const series = buildSeries(template, start, rng);
  return {
    title: opts.title ?? `${instrument} — price over 6 months`,
    instrument,
    template,
    xLabel: opts.xLabel ?? 'Month',
    yLabel: opts.yLabel ?? 'Price (₹)',
    xLabels: [...(opts.xLabels ?? DEFAULT_CHART_X_LABELS)],
    series,
    annotation: buildAnnotation(template, series),
  };
}
