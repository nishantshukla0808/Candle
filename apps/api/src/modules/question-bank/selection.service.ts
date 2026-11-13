import { Injectable } from '@nestjs/common';
import { QUESTION_BANK } from '@candle/shared';

/**
 * Stratified-random selection — docs/05 §2.6 (pure, no I/O).
 *
 * The caller (QuestionBankService) supplies the already-eligible pool:
 * LIVE items only, with exposure exclusions already applied. This file
 * only decides *which* eligible items form the set:
 *
 *  1. Fill each requested difficulty cell from that cell's items.
 *  2. When a cell is short, fall back to the NEAREST difficulty
 *     (absolute distance; ties prefer the easier difficulty) — never
 *     to a repeat.
 *  3. At most `maxPerTopic` items from one topic (default 2) unless the
 *     blueprint says otherwise.
 *  4. At least 3 different skills when count >= 6 (repair pass swaps a
 *     duplicated-skill item for an unused-skill item; if no swap can
 *     fix it, the set cannot be built).
 *  5. Never repeat an item within the set. If the pool cannot fill the
 *     set even after fallback, throw — the service maps this to
 *     QUESTION_BANK_INSUFFICIENT_COVERAGE (409). A thin or repeated set
 *     is never returned silently.
 */

export interface SelectableItem {
  id: string;
  topic: string;
  skill: string;
  difficulty: number;
}

export interface SelectionBlueprint {
  count: number;
  /** Requested items per difficulty, e.g. { 1: 2, 2: 3, 3: 2 }. Must sum to count. */
  difficultyMix: Record<number, number>;
  topics?: string[];
  skills?: string[];
  types?: string[];
  /** Overrides the default per-topic cap (2). */
  maxPerTopic?: number;
}

export type SelectionRng = () => number;

const INSUFFICIENT = 'INSUFFICIENT_COVERAGE';

function shuffle<T>(rng: SelectionRng, items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = tmp;
  }
  return arr;
}

/** Difficulties ordered by distance from `target`, ties prefer easier. */
export function nearestDifficulties(target: number): number[] {
  return [1, 2, 3, 4, 5]
    .map((d) => ({ d, dist: Math.abs(d - target) }))
    .sort((a, b) => a.dist - b.dist || a.d - b.d)
    .map((x) => x.d);
}

