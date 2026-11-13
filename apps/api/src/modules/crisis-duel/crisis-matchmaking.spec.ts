import { DuelType } from '@prisma/client';
import { CrisisMatchmakingService } from './crisis-matchmaking.service';

/**
 * Crisis matchmaking — docs/15 §6 (Phase 10).
 * The mirror of the sprint matchmaking spec, on the crisis keyspace.
 * A crisis waiter is never matched into a sprint: the queue key is
 * crisis:queue and the sweep only ever pairs crisis waiters.
 * Fake Redis implements only the sorted-set + string ops the service
 * uses. The fake repo answers findActiveTradingDuelForUser per type.
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

function makeService(
  opts: { activeCrisis?: boolean; activeSprint?: boolean; activeLiveDuel?: boolean } = {}
) {
  const redis = new FakeRedis();
  const repo = {
    findActiveTradingDuelForUser: jest
      .fn()
      .mockImplementation(async (_userId: string, type: DuelType) => {
        if (type === DuelType.CRISIS) return opts.activeCrisis ? {} : null;
        if (type === DuelType.SPRINT) return opts.activeSprint ? {} : null;
        return null;
      }),
  };
  const live = {
    activeDuelSummary: jest
      .fn()
      .mockResolvedValue(opts.activeLiveDuel ? { duelId: 'live-1' } : null),
  };
  return {
    redis,
    service: new CrisisMatchmakingService(redis as never, repo as never, live as never, logger),
  };
}

describe('CrisisMatchmakingService', () => {
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

  it('rejects a second enqueue, an active crisis, an active sprint, and an active live duel', async () => {
    const { service } = makeService();
    await service.enqueue('u1', 1000, NOW);
    await expect(service.enqueue('u1', 1000, NOW)).rejects.toMatchObject({
      code: 'CRISIS_ALREADY_QUEUED',
    });

    const withCrisis = makeService({ activeCrisis: true });
    await expect(withCrisis.service.enqueue('u1', 1000, NOW)).rejects.toMatchObject({
      code: 'CRISIS_ALREADY_ACTIVE',
    });

    const withSprint = makeService({ activeSprint: true });
    await expect(withSprint.service.enqueue('u1', 1000, NOW)).rejects.toMatchObject({
      code: 'SPRINT_ALREADY_ACTIVE',
    });

    const withLive = makeService({ activeLiveDuel: true });
    await expect(withLive.service.enqueue('u1', 1000, NOW)).rejects.toMatchObject({
      code: 'DUEL_LIVE_ALREADY_ACTIVE',
    });
  });

  it('dequeue is idempotent and status reports not-queued', async () => {
    const { service } = makeService();
    await service.dequeue('u1');
    const status = await service.status('u1', NOW);
    expect(status.queued).toBe(false);
    expect(status.rating).toBeNull();
  });

  it('findOpponent returns the nearest in-window waiter, never the caller', async () => {
    const { service } = makeService();
    await service.enqueue('u1', 1000, NOW);
    await service.enqueue('u2', 1010, NOW);
    await service.enqueue('u3', 1200, NOW);
    const opp = await service.findOpponent('u1', NOW);
    expect(opp?.opponentId).toBe('u2');
    expect(opp?.opponentRating).toBe(1010);
    const far = await service.findOpponent('u3', NOW);
    expect(far).toBeNull(); // u1/u2 are outside u3's ±50 window
  });

  it('sweep pairs earliest-first by nearest Rating, in the window', async () => {
    const { service } = makeService();
    await service.enqueue('u1', 1000, NOW);
    await service.enqueue('u2', 1030, NOW);
    await service.enqueue('u3', 1400, NOW);
    const pairs = await service.sweep();
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.a.userId).toBe('u1');
    expect(pairs[0]!.b.userId).toBe('u2');
  });

  it('sweep skips stale members whose entry expired', async () => {
    const { redis, service } = makeService();
    await service.enqueue('u1', 1000, NOW);
    // Stale member: in the zset, but no entry key.
    await redis.zadd('crisis:queue', 1010, 'ghost');
    const pairs = await service.sweep();
    expect(pairs).toHaveLength(0);
  });

  it('queues on the crisis keyspace, never the sprint keyspace', async () => {
    const { redis, service } = makeService();
    await service.enqueue('u1', 1000, NOW);
    // A crisis waiter must not appear in the sprint queue, and vice
    // versa: the two services share only the fake Redis shape.
    expect(await redis.get('crisis:queue-entry:u1')).not.toBeNull();
    expect(await redis.get('sprint:queue-entry:u1')).toBeNull();
    expect(await redis.zrangebyscore('sprint:queue', -Infinity, Infinity)).toEqual([]);
    expect(await redis.zrangebyscore('crisis:queue', -Infinity, Infinity)).toEqual(['u1', '1000']);
  });
});
