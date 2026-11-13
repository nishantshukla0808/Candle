import { DUELS } from '@candle/shared';

/**
 * Duel scoring + post-game stats — docs/05 §1 L1/L2, docs/07 §4/§5
 * (pure, no I/O). Shared by Bot Duels, Daily Duels, and the bot
 * simulation, so a player and Mira are always scored by the same rule.
 *
 * ## Scoring (one rule, both sides)
 * Per question: 100 base per correct answer + a speed bonus of up to
 * 50: `speedBonus = floor(50 × (1 − timeMs / timeLimitMs))`, floored at 0.
 * A wrong answer scores 0 (no speed bonus for a wrong answer); a
 * skipped question scores 0. Worked examples (pinned in unit tests):
 * - correct in 0 ms → 150 points (100 + 50)
 * - correct in 7,500 ms → 125 points (100 + 25)
 * - correct in 15,000 ms → 100 points (100 + 0)
 * - wrong, any time → 0 points
 *
 * ## Blitz scoring (Phase 6, Myth vs Fact Blitz L2 — docs/05 §1 L2,
 * docs/08 §3.2)
 * Same base + speed bonus, scaled to the 10-second Blitz timer
 * (`floor(50 × (1 − timeMs / 10000))`), PLUS an in-duel streak bonus:
 * +10 per consecutive correct answer beyond the 2nd in the current
 * streak, capped at +30 per question — streak 3 → +10, streak 4 →
 * +20, streak 5 and beyond → +30. A wrong answer (or a skip) resets
 * the current streak to 0, so the next correct answer starts a new
 * streak at 1 (no bonus). Worked examples (pinned in unit tests):
 * - correct in 0 ms, streak 1 → 150 points (100 + 50 + 0)
 * - correct in 5,000 ms, streak 3 → 135 points (100 + 25 + 10)
 * - correct in 10,000 ms, streak 5 → 130 points (100 + 0 + 30)
 * - correct in 0 ms, streak 9 → 180 points (100 + 50 + 30, capped)
 * - wrong, any streak → 0 points, streak resets to 0
 * Speed Quiz (L1) scoring is unchanged — it never takes a streak bonus.
 *
 * ## Case scoring (Phase 7, Case Duel L3 — docs/05 §1 L3,
 * docs/08 §3.3, ADR 0009 §3)
 * Per case: the stored per-option points (best action 100,
 * second-best 50, other 0 — enforced at the bank, exactly one 100
 * and at most one 50 per item) PLUS a speed bonus of up to 20:
 * `speedBonus = floor(20 × (1 − timeMs / 45000))`, floored at 0.
 * A harmful / other action scores 0 (no speed bonus for a 0-point
 * action); a skipped case scores 0. The reason chips are NEVER
 * scored — they are recorded with the answer only. Worked examples
 * (pinned in unit tests):
 * - best action in 0 ms → 120 points (100 + 20)
 * - best action in 22,500 ms → 110 points (100 + 10)
 * - second-best in 0 ms → 70 points (50 + 20)
 * - second-best in 45,000 ms → 50 points (50 + 0)
 * - harmful action, any time → 0 points
 *
 * ## Chart scoring (Phase 8, Chart Detective L4 — docs/05 §1 L4,
 * docs/08 §3.4, ADR 0010 §5)
 * Same as MCQ_4: 100 base + a speed bonus of up to 50 on the 30-second
 * timer (`floor(50 × (1 − timeMs / 30000))`). A wrong chart read is a
 * wrong answer — NO partial credit, because the chart is the question,
 * and CHART options carry no per-option points (the bank forbids them).
 * The winner is decided by `decideWinner` (correct count first, then
 * total time) — the same as Speed Quiz and Blitz. Worked examples
 * (pinned in unit tests):
 * - correct in 0 ms → 150 points (100 + 50)
 * - correct in 15,000 ms → 125 points (100 + 25)
 * - correct in 30,000 ms → 100 points (100 + 0)
 * - wrong, any time → 0 points
 *
 * ## Winner (docs/04 §5 — correct answers first, then total time)
 * More correct answers wins. On equal correct counts, the lower total
 * answer time wins (total = sum of timeMs over answered questions;
 * skipped questions contribute no time). Equal on both ⇒ draw.
 *
 * ## Case winner (ADR 0009 §3 — points first, then total time)
 * A Case Duel is won on POINTS, not on best-action count: a player
 * who picks the second-best action five times (250+ points) beats a
 * player who picks the best action twice and harmful actions three
 * times (200+ points), even though the second player has more
 * "correct" answers. `decideWinnerByPoints` implements this: more
 * points wins, then lower total answer time, else draw. Speed Quiz
 * and Blitz keep `decideWinner` (correct first) — only CASE uses
 * points first.
 */

