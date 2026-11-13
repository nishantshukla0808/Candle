import {
  selectStratified,
  type SelectableItem,
  type SelectionBlueprint,
} from './selection.service';
import { seededRng } from './template-engine';

function item(id: string, topic: string, skill: string, difficulty: number): SelectableItem {
  return { id, topic, skill, difficulty };
}

/** Pool: 4 topics × 4 skills × difficulties 1–3, 2 items per cell (96 items). */
function richPool(): SelectableItem[] {
  const pool: SelectableItem[] = [];
  const topics = ['budgeting', 'stocks', 'risk', 'markets'];
  const skills = ['RECALL', 'CALCULATION', 'JUDGEMENT', 'SCENARIO'];
  let n = 0;
  for (const topic of topics) {
    for (const skill of skills) {
      for (let d = 1; d <= 3; d++) {
        for (let copy = 0; copy < 2; copy++) {
          n += 1;
          pool.push(item(`i${n}`, topic, skill, d));
        }
      }
    }
  }
  return pool;
}

const MIX_7: SelectionBlueprint = { count: 7, difficultyMix: { 1: 2, 2: 3, 3: 2 } };

describe('selection (docs/05 §2.6)', () => {
  it('is deterministic with a seeded rng', () => {
    const pool = richPool();
    const a = selectStratified(pool, MIX_7, seededRng(42)).map((i) => i.id);
    const b = selectStratified(pool, MIX_7, seededRng(42)).map((i) => i.id);
    expect(a).toEqual(b);
  });

  it('fills the requested difficulty mix, never repeats, caps topics at 2', () => {
    const picked = selectStratified(richPool(), MIX_7, seededRng(1));
    expect(picked).toHaveLength(7);
    expect(new Set(picked.map((i) => i.id)).size).toBe(7);
    const byDifficulty: Record<number, number> = {};
    const byTopic: Record<string, number> = {};
    for (const p of picked) {
      byDifficulty[p.difficulty] = (byDifficulty[p.difficulty] ?? 0) + 1;
      byTopic[p.topic] = (byTopic[p.topic] ?? 0) + 1;
    }
    expect(byDifficulty).toEqual({ 1: 2, 2: 3, 3: 2 });
    expect(Object.values(byTopic).every((n) => n <= 2)).toBe(true);
  });

  it('includes at least 3 different skills when count >= 6', () => {
    const picked = selectStratified(richPool(), MIX_7, seededRng(2));
    expect(new Set(picked.map((i) => i.skill)).size).toBeGreaterThanOrEqual(3);
  });

  it('falls back to the nearest difficulty when a cell is short (ties prefer easier)', () => {
    // Only difficulty-2 items exist; ask for 1 easy + 1 medium + 1 hard.
    const pool = [
      item('a', 'budgeting', 'RECALL', 2),
      item('b', 'stocks', 'CALCULATION', 2),
      item('c', 'risk', 'JUDGEMENT', 2),
      item('d', 'budgeting', 'SCENARIO', 2),
      item('e', 'stocks', 'RECALL', 2),
    ];
    const picked = selectStratified(
      pool,
      { count: 3, difficultyMix: { 1: 1, 2: 1, 3: 1 } },
      seededRng(3)
    );
    expect(picked).toHaveLength(3);
    expect(picked.every((p) => p.difficulty === 2)).toBe(true);
    expect(new Set(picked.map((p) => p.id)).size).toBe(3);
  });

  it('prefers the nearer difficulty over a farther one', () => {
    // Ask for difficulty 1; only difficulties 2 and 5 exist.
    const pool = [item('near', 'budgeting', 'RECALL', 2), item('far', 'stocks', 'RECALL', 5)];
    const picked = selectStratified(pool, { count: 1, difficultyMix: { 1: 1 } }, seededRng(4));
    expect(picked[0]?.id).toBe('near');
  });

  it('throws insufficient coverage when the pool cannot fill the set even after fallback', () => {
    const pool = [item('a', 'budgeting', 'RECALL', 1), item('b', 'budgeting', 'RECALL', 1)];
    expect(() =>
      selectStratified(pool, { count: 5, difficultyMix: { 1: 5 } }, seededRng(5))
    ).toThrow(/INSUFFICIENT_COVERAGE/);
  });

  it('throws insufficient coverage when the topic cap makes the set unfillable', () => {
    // 6 items, all one topic, cap 2 → at most 2 can be picked.
    const pool = [
      item('a', 'budgeting', 'RECALL', 1),
      item('b', 'budgeting', 'CALCULATION', 1),
      item('c', 'budgeting', 'JUDGEMENT', 2),
      item('d', 'budgeting', 'SCENARIO', 2),
      item('e', 'budgeting', 'RECALL', 3),
      item('f', 'budgeting', 'CALCULATION', 3),
    ];
    expect(() =>
      selectStratified(pool, { count: 4, difficultyMix: { 1: 2, 2: 1, 3: 1 } }, seededRng(6))
    ).toThrow(/INSUFFICIENT_COVERAGE/);
  });

  it('honours an explicit maxPerTopic from the blueprint', () => {
    const pool = [
      item('a', 'budgeting', 'RECALL', 1),
      item('b', 'budgeting', 'CALCULATION', 1),
      item('c', 'budgeting', 'JUDGEMENT', 1),
      item('d', 'budgeting', 'SCENARIO', 1),
    ];
    const picked = selectStratified(
      pool,
      { count: 3, difficultyMix: { 1: 3 }, maxPerTopic: 3 },
      seededRng(7)
    );
    expect(picked).toHaveLength(3);
  });

  it('throws insufficient coverage when fewer than 3 skills exist for a set of 6+', () => {
    const pool: SelectableItem[] = [];
    let n = 0;
    for (const skill of ['RECALL', 'CALCULATION']) {
      for (let d = 1; d <= 3; d++) {
        for (let copy = 0; copy < 3; copy++) {
          n += 1;
          pool.push(item(`s${n}`, `topic-${skill}-${d}`, skill, d));
        }
      }
    }
    expect(() =>
      selectStratified(pool, { count: 6, difficultyMix: { 1: 2, 2: 2, 3: 2 } }, seededRng(8))
    ).toThrow(/INSUFFICIENT_COVERAGE/);
  });

  it('rejects a difficulty mix that does not sum to count', () => {
    expect(() =>
      selectStratified(richPool(), { count: 7, difficultyMix: { 1: 2, 2: 2 } }, seededRng(9))
    ).toThrow(/INSUFFICIENT_COVERAGE/);
  });

  it('does not require 3 skills for small sets', () => {
    const pool = [
      item('a', 'budgeting', 'RECALL', 1),
      item('b', 'stocks', 'RECALL', 2),
      item('c', 'risk', 'RECALL', 3),
    ];
    const picked = selectStratified(
      pool,
      { count: 3, difficultyMix: { 1: 1, 2: 1, 3: 1 } },
      seededRng(10)
    );
    expect(picked).toHaveLength(3);
  });
});
