import { careerTitleFor, joinedMonthYear } from './career-title';
import { validateBio } from './bio-validation';
import { displayNameCooldown, validateDisplayName } from './display-name';

describe('careerTitleFor (docs/06 §1.7)', () => {
  it.each([
    [1000, 'Intern'],
    [1099, 'Intern'],
    [1100, 'Analyst'],
    [1299, 'Analyst'],
    [1300, 'Strategist'],
    [1499, 'Strategist'],
    [1500, 'Risk Manager'],
    [1699, 'Risk Manager'],
    [1700, 'Portfolio Manager'],
    [1899, 'Portfolio Manager'],
    [1900, 'Market Expert'],
    [2400, 'Market Expert'],
  ])('rating %i -> %s', (rating, title) => {
    expect(careerTitleFor(rating)).toBe(title);
  });

  it('joined date is month + year only, never the exact time', () => {
    expect(joinedMonthYear(new Date('2026-11-11T03:22:00.000Z'))).toBe('Nov 2026');
    expect(joinedMonthYear(new Date('2027-01-15T18:00:00.000Z'))).toBe('Jan 2027');
  });
});

describe('validateBio (docs/06 §1.3)', () => {
  it('accepts a plain short bio', () => {
    expect(validateBio('Learning money, one lesson at a time.')).toEqual([]);
  });

  it('rejects a bio over 160 chars', () => {
    const issues = validateBio('a'.repeat(161));
    expect(issues).toEqual([expect.stringContaining('at most 160')]);
  });

  it.each(['https://example.com', 'http://x.in/a', 'www.example.com', 'see example.com'])(
    'rejects a link: %s',
    (link) => {
      const issues = validateBio(`Hi, my blog is ${link}`);
      expect(issues).toEqual([expect.stringContaining('must not contain links')]);
    }
  );

  it('rejects an email address', () => {
    expect(validateBio('Mail me at nishu@example.com')).toEqual([
      expect.stringContaining('must not contain an email'),
    ]);
  });

  it.each(['98765 43210', '+91 98765 43210', 'call 9876543210'])(
    'rejects a phone number: %s',
    (phone) => {
      expect(validateBio(`Reach me on ${phone}`)).toEqual([
        expect.stringContaining('must not contain a phone number'),
      ]);
    }
  );

  it('does not flag a small number (₹45,000 is not a phone number)', () => {
    expect(validateBio('I save ₹45,000 a month and scored 100.')).toEqual([]);
  });

  it('reports every broken rule at once (per-field errors)', () => {
    const issues = validateBio('Mail nishu@example.com or call 98765 43210, see x.com');
    expect(issues).toHaveLength(3);
  });
});

describe('validateDisplayName + cooldown (docs/06 §1.3)', () => {
  it('accepts letters, numbers, and spaces', () => {
    expect(validateDisplayName('Nishu 2')).toEqual([]);
    expect(validateDisplayName('AB')).toEqual([]);
  });

  it('rejects too short, too long, and bad characters', () => {
    expect(validateDisplayName('A')).toEqual([expect.stringContaining('at least 2')]);
    expect(validateDisplayName('a'.repeat(31))).toEqual([expect.stringContaining('at most 30')]);
    expect(validateDisplayName('Carol C.')).toEqual([
      expect.stringContaining('letters, numbers, and spaces'),
    ]);
    expect(validateDisplayName('Nishu_1')).toEqual([
      expect.stringContaining('letters, numbers, and spaces'),
    ]);
  });

  it('rejects leading/trailing spaces', () => {
    expect(validateDisplayName(' Nishu')).toEqual([
      expect.stringContaining('must not start or end with a space'),
    ]);
  });

  it('first set is always allowed; 30 days later is allowed', () => {
    const now = new Date('2026-11-13T12:00:00.000Z');
    expect(displayNameCooldown(null, now)).toEqual({ allowed: true, daysRemaining: 0 });
    expect(displayNameCooldown(new Date('2026-10-14T12:00:00.000Z'), now)).toEqual({
      allowed: true,
      daysRemaining: 0,
    });
  });

  it('a change 29 days ago leaves 1 day remaining', () => {
    const now = new Date('2026-11-13T12:00:00.000Z');
    expect(displayNameCooldown(new Date('2026-10-15T12:00:00.000Z'), now)).toEqual({
      allowed: false,
      daysRemaining: 1,
    });
  });
});
