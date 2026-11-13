import { BOT_ACCURACY_BY_RATING, DUELS } from '@candle/shared';
import { pointsForAnswer, pointsForBlitzAnswer, pointsForCaseAnswer } from './duel-scoring';

/**
 * Mira bot simulation — docs/05 §1 P1, docs/07 §5 (pure, no I/O).
 *
 * The bot is deterministic per duel seed: the same seed, questions,
 * and player rating always replay the same bot result, so any duel
 * can be re-simulated from its stored seed. The RNG is mulberry32
 * (the same small seeded generator the question-bank template engine
 * uses), keyed by an FNV-1a hash of the duel seed string.
 *
 * ## Accuracy model (documented table — this IS the implemented table)
 *
 * The bot's base accuracy follows the player's Learning Rating, so a
 * new player faces a beatable Mira and a strong player faces a sharp
 * one (adaptive difficulty, docs/05 §3.3's bot offer):
 *
 * | Player Learning Rating | Bot base accuracy |
 * | ---------------------- | ----------------- |
 * | < 1100                 | 0.55              |
 * | 1100–1299              | 0.65              |
 * | 1300–1499              | 0.75              |
 * | 1500–1699              | 0.82              |
 * | 1700+                  | 0.88              |
 *
 * Per question the accuracy is adjusted by difficulty — harder
 * questions are harder for Mira too:
 * `p = clamp(base − 0.08 × (difficulty − 3), 0.15, 0.97)`.
 * A difficulty-1 question at base 0.55 is answered correctly with
 * p = 0.71; a difficulty-5 question at base 0.88 with p = 0.72.
 *
 * ## Time model
 *
 * Bot time per question (ms):
 * `clamp(round(3000 + difficulty × 1200 + uniform(0, 6000)), 1500, 14999)`.
 * Harder questions take Mira longer; she never answers in under
 * 1.5 s (no impossibly-fast answers) and never exceeds the 15 s
 * limit. Bot points use the exact same scoring as the player
 * (100 base + up to 50 speed bonus, duel-scoring.ts). In a Blitz
 * duel the same model runs on the 10 s timer instead (times capped
 * below 10,000 ms, points on the 10 s scale + the Blitz streak bonus).
 *
 * ## Case bot (Phase 7, Case Duel L3 — ADR 0009 §5)
 *
 * The bot picks an ACTION, not a right/wrong coin flip, because a
 * case has graded actions (100 / 50 / 0). Per case, from the player's
 * Learning Rating bands (same table as above — NO difficulty
 * adjustment here, unlike the quiz bot: the case's difficulty is
 * already priced into which actions look tempting):
 * - best action (100 points) with probability = base accuracy;
 * - otherwise the second-best action (50 points) with probability
 *   0.8 of the remainder;
 * - otherwise a 0-point action (uniform among the 0-point options).
 * Bot time per case (ms):
 * `clamp(20000 + difficulty × 5000 + uniform(0, 15000), 5000, 44999)`.
 * She thinks longer than on a quiz question (cases take judgement),
 * never answers in under 5 s, and never exceeds the 45 s limit.
 * Bot points use the exact same Case scoring as the player
 * (`pointsForCaseAnswer`: option points + up to 20 speed bonus).
 * She submits NO reason (null) — the reason is never scored, and a
 * bot has nothing to explain.
 *
 * ## Chart bot (Phase 8, Chart Detective L4 — ADR 0010 §6)
 *
 * The bot reads a CHART, not a right/wrong coin flip on a bare
 * question: per chart she picks the correct interpretation with
 * probability = her base accuracy for the player's Learning Rating
 * (same bands as above — NO difficulty adjustment, unlike the quiz
 * bot: a chart's difficulty is already priced into how tempting the
 * wrong readings look); otherwise a uniform wrong interpretation.
 * Bot time per chart (ms):
 * `clamp(12000 + difficulty × 2000 + uniform(0, 10000), 5000, 29999)`.
 * She reads slower than on a quiz question (reading a chart takes
 * longer), never answers in under 5 s, and never exceeds the 30 s
 * limit. Bot points use the exact same Chart scoring as the player
 * (`pointsForAnswer` on the 30 s timer: 100 base + up to 50 speed
 * bonus). Deterministic per (seed, questions, rating).
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

/** Bot base accuracy for a player's Learning Rating (table above). */
export function botBaseAccuracy(playerRating: number): number {
  for (const band of BOT_ACCURACY_BY_RATING) {
    if (playerRating <= band.maxRating) return band.accuracy;
  }
  return 0.88;
}

