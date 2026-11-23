import {
  dateInTimezone,
  isInQuietHours,
  isValidHHMM,
  isValidTimezone,
  minutesInTimezone,
  parseHHMM,
  streakReminderDue,
} from './quiet-hours';

describe('quiet hours + streak reminder (docs/06 §2.3)', () => {
  it('parses HH:MM and rejects malformed values', () => {
    expect(parseHHMM('22:00')).toBe(1320);
    expect(parseHHMM('08:00')).toBe(480);
    expect(parseHHMM('00:00')).toBe(0);
    expect(() => parseHHMM('24:00')).toThrow();
    expect(() => parseHHMM('9:00')).toThrow();
    expect(() => parseHHMM('22:60')).toThrow();
    expect(isValidHHMM('19:00')).toBe(true);
    expect(isValidHHMM('7pm')).toBe(false);
  });

  it('validates IANA timezone names', () => {
    expect(isValidTimezone('Asia/Kolkata')).toBe(true);
    expect(isValidTimezone('America/New_York')).toBe(true);
    expect(isValidTimezone('Not/AZone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
  });

  it('reads the clock in the user timezone (IST is UTC+5:30)', () => {
    // 13:30 UTC = 19:00 IST.
    const at = new Date('2026-11-13T13:30:00.000Z');
    expect(minutesInTimezone(at, 'Asia/Kolkata')).toBe(19 * 60);
    expect(minutesInTimezone(at, 'UTC')).toBe(13 * 60 + 30);
    expect(dateInTimezone(at, 'Asia/Kolkata')).toBe('2026-11-13');
    // 20:00 UTC = 01:30 IST the NEXT day.
    expect(dateInTimezone(new Date('2026-11-13T20:00:00.000Z'), 'Asia/Kolkata')).toBe('2026-11-14');
  });

  it('quiet hours wrap midnight (22:00–08:00)', () => {
    const tz = 'Asia/Kolkata';
    // 23:00 IST: inside. 07:59 IST: inside. 12:00 IST: outside.
    expect(isInQuietHours(new Date('2026-11-13T17:30:00.000Z'), '22:00', '08:00', tz)).toBe(true);
    expect(isInQuietHours(new Date('2026-11-13T02:29:00.000Z'), '22:00', '08:00', tz)).toBe(true);
    expect(isInQuietHours(new Date('2026-11-13T06:30:00.000Z'), '22:00', '08:00', tz)).toBe(false);
  });

  it('quiet hours that do not wrap, and start == end means none', () => {
    const tz = 'UTC';
    expect(isInQuietHours(new Date('2026-11-13T13:00:00.000Z'), '12:00', '14:00', tz)).toBe(true);
    expect(isInQuietHours(new Date('2026-11-13T15:00:00.000Z'), '12:00', '14:00', tz)).toBe(false);
    expect(isInQuietHours(new Date('2026-11-13T13:00:00.000Z'), '08:00', '08:00', tz)).toBe(false);
  });

  it('streak reminder is due at 19:00 IST when enabled and not yet sent today', () => {
    const base = {
      enabled: true,
      reminderTime: '19:00',
      timezone: 'Asia/Kolkata',
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      lastSentAt: new Date('2026-11-12T13:30:00.000Z'), // yesterday 19:00 IST
    };
    expect(streakReminderDue(base, new Date('2026-11-13T13:30:00.000Z'))).toEqual({
      due: true,
      reason: 'DUE',
    });
  });

  it('streak reminder is not due before its time, when disabled, or when already sent', () => {
    const base = {
      enabled: true,
      reminderTime: '19:00',
      timezone: 'Asia/Kolkata',
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      lastSentAt: null,
    };
    expect(streakReminderDue(base, new Date('2026-11-13T12:00:00.000Z'))).toEqual({
      due: false,
      reason: 'NOT_YET_TIME',
    });
    expect(
      streakReminderDue({ ...base, enabled: false }, new Date('2026-11-13T13:30:00.000Z'))
    ).toEqual({
      due: false,
      reason: 'DISABLED',
    });
    expect(
      streakReminderDue(
        { ...base, lastSentAt: new Date('2026-11-13T13:30:00.000Z') },
        new Date('2026-11-13T14:00:00.000Z')
      )
    ).toEqual({ due: false, reason: 'ALREADY_SENT_TODAY' });
  });

  it('a reminder time inside quiet hours never fires (quiet hours win)', () => {
    const check = {
      enabled: true,
      reminderTime: '23:00',
      timezone: 'Asia/Kolkata',
      quietHoursStart: '22:00',
      quietHoursEnd: '08:00',
      lastSentAt: null,
    };
    expect(streakReminderDue(check, new Date('2026-11-13T17:30:00.000Z'))).toEqual({
      due: false,
      reason: 'QUIET_HOURS',
    });
  });
});