export type DuelOutcome = 'WIN' | 'DRAW' | 'LOSS';

/** Points for one answered question (see the scoring rule above). */
export function pointsForAnswer(
  correct: boolean,
  timeMs: number | null,
  timeLimitMs: number = DUELS.QUESTION_TIME_LIMIT_MS
): number {
  if (!correct || timeMs === null) return 0;
  const speedBonus = Math.max(0, Math.floor(50 * (1 - timeMs / timeLimitMs)));
  return 100 + speedBonus;
}

/**
 * Blitz streak bonus for the streak AFTER this answer (streak counts
 * consecutive correct answers, including this one). Streaks 1–2 pay
 * nothing; streak 3 pays +10, streak 4 pays +20, streak 5+ pays the
 * +30 cap. A wrong answer resets the streak, so it never pays a bonus.
 */
export function blitzStreakBonus(streakAfter: number): number {
  if (streakAfter < 3) return 0;
  return Math.min(DUELS.BLITZ_STREAK_BONUS_CAP, (streakAfter - 2) * DUELS.BLITZ_STREAK_BONUS_STEP);
}

/**
 * Points for one Blitz answer: base + speed bonus on the 10-second
 * timer, plus the streak bonus for the streak after this answer.
 * Wrong or skipped answers score 0 (and reset the streak — the engine
 * tracks that, this function only prices the answer it is given).
 */
export function pointsForBlitzAnswer(
  correct: boolean,
  timeMs: number | null,
  streakAfter: number
): number {
  if (!correct || timeMs === null) return 0;
  return (
    pointsForAnswer(correct, timeMs, DUELS.BLITZ_QUESTION_TIME_LIMIT_MS) +
    blitzStreakBonus(streakAfter)
  );
}

/**
 * Points for one Case answer: the stored per-option points (100 best /
 * 50 second-best / 0 other) plus the capped speed bonus on the 45 s
 * timer. A 0-point action pays no speed bonus; a skipped answer
 * (timeMs null) scores 0. The reason is never priced here — it is
 * recorded with the answer only (ADR 0009 §3/§4).
 */
export function pointsForCaseAnswer(
  optionPoints: number,
  timeMs: number | null,
  timeLimitMs: number = DUELS.CASE_QUESTION_TIME_LIMIT_MS
): number {
  if (optionPoints <= 0 || timeMs === null) return 0;
  const speedBonus = Math.max(
    0,
    Math.floor(DUELS.CASE_SPEED_BONUS_MAX * (1 - timeMs / timeLimitMs))
  );
  return optionPoints + speedBonus;
}

/** Mirror a result to the other side of a duel. */
export function mirrorOutcome(result: DuelOutcome): DuelOutcome {
  return result === 'WIN' ? 'LOSS' : result === 'LOSS' ? 'WIN' : 'DRAW';
}

export interface DuelSideScore {
  correct: number;
  totalTimeMs: number;
}

