import { istDayStartUtc, isValidIstDate, kolkataDateString } from './duel-dates';

describe('duel-dates (ADR 0006/6 — the Daily Duel day is IST, not UTC)', () => {
  it('maps 00:30 IST to the new IST day (still the previous UTC day)', () => {
    // 2026-11-11T00:30:00+05:30 = 2026-11-10T19:00:00Z
    expect(kolkataDateString(new Date('2026-11-10T19:00:00.000Z'))).toBe('2026-11-11');
    expect(kolkataDateString(new Date('2026-11-10T18:29:59.999Z'))).toBe('2026-11-10');
    expect(kolkataDateString(new Date('2026-11-10T18:30:00.000Z'))).toBe('2026-11-11');
  });

  it('istDayStartUtc is IST midnight (18:30 UTC the previous day)', () => {
    expect(istDayStartUtc(new Date('2026-11-11T10:00:00.000Z')).toISOString()).toBe(
      '2026-11-10T18:30:00.000Z'
    );
    expect(istDayStartUtc(new Date('2026-11-11T00:30:00.000Z')).toISOString()).toBe(
      '2026-11-10T18:30:00.000Z'
    );
  });

  it('validates IST date strings', () => {
    expect(isValidIstDate('2026-11-11')).toBe(true);
    expect(isValidIstDate('2026-02-30')).toBe(false);
    expect(isValidIstDate('2026-13-01')).toBe(false);
    expect(isValidIstDate('11-11-2026')).toBe(false);
    expect(isValidIstDate('2026-11-1')).toBe(false);
  });
});
