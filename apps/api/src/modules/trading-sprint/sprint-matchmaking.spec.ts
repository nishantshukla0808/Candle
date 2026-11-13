import { SprintMatchmakingService } from './sprint-matchmaking.service';

/**
 * Sprint matchmaking — docs/14 §4 (ADR 0011 §4).
 * One queue, sorted by Trading Rating. A sprint waiter is never
 * matched into a learning duel: the queue key is sprint:queue and the
 * engine only ever pairs sprint waiters. Fake Redis implements only
 * the sorted-set + string ops the service uses.
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
const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as never;

function makeService(opts: { activeSprint?: boolean; activeLiveDuel?: boolean } = {}) {
  const redis = new FakeRedis();
  const repo = {
    findActiveSprintForUser: jest.fn().mockResolvedValue(opts.activeSprint ? {} : null),
  };
  const live = {
    activeDuelSummary: jest
      .fn()
      .mockResolvedValue(opts.activeLiveDuel ? { duelId: 'live-1' } : null),
  };
  return {
    redis,
    service: new SprintMatchmakingService(redis as never, repo as never, live as never, logger),
  };
}

describe('SprintMatchmakingService', () => {
  it('enqueues and reports the wait, window, and bot offer', async () => {
    const { service } = makeService();
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

  it('rejects a second enqueue, an active sprint, and an active live duel', async () => {
    const { service } = makeService();
    await service.enqueue('u1', 1000, NOW);
    await expect(service.enqueue('u1', 1000, NOW)).rejects.toMatchObject({
      code: 'SPRINT_ALREADY_QUEUED',
    });

    const busySprint = makeService({ activeSprint: true });
    await expect(busySprint.service.enqueue('u2', 1000, NOW)).rejects.toMatchObject({
      code: 'SPRINT_ALREADY_ACTIVE',
    });

    const busyLive = makeService({ activeLiveDuel: true });
    await expect(busyLive.service.enqueue('u3', 1000, NOW)).rejects.toMatchObject({
      code: 'DUEL_LIVE_ALREADY_ACTIVE',
    });
  });

  it('dequeue is idempotent and clears the status', async () => {
    const { service } = makeService();
    await service.enqueue('u1', 1000, NOW);
    await service.dequeue('u1');
    await service.dequeue('u1');
    const status = await service.status('u1', NOW);
    expect(status.queued).toBe(false);
  });

  it('finds the nearest opponent inside the window, not outside it', async () => {
    const { service } = makeService();
    await service.enqueue('u1', 1000, NOW);
    await service.enqueue('u2', 1300, NOW); // 300 away — outside ±50
    await service.enqueue('u3', 1040, NOW); // 40 away — inside ±50
    const match = await service.findOpponent('u1', NOW);
    expect(match?.opponentId).toBe('u3');
    expect(match?.ratingWindow).toBe(50);
  });

  it('widens with wait: a 150-away opponent matches after 15 s, not at 0 s', async () => {
    const { service } = makeService();
    await service.enqueue('u1', 1000, NOW);
    await service.enqueue('u2', 1150, NOW);
    expect(await service.findOpponent('u1', NOW)).toBeNull();
    const later = await service.findOpponent('u1', new Date(NOW.getTime() + 16_000));
    expect(later?.opponentId).toBe('u2');
    expect(later?.ratingWindow).toBe(200);
  });

  it('sweep pairs the earliest waiter with their nearest in-window opponent', async () => {
    const { service } = makeService();
    const t0 = NOW.getTime();
    await service.enqueue('u1', 1000, new Date(t0));
    await service.enqueue('u2', 1040, new Date(t0 + 1000));
    await service.enqueue('u3', 2000, new Date(t0 + 2000));
    const pairs = await service.sweep();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]?.a.userId).toBe('u1');
    expect(pairs[0]?.b.userId).toBe('u2');
  });

  it('sweep skips stale entries (entry row missing) and pairs the rest', async () => {
    const { service } = makeService();
    const t0 = NOW.getTime();
    await service.enqueue('u1', 1000, new Date(t0));
    await service.enqueue('u2', 1040, new Date(t0 + 1000));
    // Simulate a crashed enqueue: remove u1's entry row but leave the zset member.
    await service.dequeue('u1');
    await service.enqueue('u1', 1000, new Date(t0));
    await (service as unknown as { redis: FakeRedis }).redis.del('sprint:queue-entry:u1');
    const pairs = await service.sweep();
    // u1 is stale and skipped; u2 has nobody left.
    expect(pairs).toHaveLength(0);
  });
});