/** Winner from the first side's perspective (correct, then time). */
export function decideWinner(a: DuelSideScore, b: DuelSideScore): DuelOutcome {
  if (a.correct !== b.correct) return a.correct > b.correct ? 'WIN' : 'LOSS';
  if (a.totalTimeMs !== b.totalTimeMs) return a.totalTimeMs < b.totalTimeMs ? 'WIN' : 'LOSS';
  return 'DRAW';
}

export interface DuelSidePoints {
  score: number;
  totalTimeMs: number;
}

/**
 * Case Duel winner from the first side's perspective (ADR 0009 §3):
 * more POINTS wins first (a second-best action still scores), then
 * lower total answer time, else draw. Only CASE uses this — Speed
 * Quiz and Blitz keep `decideWinner` (correct answers first).
 */
export function decideWinnerByPoints(a: DuelSidePoints, b: DuelSidePoints): DuelOutcome {
  if (a.score !== b.score) return a.score > b.score ? 'WIN' : 'LOSS';
  if (a.totalTimeMs !== b.totalTimeMs) return a.totalTimeMs < b.totalTimeMs ? 'WIN' : 'LOSS';
  return 'DRAW';
}

// --- post-game stats -----------------------------------------------------------

export interface GradedAnswerInput {
  questionId: string;
  optionId: string | null;
  skipped: boolean;
  correct: boolean;
  timeMs: number | null;
  points: number;
}

export interface BankItemMeta {
  id: string;
  topic: string;
  skill: string;
  difficulty: number;
  stem: string;
  explanation: string;
  options: Array<{ id: string; text: string; isCorrect: boolean }>;
  /** CASE_CHOICE only: the rubric, shown line by line on the result screen. */
  rubric?: string | null;
  /** CHART_CHOICE only: the full chart data (public part + reveal-only
   * annotation). `buildGameStats` splits it: the public chart and the
   * annotation ride separately into the stored per-question stat, so
   * the result screen can draw the annotated chart (ADR 0010 §5). */
  chart?: ChartStatWithAnnotation | null;
}

/** Reveal-only chart annotation, as stored on a per-question stat. */
export interface ChartAnnotationStat {
  trend: 'rising' | 'falling' | 'flat' | 'volatile';
  zoneStart: number;
  zoneEnd: number;
}

/** Public chart data (everything except the annotation), as stored. */
export interface ChartStat {
  title: string;
  instrument: string;
  template: string;
  xLabel: string;
  yLabel: string;
  xLabels: string[];
  series: number[];
}

/** A bank item's full chart: the public chart plus its annotation. */
export type ChartStatWithAnnotation = ChartStat & { annotation?: ChartAnnotationStat | null };

