import { LiveMatchmakingService } from './live-matchmaking.service';

/**
 * Live matchmaking — docs/05 §3.3, docs/09 (Phase 5).
 * Fake Redis implements only the sorted-set + string ops the service uses.
 */

class FakeRedis {
  private readonly store = new Map<string, string>();
  private readonly zsets = new Map<string, Map<string, number>>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string, _ttl?: number): Promise<'OK'> {
    this.store.set(key, value);
    return 'OK';
  }

  async del(key: string): Promise<number> {
    return this.store.delete(key) ? 1 : 0;
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    let m = this.zsets.get(key);
    if (!m) {
      m = new Map();
      this.zsets.set(key, m);
    }
    m.set(member, score);
    return 1;
  }

  async zrem(key: string, member: string): Promise<number> {
    return this.zsets.get(key)?.delete(member) ? 1 : 0;
  }

  async zrangebyscore(key: string, min: number, max: number): Promise<string[]> {
    const out: string[] = [];
    const rows = [...(this.zsets.get(key)?.entries() ?? [])]
      .filter(([, score]) => score >= min && score <= max)
      .sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
    for (const [member, score] of rows) out.push(member, String(score));
    return out;
  }
}

const NOW = new Date('2026-11-12T10:00:00.000Z');
const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as any;

function makeService(activeDuel: boolean) {
  const redis = new FakeRedis();
  const repo = { findActiveLiveDuelForUser: jest.fn().mockResolvedValue(activeDuel ? {} : null) };
  return { redis, service: new LiveMatchmakingService(redis as any, repo as any, logger) };
}

