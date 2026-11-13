import { Injectable } from '@nestjs/common';
import { DuelType } from '@prisma/client';
import { DUELS } from '@candle/shared';
import { AppError } from '../../common/errors/app-error';
import { AppLogger } from '../../common/services/logger.service';
import { buildPaginationMeta } from '../../common/utils/pagination';
import type { RewardSummary } from '../gamification/gamification.service';
import { mirrorSprintOutcome, type SprintOutcome } from './sprint-scoring';
import type { SprintDuelResultRow } from './sprint.repository';
import { SprintRepository } from './sprint.repository';

/**
 * Carried on every sprint endpoint's OpenAPI docs and UI text
 * (blueprint §16 — the disclaimer lives in the product, not just docs).
 */
export const SPRINT_DISCLAIMER =
  'Educational purpose only — this is not investment advice. ' +
  'All tickers are fictional, all money is virtual, and no mentor ' +
  'gives personalised buy or sell recommendations.';

export interface SprintOpponentSummary {
  name: string;
  kind: 'BOT' | 'HUMAN';
  /** The opponent's risk-adjusted score (the deciding number). */
  riskAdjustedScore: number;
  /** The opponent's final equity, 2dp string (null when forfeited before any trade). */
  finalEquity: string | null;
  tradeCount: number;
}

export interface SprintPerInstrumentView {
  instrumentId: string;
  symbol: string;
  trades: number;
  buyQty: number;
  sellQty: number;
  realisedPnl: number;
  finalQty: number;
  finalValue: number;
}

export interface SprintEquityPointView {
  t: number;
  equity: string;
}

export interface SprintResultView {
  duelId: string;
  type: 'SPRINT' | 'CRISIS';
  status: 'SETTLED';
  result: SprintOutcome;
  /** Final portfolio value, 2dp string. */
  finalEquity: string;
  returnPct: number;
  realisedVolPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
  tradeCount: number;
  perInstrument: SprintPerInstrumentView[];
  equityCurve: SprintEquityPointView[];
  opponent: SprintOpponentSummary;
  /** Trading Rating before/after/delta (null when the Rating could not be updated). */
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingReason: string;
  xp: {
    awarded: number;
    totalXp: number;
    level: number;
    levelUp: boolean;
    currentStreak: number;
    newBadges: Array<{ slug: string; name: string }>;
  };
  finishedAt: Date | null;
  /**
   * Crisis Duel only (docs/15 §8): the crash that hit this duel, this
   * player's crash-window drawdown and crash-window trading, and the
   * plain-words line about what the crash did. Absent for sprints.
   */
  crisis?: {
    crashMinute: number;
    crashDrawdownPct: number;
    tradesDuringCrash: number;
    panicSold: boolean;
    crashLine: string;
  };
}

export interface SprintHistoryItem {
  duelId: string;
  type: 'SPRINT' | 'CRISIS';
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  result: SprintOutcome;
  finalEquity: string;
  returnPct: number;
  riskAdjustedScore: number;
  opponentName: string | null;
  opponentRiskScore: number;
  ratingDelta: number | null;
}

/** Plain-words Trading Rating reason, in the same shape as the learning duels'. */
export function sprintRatingReasonFor(
  result: SprintOutcome,
  opponentName: string,
  opponentRating: number | null,
  delta: number | null,
  crisis = false
): string {
  const deltaText =
    delta === null
      ? ''
      : delta > 0
        ? ` Your Trading Rating went up by ${delta}.`
        : delta < 0
          ? ` Your Trading Rating went down by ${Math.abs(delta)}.`
          : ' Your Trading Rating did not change.';
  const rated = opponentRating === null ? '' : ` (rated ${Math.round(opponentRating)})`;
  const contest = crisis
    ? 'in the Crisis Duel, on crisis risk-adjusted return'
    : 'on risk-adjusted return';
  if (result === 'WIN') return `You beat ${opponentName}${rated} ${contest}.${deltaText}`;
  if (result === 'DRAW') return `You drew with ${opponentName}${rated} ${contest}.${deltaText}`;
  return `${opponentName}${rated} beat you ${contest}.${deltaText}`;
}