export interface PerTopicStat {
  topic: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface PerQuestionStat {
  questionId: string;
  stem: string;
  topic: string;
  skill: string;
  difficulty: number;
  selectedOptionId: string | null;
  selectedOptionText: string | null;
  correctOptionId: string;
  correctOptionText: string;
  correct: boolean;
  skipped: boolean;
  timeMs: number | null;
  points: number;
  explanation: string;
  /** CASE_CHOICE only: the rubric (null for other formats). */
  rubric?: string | null;
  /** CHART_CHOICE only: the chart (public part, no annotation) so the
   * result screen can draw it. Null for other formats. */
  chart?: ChartStat | null;
  /** CHART_CHOICE only: the reveal annotation (trend + highlighted
   * zone). Null for other formats, or when the item has no chart. */
  annotation?: ChartAnnotationStat | null;
}

export interface GameStats {
  score: number;
  correct: number;
  wrong: number;
  skipped: number;
  accuracy: number;
  avgTimeMs: number | null;
  fastestTimeMs: number | null;
  slowestTimeMs: number | null;
  bestStreak: number;
  totalTimeMs: number;
  perTopic: PerTopicStat[];
  perQuestion: PerQuestionStat[];
}

/**
 * Builds the stored post-game stats for one player from their graded
 * answers (in duel order) and the bank items (same order). Stored at
 * duel end; the result page reads the stored row, never recomputes.
 * perTopic is worst-accuracy-first (ties broken by topic name, so the
 * order is deterministic).
 */
export function buildGameStats(answers: GradedAnswerInput[], items: BankItemMeta[]): GameStats {
  const byId = new Map(items.map((i) => [i.id, i]));
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  let bestStreak = 0;
  let run = 0;
  let totalTimeMs = 0;
  const times: number[] = [];
  const topicAgg = new Map<string, { correct: number; total: number }>();
  const perQuestion: PerQuestionStat[] = [];

  for (const a of answers) {
    const item = byId.get(a.questionId);
    if (!item) throw new Error(`buildGameStats: unknown question ${a.questionId}.`);
    const correctOption = item.options.find((o) => o.isCorrect);
    if (!correctOption)
      throw new Error(`buildGameStats: question ${a.questionId} has no correct option.`);
    const selected = a.optionId ? (item.options.find((o) => o.id === a.optionId) ?? null) : null;
    if (a.skipped) {
      skipped += 1;
      run = 0;
    } else if (a.correct) {
      correct += 1;
      run += 1;
      bestStreak = Math.max(bestStreak, run);
    } else {
      wrong += 1;
      run = 0;
    }
    if (a.timeMs !== null) {
      totalTimeMs += a.timeMs;
      times.push(a.timeMs);
    }
    const agg = topicAgg.get(item.topic) ?? { correct: 0, total: 0 };
    agg.total += 1;
    if (a.correct) agg.correct += 1;
    topicAgg.set(item.topic, agg);
    perQuestion.push({
      questionId: item.id,
      stem: item.stem,
      topic: item.topic,
      skill: item.skill,
      difficulty: item.difficulty,
      selectedOptionId: a.optionId,
      selectedOptionText: selected?.text ?? null,
      correctOptionId: correctOption.id,
      correctOptionText: correctOption.text,
      correct: a.correct,
      skipped: a.skipped,
      timeMs: a.timeMs,
      points: a.points,
      explanation: item.explanation,
      // CASE_CHOICE only: the rubric rides with the stored per-question
      // stat so the result screen can show it line by line (ADR 0009).
      // Other formats carry null — the result view hides it.
      rubric: item.rubric ?? null,
      // CHART_CHOICE only: the chart (public part) + its annotation
      // ride with the stored per-question stat so the result screen
      // can draw the annotated chart (ADR 0010 §5). The annotation is
      // split off the stored chart here — it is never sent before
      // reveal, and the stored result is only read after the duel.
      ...(item.chart
        ? {
            chart: {
              title: item.chart.title,
              instrument: item.chart.instrument,
              template: item.chart.template,
              xLabel: item.chart.xLabel,
              yLabel: item.chart.yLabel,
              xLabels: [...item.chart.xLabels],
              series: [...item.chart.series],
            },
            annotation: item.chart.annotation ?? null,
          }
        : { chart: null, annotation: null }),
    });
  }

  const total = correct + wrong + skipped;
  const perTopic: PerTopicStat[] = [...topicAgg.entries()]
    .map(([topic, agg]) => ({
      topic,
      correct: agg.correct,
      total: agg.total,
      accuracy: agg.total > 0 ? agg.correct / agg.total : 0,
    }))
    .sort((x, y) => x.accuracy - y.accuracy || x.topic.localeCompare(y.topic));

  return {
    score: answers.reduce((sum, a) => sum + a.points, 0),
    correct,
    wrong,
    skipped,
    accuracy: total > 0 ? correct / total : 0,
    avgTimeMs:
      times.length > 0 ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : null,
    fastestTimeMs: times.length > 0 ? Math.min(...times) : null,
    slowestTimeMs: times.length > 0 ? Math.max(...times) : null,
    bestStreak,
    totalTimeMs,
    perTopic,
    perQuestion,
  };
}