describe('LiveMatchmakingService', () => {
  it('enqueues and reports the wait, window, and bot offer', async () => {
    const { service } = makeService(false);
    const at0 = await service.enqueue('u1', 1200, NOW);
    expect(at0.queued).toBe(true);
    expect(at0.ratingWindow).toBe(50);
    expect(at0.botOfferDue).toBe(false);

    const at20s = await service.status('u1', new Date(NOW.getTime() + 20_000));
    expect(at20s.waitedMs).toBe(20_000);
    expect(at20s.ratingWindow).toBe(200);
    expect(at20s.botOfferDue).toBe(false);

    const at30s = await service.status('u1', new Date(NOW.getTime() + 30_000));
    expect(at30s.botOfferDue).toBe(true);
  });

  it('rejects a second enqueue and queueing with an active duel', async () => {
    const { service } = makeService(false);
    await service.enqueue('u1', 1000, NOW);
    await expect(service.enqueue('u1', 1000, NOW)).rejects.toMatchObject({
      code: 'DUEL_ALREADY_QUEUED',
    });

    const busy = makeService(true);
    await expect(busy.service.enqueue('u2', 1000, NOW)).rejects.toMatchObject({
      code: 'DUEL_LIVE_ALREADY_ACTIVE',
    });
  });

  it('dequeue is idempotent and clears the status', async () => {
    const { service } = makeService(false);
    await service.enqueue('u1', 1000, NOW);
    await service.dequeue('u1');
    await service.dequeue('u1');
    const status = await service.status('u1', NOW);
    expect(status.queued).toBe(false);
  });

  it('finds the nearest opponent inside the window, not outside it', async () => {
    const { service } = makeService(false);
    await service.enqueue('u1', 1000, NOW);
    await service.enqueue('u2', 1300, NOW); // 300 away — outside ±50
    await service.enqueue('u3', 1040, NOW); // 40 away — inside ±50
    const match = await service.findOpponent('u1', NOW);
    expect(match?.opponentId).toBe('u3');
    expect(match?.ratingWindow).toBe(50);
  });

  it('widens with wait: a 150-away opponent matches after 15 s, not at 0 s', async () => {
    const { service } = makeService(false);
    await service.enqueue('u1', 1000, NOW);
    await service.enqueue('u2', 1150, NOW);
    expect(await service.findOpponent('u1', NOW)).toBeNull();
    const later = await service.findOpponent('u1', new Date(NOW.getTime() + 16_000));
    expect(later?.opponentId).toBe('u2');
    expect(later?.ratingWindow).toBe(200);
  });

  it('sweep pairs the earliest waiter with their nearest in-window opponent', async () => {
    const { service } = makeService(false);
    const t0 = NOW.getTime();
    await service.enqueue('u1', 1000, new Date(t0));
    await service.enqueue('u2', 1040, new Date(t0 + 1000));
    await service.enqueue('u3', 2000, new Date(t0 + 2000));
    const pairs = await service.sweep();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.a.userId).toBe('u1');
    expect(pairs[0]?.b.userId).toBe('u2');
  });

  it('sweep pairs a long waiter even when the newcomer’s window is narrow', async () => {
    const { service } = makeService(false);
    const t0 = NOW.getTime();
    // u1 waited 20 s (window ±200); u2 just joined (window ±50).
    await service.enqueue('u1', 1000, new Date(t0));
    await service.enqueue('u2', 1150, new Date(t0 + 20_000));
    // Sweep runs "now" = t0+20s: u1's window reaches u2.
    jest.spyOn(Date, 'now').mockReturnValue(t0 + 20_000);
    try {
      const pairs = await service.sweep();
      expect(pairs).toHaveLength(1);
      expect(pairs[0]?.a.userId).toBe('u1');
      expect(pairs[0]?.b.userId).toBe('u2');
    } finally {
      (Date.now as jest.Mock).mockRestore();
    }
  });

  it('queues are separate per variant: a LIVE waiter never matches a BLITZ waiter', async () => {
    const { service } = makeService(false);
    await service.enqueue('u-live', 1000, NOW, 'LIVE');
    await service.enqueue('u-blitz', 1000, NOW, 'BLITZ');
    // Same Rating, same moment — but different queues: no opponent, no pair.
    expect(await service.findOpponent('u-live', NOW)).toBeNull();
    expect(await service.findOpponent('u-blitz', NOW)).toBeNull();
    expect(await service.sweep()).toHaveLength(0);

    // A second BLITZ waiter matches the first BLITZ waiter — never the LIVE one.
    await service.enqueue('u-blitz-2', 1010, NOW, 'BLITZ');
    const pairs = await service.sweep();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.variant).toBe('BLITZ');
    expect([pairs[0]?.a.userId, pairs[0]?.b.userId].sort()).toEqual(['u-blitz', 'u-blitz-2']);
  });

  it('a CASE waiter never matches a LIVE or BLITZ waiter (own queue live:queue:CASE)', async () => {
    const { service } = makeService(false);
    await service.enqueue('u-live', 1000, NOW, 'LIVE');
    await service.enqueue('u-blitz', 1000, NOW, 'BLITZ');
    await service.enqueue('u-case', 1000, NOW, 'CASE');
    expect(await service.findOpponent('u-case', NOW)).toBeNull();
    expect(await service.sweep()).toHaveLength(0);
    const status = await service.status('u-case', NOW);
    expect(status.variant).toBe('CASE');

    // A second CASE waiter matches the first CASE waiter — never the others.
    await service.enqueue('u-case-2', 1010, NOW, 'CASE');
    const pairs = await service.sweep();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.variant).toBe('CASE');
    expect([pairs[0]?.a.userId, pairs[0]?.b.userId].sort()).toEqual(['u-case', 'u-case-2']);
  });

  it('a CHART waiter never matches a LIVE, BLITZ, or CASE waiter (own queue live:queue:CHART)', async () => {
    const { service } = makeService(false);
    await service.enqueue('u-live', 1000, NOW, 'LIVE');
    await service.enqueue('u-blitz', 1000, NOW, 'BLITZ');
    await service.enqueue('u-case', 1000, NOW, 'CASE');
    await service.enqueue('u-chart', 1000, NOW, 'CHART');
    expect(await service.findOpponent('u-chart', NOW)).toBeNull();
    expect(await service.sweep()).toHaveLength(0);
    const status = await service.status('u-chart', NOW);
    expect(status.variant).toBe('CHART');

    // A second CHART waiter matches the first CHART waiter — never the others.
    await service.enqueue('u-chart-2', 1010, NOW, 'CHART');
    const pairs = await service.sweep();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.variant).toBe('CHART');
    expect([pairs[0]?.a.userId, pairs[0]?.b.userId].sort()).toEqual(['u-chart', 'u-chart-2']);
  });

  it('queue status names the variant, and leaving clears that variant’s queue', async () => {
    const { service } = makeService(false);
    await service.enqueue('u1', 1000, NOW, 'BLITZ');
    const status = await service.status('u1', NOW);
    expect(status.queued).toBe(true);
    expect(status.variant).toBe('BLITZ');
    const liveStatus = await service.status('u2', NOW);
    expect(liveStatus.variant).toBeNull();

    await service.dequeue('u1');
    expect((await service.status('u1', NOW)).queued).toBe(false);
    // A BLITZ waiter who leaves does not leave a stale member behind.
    await service.enqueue('u2', 1000, NOW, 'LIVE');
    expect(await service.sweep()).toHaveLength(0);
  });

  it('one queue entry per user across variants (already queued is 409)', async () => {
    const { service } = makeService(false);
    await service.enqueue('u1', 1000, NOW, 'LIVE');
    await expect(service.enqueue('u1', 1000, NOW, 'BLITZ')).rejects.toMatchObject({
      code: 'DUEL_ALREADY_QUEUED',
    });
  });
});