/** Plain-words line about what the crash did to this player's result (docs/15 §8). */
export function crisisCrashLineFor(input: {
  crashMinute: number;
  crashDrawdownPct: number;
  tradesDuringCrash: number;
  panicSold: boolean;
}): string {
  const { crashMinute, crashDrawdownPct, tradesDuringCrash, panicSold } = input;
  const base =
    `The market crashed in minute ${crashMinute}: every fictional instrument fell about 12% over ` +
    `3 minutes, then recovered about 5%. Your portfolio fell ${crashDrawdownPct}% across the crash.`;
  if (panicSold) {
    return (
      `${base} You sold during the crash — selling at the bottom locks the fall in and misses ` +
      `the recovery. Holding through would have recovered part of it.`
    );
  }
  if (tradesDuringCrash > 0) {
    return `${base} You traded ${tradesDuringCrash} time${tradesDuringCrash === 1 ? '' : 's'} during the crash but did not sell out — you kept exposure through the recovery.`;
  }
  return `${base} You did not sell during the crash — you held through the fall and the recovery.`;
}

function xpView(rewards: RewardSummary): SprintResultView['xp'] {
  return {
    awarded: rewards.xpAwarded,
    totalXp: rewards.totalXp,
    level: rewards.level,
    levelUp: rewards.levelUp,
    currentStreak: rewards.currentStreak,
    newBadges: rewards.newBadges.map((b) => ({ slug: b.slug, name: b.name })),
  };
}

/**
 * SprintService — docs/14 (Phase 9).
 *
 * The read side of the Paper Trading Sprint: stored-result views and
 * history. The live engine (SprintEngine) owns the sprint itself;
 * this service owns how a finished sprint is presented. The result
 * page reads the stored SprintDuelResult row, it never recomputes
 * stats — the same contract as DuelGameResult (docs/07 §4).
 */
@Injectable()
export class SprintService {
  constructor(
    private readonly repo: SprintRepository,
    private readonly logger: AppLogger
  ) {}

  /** One sprint's stored result, for the player who played it. */
  async getResult(userId: string, duelId: string): Promise<SprintResultView> {
    const duel = await this.repo.findDuelById(duelId);
    if (!duel) throw AppError.notFound('Sprint not found.');
    if (duel.playerAId !== userId && duel.playerBId !== userId) {
      throw AppError.forbidden();
    }
    const row = await this.repo.findResult(duelId, userId);
    if (!row) throw AppError.notFound('This sprint has no stored result yet.');
    const opponentName =
      duel.playerBId === null
        ? DUELS.BOT_NAME
        : duel.playerAId === userId
          ? ((await this.repo.findUserById(duel.playerBId))?.displayName ?? 'Player')
          : ((await this.repo.findUserById(duel.playerAId))?.displayName ?? 'Player');
    return this.toView(
      row,
      duel.finishedAt,
      opponentName,
      duel.playerBId === null,
      duel.type === 'CRISIS' ? 'CRISIS' : 'SPRINT'
    );
  }

  /** My sprint history, newest first. Pass a type to list only sprints or only crisis duels. */
  async listHistory(
    userId: string,
    page: number,
    limit: number,
    type?: 'SPRINT' | 'CRISIS'
  ): Promise<{ items: SprintHistoryItem[]; meta: ReturnType<typeof buildPaginationMeta> }> {
    const duelType = type === 'CRISIS' ? DuelType.CRISIS : DuelType.SPRINT;
    const [total, rows] = type
      ? await Promise.all([
          this.repo.countResultsForUserByType(userId, duelType),
          this.repo.listResultsForUserByType(userId, duelType, (page - 1) * limit, limit),
        ])
      : await Promise.all([
          this.repo.countResultsForUser(userId),
          this.repo.listResultsForUser(userId, (page - 1) * limit, limit),
        ]);
    const items: SprintHistoryItem[] = [];
    for (const row of rows) {
      const duel = await this.repo.findDuelById(row.duelId);
      const rowType = duel?.type === 'CRISIS' ? 'CRISIS' : 'SPRINT';
      const opponentName = duel
        ? duel.playerBId === null
          ? DUELS.BOT_NAME
          : duel.playerAId === userId
            ? ((await this.repo.findUserById(duel.playerBId))?.displayName ?? 'Player')
            : ((await this.repo.findUserById(duel.playerAId))?.displayName ?? 'Player')
        : null;
      items.push({
        duelId: row.duelId,
        type: rowType,
        status: 'SETTLED',
        startedAt: duel?.startedAt ?? row.createdAt,
        finishedAt: duel?.finishedAt ?? row.createdAt,
        result: row.result,
        finalEquity: row.finalEquity.toFixed(2),
        returnPct: row.returnPct,
        riskAdjustedScore: row.riskAdjustedScore,
        opponentName,
        opponentRiskScore: row.opponentRiskScore,
        ratingDelta: row.ratingDelta,
      });
    }
    return { items, meta: buildPaginationMeta(page, limit, total) };
  }