export function selectStratified(
  pool: SelectableItem[],
  blueprint: SelectionBlueprint,
  rng: SelectionRng = Math.random
): SelectableItem[] {
  const { count } = blueprint;
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('Selection count must be a positive integer.');
  }
  const mixEntries = Object.entries(blueprint.difficultyMix).map(([k, v]): [number, number] => [
    Number(k),
    v,
  ]);
  for (const [d, n] of mixEntries) {
    if (!Number.isInteger(d) || d < 1 || d > 5) {
      throw new Error(`Difficulty mix key ${d} is not a difficulty 1–5.`);
    }
    if (!Number.isInteger(n) || n < 0) {
      throw new Error(`Difficulty mix for ${d} must be a non-negative integer.`);
    }
  }
  const mixTotal = mixEntries.reduce((sum, [, n]) => sum + n, 0);
  if (mixTotal !== count) {
    throw new Error(`${INSUFFICIENT}: difficulty mix sums to ${mixTotal} but count is ${count}.`);
  }
  const maxPerTopic = blueprint.maxPerTopic ?? QUESTION_BANK.DEFAULT_MAX_PER_TOPIC;
  if (!Number.isInteger(maxPerTopic) || maxPerTopic < 1) {
    throw new Error('maxPerTopic must be a positive integer.');
  }

  // The pool is already filtered to the blueprint's topics/skills/types
  // by the caller (SelectableItem carries no `type`, so type filtering
  // happens before this call). This file only decides which eligible
  // items form the set.
  const byDifficulty = new Map<number, SelectableItem[]>();
  for (const item of pool) {
    const cell = byDifficulty.get(item.difficulty) ?? [];
    cell.push(item);
    byDifficulty.set(item.difficulty, cell);
  }
  for (const [d, cell] of byDifficulty) {
    byDifficulty.set(d, shuffle(rng, cell));
  }

  const selected: SelectableItem[] = [];
  const selectedIds = new Set<string>();
  const topicCounts = new Map<string, number>();

  const canTake = (item: SelectableItem): boolean =>
    !selectedIds.has(item.id) && (topicCounts.get(item.topic) ?? 0) < maxPerTopic;

  const take = (item: SelectableItem): void => {
    selected.push(item);
    selectedIds.add(item.id);
    topicCounts.set(item.topic, (topicCounts.get(item.topic) ?? 0) + 1);
  };

  // Fill each difficulty cell in ascending order, falling back to the
  // nearest difficulty when the cell is short.
  for (const [difficulty, needed] of [...mixEntries].sort((a, b) => a[0] - b[0])) {
    let remaining = needed;
    for (const d of nearestDifficulties(difficulty)) {
      if (remaining === 0) break;
      const cell = byDifficulty.get(d) ?? [];
      for (const item of cell) {
        if (remaining === 0) break;
        if (canTake(item)) {
          take(item);
          remaining -= 1;
        }
      }
    }
    if (remaining > 0) {
      throw new Error(
        `${INSUFFICIENT}: only ${needed - remaining} of ${needed} items ` +
          `available for difficulty ${difficulty} (even after nearest-difficulty fallback).`
      );
    }
  }

  if (selected.length !== count) {
    throw new Error(`${INSUFFICIENT}: selected ${selected.length} of ${count} requested items.`);
  }

  // Skill diversity (count >= 6): at least 3 different skills. Repair by
  // swapping a duplicated-skill item for an unused-skill item.
  const minSkills =
    count >= QUESTION_BANK.LARGE_SET_MIN_COUNT ? QUESTION_BANK.MIN_SKILLS_FOR_LARGE_SET : 0;
  if (minSkills > 0) {
    const skillsPresent = new Set(selected.map((s) => s.skill));
    if (skillsPresent.size < minSkills) {
      const unused = pool.filter((p) => !selectedIds.has(p.id) && !skillsPresent.has(p.skill));
      const skillCounts = new Map<string, number>();
      for (const s of selected) skillCounts.set(s.skill, (skillCounts.get(s.skill) ?? 0) + 1);
      for (const candidate of shuffle(rng, unused)) {
        if (skillsPresent.size >= minSkills) break;
        // Swap out an item whose skill appears more than once. Removing
        // the victim frees its topic slot, so the cap check counts the
        // candidate topic net of the victim's removal.
        const victimIdx = selected.findIndex((s) => (skillCounts.get(s.skill) ?? 0) > 1);
        if (victimIdx === -1) continue;
        const victim = selected[victimIdx] as SelectableItem;
        const candidateTopicAfterSwap =
          (topicCounts.get(candidate.topic) ?? 0) - (victim.topic === candidate.topic ? 1 : 0);
        if (candidateTopicAfterSwap >= maxPerTopic) continue;
        selectedIds.delete(victim.id);
        topicCounts.set(victim.topic, (topicCounts.get(victim.topic) ?? 0) - 1);
        skillCounts.set(victim.skill, (skillCounts.get(victim.skill) ?? 0) - 1);
        selected[victimIdx] = candidate;
        selectedIds.add(candidate.id);
        topicCounts.set(candidate.topic, (topicCounts.get(candidate.topic) ?? 0) + 1);
        skillCounts.set(candidate.skill, (skillCounts.get(candidate.skill) ?? 0) + 1);
        skillsPresent.add(candidate.skill);
      }
      if (skillsPresent.size < minSkills) {
        throw new Error(
          `${INSUFFICIENT}: only ${skillsPresent.size} distinct skills available, ` +
            `need ${minSkills} for a set of ${count}.`
        );
      }
    }
  }

  return shuffle(rng, selected);
}

@Injectable()
export class SelectionService {
  select(
    pool: SelectableItem[],
    blueprint: SelectionBlueprint,
    rng: SelectionRng = Math.random
  ): SelectableItem[] {
    return selectStratified(pool, blueprint, rng);
  }
}