/** Per-question correct probability: base adjusted by difficulty. */
export function botCorrectProbability(baseAccuracy: number, difficulty: number): number {
  return Math.min(0.97, Math.max(0.15, baseAccuracy - 0.08 * (difficulty - 3)));
}

/** Bot time for one question (ms) — see the time model above. */
export function botTimeMs(
  rng: () => number,
  difficulty: number,
  timeLimitMs: number = DUELS.QUESTION_TIME_LIMIT_MS
): number {
  const raw = Math.round(3000 + difficulty * 1200 + rng() * 6000);
  return Math.min(timeLimitMs - 1, Math.max(1500, raw));
}

export interface BotQuestionInput {
  id: string;
  difficulty: number;
}

export interface BotAnswer {
  questionId: string;
  /** The option Mira picked (empty for quiz/blitz bots, which only record correct/time). */
  optionId?: string;
  correct: boolean;
  timeMs: number;
  points: number;
}

export interface BotSimulation {
  answers: BotAnswer[];
  score: number;
  correctCount: number;
  totalTimeMs: number;
}

/**
 * Simulates Mira's full duel: one seeded coin flip per question
 * (accuracy by difficulty) and one seeded time draw per question.
 * Deterministic for a fixed (seed, questions, playerRating).
 *
 * `opts.timeLimitMs` is the variant's per-question timer (default
 * 15 s, Speed Quiz). `opts.streakBonus` scores her with the Blitz
 * streak rule (docs/05 §1 L2): her own consecutive-correct run pays
 * the same +10/+20/+30 bonus the player gets, so both sides of a
 * Blitz duel are scored by the same rule. Bot times are capped below
 * the variant's timer, so she never "answers" after the deadline.
 */
export function simulateBot(
  seed: string,
  questions: BotQuestionInput[],
  playerRating: number,
  opts: { timeLimitMs?: number; streakBonus?: boolean } = {}
): BotSimulation {
  const rng = mulberry32(hashSeed(seed));
  const base = botBaseAccuracy(playerRating);
  const timeLimitMs = opts.timeLimitMs ?? DUELS.QUESTION_TIME_LIMIT_MS;
  let streak = 0;
  const answers: BotAnswer[] = questions.map((q) => {
    const correct = rng() < botCorrectProbability(base, q.difficulty);
    const timeMs = botTimeMs(rng, q.difficulty, timeLimitMs);
    streak = correct ? streak + 1 : 0;
    const points = opts.streakBonus
      ? pointsForBlitzAnswer(correct, timeMs, streak)
      : pointsForAnswer(correct, timeMs, timeLimitMs);
    return { questionId: q.id, correct, timeMs, points };
  });
  return {
    answers,
    score: answers.reduce((sum, a) => sum + a.points, 0),
    correctCount: answers.filter((a) => a.correct).length,
    totalTimeMs: answers.reduce((sum, a) => sum + a.timeMs, 0),
  };
}

/** One chart question for the Chart bot: the 4 interpretations. */
export interface ChartBotQuestionInput {
  id: string;
  difficulty: number;
  options: Array<{ id: string; isCorrect: boolean }>;
}

/**
 * Chart bot time for one chart (ms) — ADR 0010 §6:
 * `clamp(12000 + difficulty × 2000 + uniform(0, 10000), 5000, 29999)`.
 * Slower than the quiz bot (reading a chart takes longer), never
 * under 5 s, never past the 30 s timer.
 */
export function botChartTimeMs(rng: () => number, difficulty: number): number {
  const raw = Math.round(12_000 + difficulty * 2000 + rng() * 10_000);
  return Math.min(DUELS.CHART_QUESTION_TIME_LIMIT_MS - 1, Math.max(5000, raw));
}

/**
 * Simulates Mira's full Chart Detective duel: one seeded roll per
 * chart. She picks the correct interpretation with probability = her
 * base accuracy for the player's Learning Rating (same bands as the
 * quiz bot, NO difficulty adjustment — the chart's difficulty is
 * already priced into which readings look tempting); otherwise a
 * uniform wrong interpretation. Deterministic for a fixed
 * (seed, questions, playerRating), so any Chart bot duel can be
 * re-simulated from its stored seed. Her points are the exact Chart
 * rule (`pointsForAnswer` on the 30 s timer); `correct` means "picked
 * the right reading". Kabir hosts the duel — Mira only PLAYS it.
 */