  /**
   * The stored-result view for a row the engine just wrote (settlement
   * emit + rematch reads). `rewards` is the XP summary from the
   * settling transaction — the stored row does not carry the full XP
   * breakdown view, so the caller supplies it.
   */
  toView(
    row: SprintDuelResultRow,
    finishedAt: Date | null,
    opponentName: string,
    isBot: boolean,
    type: 'SPRINT' | 'CRISIS' = 'SPRINT'
  ): SprintResultView {
    const xpBreakdown = row.xpBreakdown as unknown as {
      totalXp?: number;
      level?: number;
      levelUp?: boolean;
      currentStreak?: number;
      newBadges?: Array<{ slug: string; name: string }>;
    };
    return {
      duelId: row.duelId,
      type,
      status: 'SETTLED',
      result: row.result,
      finalEquity: row.finalEquity.toFixed(2),
      returnPct: row.returnPct,
      realisedVolPct: row.realisedVolPct,
      maxDrawdownPct: row.maxDrawdownPct,
      riskAdjustedScore: row.riskAdjustedScore,
      tradeCount: row.tradeCount,
      perInstrument: (row.perInstrument as unknown as SprintPerInstrumentView[]) ?? [],
      equityCurve: (row.equityCurve as unknown as SprintEquityPointView[]) ?? [],
      opponent: {
        name: opponentName,
        kind: isBot ? 'BOT' : 'HUMAN',
        riskAdjustedScore: row.opponentRiskScore,
        finalEquity: row.opponentEquity ? row.opponentEquity.toFixed(2) : null,
        tradeCount: row.opponentTradeCount,
      },
      ratingBefore: row.ratingBefore,
      ratingAfter: row.ratingAfter,
      ratingDelta: row.ratingDelta,
      ratingReason: row.ratingReason,
      xp: {
        awarded: row.xpAwarded,
        totalXp: xpBreakdown.totalXp ?? 0,
        level: xpBreakdown.level ?? 1,
        levelUp: xpBreakdown.levelUp ?? false,
        currentStreak: xpBreakdown.currentStreak ?? 0,
        newBadges: xpBreakdown.newBadges ?? [],
      },
      finishedAt,
      ...(type === 'CRISIS' && row.crashMinute !== null && row.crashMinute !== undefined
        ? {
            crisis: {
              crashMinute: row.crashMinute,
              crashDrawdownPct: row.crashDrawdownPct ?? 0,
              tradesDuringCrash: row.tradesDuringCrash ?? 0,
              panicSold: row.panicSold ?? false,
              crashLine: crisisCrashLineFor({
                crashMinute: row.crashMinute,
                crashDrawdownPct: row.crashDrawdownPct ?? 0,
                tradesDuringCrash: row.tradesDuringCrash ?? 0,
                panicSold: row.panicSold ?? false,
              }),
            },
          }
        : {}),
    };
  }

  /** Mirror helper for the engine's finished payload (opponent's result). */
  mirrorResult(result: SprintOutcome): SprintOutcome {
    return mirrorSprintOutcome(result);
  }

  /** XP view for a freshly granted reward (settlement emit). */
  xpViewFor(rewards: RewardSummary): SprintResultView['xp'] {
    return xpView(rewards);
  }
}
