import { DUELS } from '@candle/shared';

/**
 * League formation — docs/16 §4 (pure, no I/O).
 *
 * Leagues form ONCE, at season start, from the joiners sorted by
 * Trading Rating. A league is 30 players (docs/05 §7 Step 9); tier
 * is the league number (1 = top).
 *
 * Rules (decided in ADR 0013 §4):
 * - Returning players keep the tier their last season earned them
 *   (promotion/demotion, `nextTier`); new joiners enter at the LOWEST
 *   tier in play (the bottom of the ladder — a strong newcomer climbs
 *   by winning, they do not start at the top).
 * - Within a tier, joiners sort by Trading Rating desc; ties break by
 *   earlier join, then userId (deterministic, no coin toss).
 * - Chunked into 30s. A leftover group of exactly 1 merges into the
 *   previous league (max 31) — a solo league is not a competition,
 *   and a 31-player league still has meaningful top-3 / bottom-3
 *   zones. A tier with exactly 1 joiner total has no league at all:
 *   that joiner is CARRIED to the next season's join pool (they keep
 *   their place, they do not play alone).
 * - Minimum league size is 2 (WEEKLY_MIN_LEAGUE_SIZE): two players
 *   can still rank, promote, and demote.
 */

export interface LeagueJoiner {
  userId: string;
  /** Trading Rating at join time (the seeding number). */
  tradingRating: number;
  /** ms epoch of the join. */
  joinedAtMs: number;
  /** Tier earned last season, or null for a new joiner. */
  nextTier: number | null;
}

export interface FormedLeague {
  /** Tier this league plays in (1 = top). */
  tier: number;
  /** 1-based league number inside the season. */
  leagueNumber: number;
  memberUserIds: string[];
}

export interface LeagueFormation {
  leagues: FormedLeague[];
  /** Tier assigned per user (for the membership rows). */
  tierByUserId: Map<string, number>;
  /** Lone joiners with no league — carried to the next season. */
  carriedUserIds: string[];
}

const LEAGUE_SIZE = DUELS.WEEKLY_LEAGUE_SIZE;

export function formLeagues(joiners: LeagueJoiner[]): LeagueFormation {
  const returning = joiners.filter((j) => j.nextTier !== null);
  const lowestTier =
    returning.length > 0 ? Math.max(...returning.map((j) => j.nextTier as number)) : 1;
  const withTier = joiners.map((j) => ({
    ...j,
    tier: j.nextTier ?? lowestTier,
  }));

  const byTier = new Map<number, typeof withTier>();
  for (const j of withTier) {
    const list = byTier.get(j.tier) ?? [];
    list.push(j);
    byTier.set(j.tier, list);
  }

  const leagues: FormedLeague[] = [];
  const tierByUserId = new Map<string, number>();
  const carriedUserIds: string[] = [];
  let leagueNumber = 0;

  for (const tier of [...byTier.keys()].sort((a, b) => a - b)) {
    const members = (byTier.get(tier) ?? []).sort(
      (a, b) =>
        b.tradingRating - a.tradingRating ||
        a.joinedAtMs - b.joinedAtMs ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0)
    );
    if (members.length === 1) {
      carriedUserIds.push((members[0] as (typeof members)[number]).userId);
      tierByUserId.set((members[0] as (typeof members)[number]).userId, tier);
      continue;
    }
    const chunks: Array<typeof members> = [];
    for (let i = 0; i < members.length; i += LEAGUE_SIZE) {
      chunks.push(members.slice(i, i + LEAGUE_SIZE));
    }
    const last = chunks[chunks.length - 1];
    if (last && last.length === 1 && chunks.length > 1) {
      const prev = chunks[chunks.length - 2] as typeof members;
      prev.push(last[0] as (typeof members)[number]);
      chunks.pop();
    }
    for (const chunk of chunks) {
      leagueNumber += 1;
      leagues.push({ tier, leagueNumber, memberUserIds: chunk.map((m) => m.userId) });
      for (const m of chunk) tierByUserId.set(m.userId, tier);
    }
  }

  return { leagues, tierByUserId, carriedUserIds };
}

/**
 * The tier a player enters next season in, from their league rank
 * (docs/16 §4): top 3 promoted one tier (never above tier 1), bottom
 * 3 demoted one tier, middle unchanged. In a league smaller than 6
 * the two zones would overlap (rank 3 of 4 is both top 3 and bottom
 * 3), so only rank 1 is promoted and only the last rank is demoted
 * — everyone else stays. See leagueZoneFor.
 */
export function nextTierFor(rank: number, leagueSize: number, tier: number): number {
  const zone = leagueZoneFor(rank, leagueSize);
  if (zone === 'TOP') return Math.max(1, tier - 1);
  if (zone === 'BOTTOM') return tier + 1;
  return tier;
}

/**
 * Which zone a rank falls in. Leagues of 6+ use the literal top-3 /
 * bottom-3 zones; smaller leagues use rank 1 / last rank only, so the
 * zones can never overlap and no player is both promoted and demoted.
 */
export function leagueZoneFor(rank: number, leagueSize: number): 'TOP' | 'MIDDLE' | 'BOTTOM' {
  if (leagueSize >= DUELS.WEEKLY_PROMOTION_COUNT + DUELS.WEEKLY_RELEGATION_COUNT) {
    if (rank <= DUELS.WEEKLY_PROMOTION_COUNT) return 'TOP';
    if (rank > leagueSize - DUELS.WEEKLY_RELEGATION_COUNT) return 'BOTTOM';
    return 'MIDDLE';
  }
  if (rank === 1) return 'TOP';
  if (rank === leagueSize) return 'BOTTOM';
  return 'MIDDLE';
}