export function simulateChartBot(
  seed: string,
  questions: ChartBotQuestionInput[],
  playerRating: number
): BotSimulation {
  const rng = mulberry32(hashSeed(seed));
  const base = botBaseAccuracy(playerRating);
  const answers: BotAnswer[] = questions.map((q) => {
    const correctOption = q.options.find((o) => o.isCorrect);
    const wrongOptions = q.options.filter((o) => !o.isCorrect);
    let picked: { id: string; isCorrect: boolean } | undefined;
    if (rng() < base) {
      picked = correctOption;
    } else if (wrongOptions.length > 0) {
      picked = wrongOptions[Math.floor(rng() * wrongOptions.length)];
    }
    // A chart item always has one correct interpretation
    // (bank-enforced); fall back to it rather than inventing an
    // answer if the data is malformed.
    picked ??= correctOption ?? q.options[0];
    if (!picked) throw new Error(`simulateChartBot: question ${q.id} has no options.`);
    const timeMs = botChartTimeMs(rng, q.difficulty);
    return {
      questionId: q.id,
      optionId: picked.id,
      correct: picked.isCorrect,
      timeMs,
      points: pointsForAnswer(picked.isCorrect, timeMs, DUELS.CHART_QUESTION_TIME_LIMIT_MS),
    };
  });
  return {
    answers,
    score: answers.reduce((sum, a) => sum + a.points, 0),
    correctCount: answers.filter((a) => a.correct).length,
    totalTimeMs: answers.reduce((sum, a) => sum + a.timeMs, 0),
  };
}

/** One case question for the Case bot: the graded actions, with points. */
export interface CaseBotQuestionInput {
  id: string;
  difficulty: number;
  options: Array<{ id: string; points: number; isCorrect: boolean }>;
}

/**
 * Case bot time for one case (ms) — ADR 0009 §5:
 * `clamp(20000 + difficulty × 5000 + uniform(0, 15000), 5000, 44999)`.
 * Harder cases take Mira longer; she never answers in under 5 s
 * (no impossibly-fast judgement) and never exceeds the 45 s limit.
 */
export function botCaseTimeMs(rng: () => number, difficulty: number): number {
  const raw = Math.round(20_000 + difficulty * 5000 + rng() * 15_000);
  return Math.min(DUELS.CASE_QUESTION_TIME_LIMIT_MS - 1, Math.max(5000, raw));
}

/**
 * Simulates Mira's full Case Duel: one seeded roll per case. She picks
 * the best action with probability = her base accuracy for the
 * player's Learning Rating (same bands as the quiz bot, no difficulty
 * adjustment); otherwise the second-best action with probability 0.8
 * of the remainder, else a 0-point action (uniform among them).
 * Deterministic for a fixed (seed, questions, playerRating), so any
 * Case bot duel can be re-simulated from its stored seed. Her points
 * are the exact Case rule (`pointsForCaseAnswer`); `correct` means
 * "picked the best action" (the only sense of correct a case has).
 * She submits no reason (the engine records null for her).
 */
export function simulateCaseBot(
  seed: string,
  questions: CaseBotQuestionInput[],
  playerRating: number
): BotSimulation {
  const rng = mulberry32(hashSeed(seed));
  const base = botBaseAccuracy(playerRating);
  const answers: BotAnswer[] = questions.map((q) => {
    const best = q.options.find((o) => o.isCorrect);
    const secondBest = q.options.find((o) => !o.isCorrect && o.points === 50);
    const zeroPoint = q.options.filter((o) => !o.isCorrect && o.points === 0);
    let picked: { id: string; points: number; isCorrect: boolean } | undefined;
    const roll = rng();
    if (roll < base) {
      picked = best;
    } else if (secondBest && rng() < 0.8) {
      picked = secondBest;
    } else if (zeroPoint.length > 0) {
      picked = zeroPoint[Math.floor(rng() * zeroPoint.length)];
    }
    // A case item always has a best action (bank-enforced); fall back
    // to it rather than inventing an answer if the data is malformed.
    picked ??= best ?? q.options[0];
    if (!picked) throw new Error(`simulateCaseBot: question ${q.id} has no options.`);
    const timeMs = botCaseTimeMs(rng, q.difficulty);
    return {
      questionId: q.id,
      optionId: picked.id,
      correct: picked.isCorrect,
      timeMs,
      points: pointsForCaseAnswer(picked.points, timeMs),
    };
  });
  return {
    answers,
    score: answers.reduce((sum, a) => sum + a.points, 0),
    correctCount: answers.filter((a) => a.correct).length,
    totalTimeMs: answers.reduce((sum, a) => sum + a.timeMs, 0),
  };
}
