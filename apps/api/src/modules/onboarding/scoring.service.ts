import {
  ASSESSMENT_LEVEL_LABELS,
  ASSESSMENT_TOPICS,
  type AssessmentTopicKey,
} from '@candle/shared';
import type { AnswerConfidence, PlacementKind, QuestionKind } from '@prisma/client';

/**
 * ScoringService — pure assessment grading (spec §4).
 *
 * No database, no NestJS: every function is pure and heavily unit-tested.
 * The onboarding service orchestrates; this file only computes.
 *
 * Rules (spec §4.1–§4.3):
 * - Correctness: SINGLE = exactly the one correct option; MULTI = exact set
 *   match. Empty selection is never correct (that's a skip).
 * - Points: correct + CONFIDENT = 1.0; correct + GUESSING = 0.5;
 *   wrong (any confidence) = 0; SKIPPED = 0 (recorded distinctly).
 * - Per-topic level from score s (3 questions, max 3.0):
 *   s = 0 → 1; 0 < s ≤ 1 → 2; 1 < s ≤ 2 → 3; 2 < s < 3 → 4; s = 3 → 5.
 * - Overall level = nearest integer of the mean of the four topic levels.
 * - Placement: first topic (track order) with level ≤ 3 → START_HERE at
 *   that module order; all topics ≥ 4 → FAST_TRACK (waive modules 0–2,
 *   start at module order 3).
 */

export interface GradedQuestionInput {
  questionId: string;
  topicKey: string;
  kind: QuestionKind;
  /** Correct option ids (server-side only — never leaves the API). */
  correctOptionIds: string[];
  selectedOptionIds: string[];
  confidence: AnswerConfidence;
}

export interface ScoredAnswer {
  questionId: string;
  topicKey: string;
  isCorrect: boolean;
  confidence: AnswerConfidence;
  pointsAwarded: number;
}

export interface TopicScore {
  topicKey: string;
  level: number;
  label: string;
  score: number;
  maxScore: number;
}

export interface Placement {
  kind: PlacementKind;
  recommendedStartModuleOrder: number;
}

export interface AssessmentGrading {
  answers: ScoredAnswer[];
  topics: TopicScore[];
  overallLevel: number;
  placement: Placement;
}

/** Exact-set correctness predicate (shared with the quiz engine's semantics). */
export function isAnswerCorrect(
  kind: QuestionKind,
  selectedOptionIds: string[],
  correctOptionIds: string[]
): boolean {
  const selected = new Set(selectedOptionIds);
  const correct = new Set(correctOptionIds);
  return (
    selected.size > 0 &&
    selected.size === correct.size &&
    [...selected].every((id) => correct.has(id))
  );
}

/** Confidence-weighted points (spec §4.1). Scores are always in 0.5 steps. */
export function pointsFor(isCorrect: boolean, confidence: AnswerConfidence): number {
  if (!isCorrect) return 0;
  if (confidence === 'CONFIDENT') return 1;
  if (confidence === 'GUESSING') return 0.5;
  return 0; // SKIPPED can never be correct; recorded distinctly.
}

/** Per-topic level from a 0–3 score (spec §4.2). */
export function levelForScore(score: number): number {
  if (score <= 0) return 1;
  if (score <= 1) return 2;
  if (score <= 2) return 3;
  if (score < 3) return 4;
  return 5;
}

export function labelForLevel(level: number): string {
  return ASSESSMENT_LEVEL_LABELS[level] ?? 'Starting Out';
}

/**
 * Grades a full assessment attempt. `inputs` must cover every presented
 * question exactly once — the service validates that before calling.
 */
export function gradeAssessment(inputs: GradedQuestionInput[]): AssessmentGrading {
  const answers: ScoredAnswer[] = inputs.map((q) => {
    const isCorrect = isAnswerCorrect(q.kind, q.selectedOptionIds, q.correctOptionIds);
    return {
      questionId: q.questionId,
      topicKey: q.topicKey,
      isCorrect,
      confidence: q.confidence,
      pointsAwarded: pointsFor(isCorrect, q.confidence),
    };
  });

  const topics: TopicScore[] = ASSESSMENT_TOPICS.map((topicKey) => {
    const topicAnswers = answers.filter((a) => a.topicKey === topicKey);
    const score = roundHalf(topicAnswers.reduce((sum, a) => sum + a.pointsAwarded, 0));
    const level = levelForScore(score);
    return {
      topicKey,
      level,
      label: labelForLevel(level),
      score,
      maxScore: topicAnswers.length,
    };
  });

  const overallLevel = Math.round(topics.reduce((sum, t) => sum + t.level, 0) / topics.length);

  const firstWeak = topics.findIndex((t) => t.level <= 3);
  const placement: Placement =
    firstWeak === -1
      ? { kind: 'FAST_TRACK', recommendedStartModuleOrder: ASSESSMENT_TOPICS.length - 1 }
      : { kind: 'START_HERE', recommendedStartModuleOrder: firstWeak };

  return { answers, topics, overallLevel, placement };
}

/** Keeps scores on 0.5 steps despite float arithmetic. */
function roundHalf(n: number): number {
  return Math.round(n * 2) / 2;
}

/** Topic keys in track order — the placement map (spec §4.3). */
export function topicOrder(): readonly AssessmentTopicKey[] {
  return ASSESSMENT_TOPICS;
}
