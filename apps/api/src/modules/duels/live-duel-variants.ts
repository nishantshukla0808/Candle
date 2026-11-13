import { DUELS } from '@candle/shared';
import type { DuelBankQuestionType, DuelType } from '@prisma/client';

/**
 * Live duel variants — Phase 7 (Case Duel, L3) + Phase 8 (Chart Detective, L4).
 *
 * The Phase 5 live engine (live-duel-engine.service.ts) is parameterised
 * by variant instead of duplicated: one gateway, one set of timers,
 * one settlement path. A variant fixes only the duel's shape — how
 * many questions, how long each one lasts, which question formats may
 * appear, and the difficulty mix. Everything else (countdown, reveal,
 * disconnect grace, matchmaking windows, bot offer, Rating path) is
 * shared (docs/05 §3, docs/09).
 *
 * | Variant | DuelType | Questions | Per question | Formats            |
 * | ------- | -------- | --------- | ------------ | ------------------ |
 * | LIVE    | LIVE     | 7         | 15 s         | MCQ_4 + TRUE_FALSE |
 * | BLITZ   | BLITZ    | 10        | 10 s         | TRUE_FALSE only    |
 * | CASE    | CASE     | 5         | 45 s         | CASE_CHOICE only   |
 * | CHART   | CHART    | 5         | 30 s         | CHART_CHOICE only  |
 */

export type LiveDuelVariant = 'LIVE' | 'BLITZ' | 'CASE' | 'CHART';

export interface LiveDuelVariantConfig {
  /** Variant key — the value clients send (`live:join-queue`) and receive. */
  variant: LiveDuelVariant;
  /** Prisma DuelType written on the Duel row. */
  duelType: DuelType;
  /** Questions per duel. */
  questionCount: number;
  /** Per-question time limit (ms) — the documented default; the engine
   * prefers the config override (LIVE_QUESTION_MS / BLITZ_QUESTION_MS /
   * CASE_QUESTION_MS / CHART_QUESTION_MS) when one is set, so tests can shrink timers
   * without editing this. */
  questionTimeMs: number;
  /** Formats that may appear in this variant's set (doc 08 §4). */
  types: DuelBankQuestionType[];
  /** Requested items per difficulty; must sum to questionCount. */
  difficultyMix: Record<number, number>;
  /** At most this many items from one topic in a single set. */
  maxPerTopic: number;
  /** Host of this variant (doc 08 §2.2 — one host per duel type). */
  hostName: string;
  /** Host's intro line (host speaks before/after only, doc 08 §2.2). */
  hostIntro: string;
}

export const LIVE_DUEL_VARIANTS: Record<LiveDuelVariant, LiveDuelVariantConfig> = {
  LIVE: {
    variant: 'LIVE',
    duelType: 'LIVE',
    questionCount: DUELS.LIVE_QUESTION_COUNT,
    questionTimeMs: DUELS.QUESTION_TIME_LIMIT_MS,
    types: [...DUELS.LIVE_TYPES] as DuelBankQuestionType[],
    difficultyMix: { ...DUELS.LIVE_DIFFICULTY_MIX },
    maxPerTopic: DUELS.MAX_PER_TOPIC,
    hostName: DUELS.BOT_NAME,
    hostIntro: '7 questions, 15 seconds each. Same set for both of you. Good luck.',
  },
  BLITZ: {
    variant: 'BLITZ',
    duelType: 'BLITZ',
    questionCount: DUELS.BLITZ_QUESTION_COUNT,
    questionTimeMs: DUELS.BLITZ_QUESTION_TIME_LIMIT_MS,
    types: [...DUELS.BLITZ_TYPES] as DuelBankQuestionType[],
    difficultyMix: { ...DUELS.BLITZ_DIFFICULTY_MIX },
    maxPerTopic: DUELS.BLITZ_MAX_PER_TOPIC,
    hostName: DUELS.BOT_NAME,
    hostIntro:
      '10 rapid true-or-false questions, 10 seconds each. One wrong answer breaks your streak. Good luck.',
  },
  CASE: {
    variant: 'CASE',
    duelType: 'CASE',
    questionCount: DUELS.CASE_QUESTION_COUNT,
    questionTimeMs: DUELS.CASE_QUESTION_TIME_LIMIT_MS,
    types: [...DUELS.CASE_TYPES] as DuelBankQuestionType[],
    difficultyMix: { ...DUELS.CASE_DIFFICULTY_MIX },
    maxPerTopic: DUELS.CASE_MAX_PER_TOPIC,
    hostName: DUELS.CASE_HOST_NAME,
    hostIntro:
      '5 cases, 45 seconds each. Same cases for both of you. Pick the best action. Good luck.',
  },
  CHART: {
    variant: 'CHART',
    duelType: 'CHART',
    questionCount: DUELS.CHART_QUESTION_COUNT,
    questionTimeMs: DUELS.CHART_QUESTION_TIME_LIMIT_MS,
    types: [...DUELS.CHART_TYPES] as DuelBankQuestionType[],
    difficultyMix: { ...DUELS.CHART_DIFFICULTY_MIX },
    maxPerTopic: DUELS.CHART_MAX_PER_TOPIC,
    hostName: DUELS.CHART_HOST_NAME,
    hostIntro:
      '5 charts, 30 seconds each. Same charts for both of you. Read the chart, then pick the best interpretation. Good luck.',
  },
};

/** The config for a variant (throws on an unknown key — never guess). */
export function variantConfig(variant: LiveDuelVariant): LiveDuelVariantConfig {
  const config = LIVE_DUEL_VARIANTS[variant];
  if (!config) throw new Error(`Unknown live duel variant: ${String(variant)}.`);
  return config;
}

/** True for the four live variants (LIVE + BLITZ + CASE + CHART); false for BOT / DAILY. */
export function isLiveDuelType(type: string): type is 'LIVE' | 'BLITZ' | 'CASE' | 'CHART' {
  return type === 'LIVE' || type === 'BLITZ' || type === 'CASE' || type === 'CHART';
}
