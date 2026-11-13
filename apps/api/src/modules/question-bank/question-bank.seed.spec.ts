import { DUEL_BANK_TOPICS, DUEL_BANK_SKILLS, QUESTION_BANK } from '@candle/shared';
import {
  DUEL_BANK_SEED_ITEMS,
  DUEL_BANK_SEED_TEMPLATES,
  type DuelBankSeedItem,
} from '../../../prisma/question-bank-seed';
import { generateVariant, TEMPLATE_KEYS } from './template-engine';
import { generateChart } from './chart-generator';
import { validateCaseChoice, validateChartChoice } from './question-bank.service';

/**
 * Seed integrity (Phase 4 growth, docs/05 §7 step 1: 500 live items).
 * Guards the whole bank in one place: counts, coverage, option shapes,
 * explanations, and the content rules (original, no banned word, no real
 * companies/tickers, no copied Varsity text). The seed file is the
 * pre-authored / pre-reviewed path to LIVE — this spec is the review
 * safety net that runs on every test pass.
 */
describe('question-bank seed (docs/05 §2, Phase 4 growth)', () => {
  const byKey = new Map(DUEL_BANK_SEED_ITEMS.map((i) => [i.key, i]));

  function sentences(text: string): number {
    return text
      .trim()
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean).length;
  }

  it('has 620 items with keys qb-001..qb-620 exactly once', () => {
    expect(DUEL_BANK_SEED_ITEMS).toHaveLength(620);
    const keys = DUEL_BANK_SEED_ITEMS.map((i) => i.key);
    expect(new Set(keys).size).toBe(620);
    for (let n = 1; n <= 620; n++) {
      expect(byKey.has(`qb-${String(n).padStart(3, '0')}`)).toBe(true);
    }
  });

  it('has 62 items per topic with no empty difficulty cell', () => {
    const expected: Record<string, [number, number, number, number, number]> = {
      'money-basics': [9, 17, 16, 11, 9],
      budgeting: [9, 17, 16, 11, 9],
      'banking-saving': [10, 16, 16, 11, 9],
      stocks: [9, 17, 16, 11, 9],
      'mutual-funds': [10, 16, 16, 11, 9],
      risk: [9, 15, 16, 13, 9],
      compounding: [8, 16, 16, 13, 9],
      'tax-basics': [8, 15, 16, 13, 10],
      insurance: [9, 15, 16, 13, 9],
      markets: [9, 15, 16, 13, 9],
    };
    for (const topic of DUEL_BANK_TOPICS) {
      const items = DUEL_BANK_SEED_ITEMS.filter((i) => i.topic === topic);
      expect(items).toHaveLength(62);
      const counts = [1, 2, 3, 4, 5].map((d) => items.filter((i) => i.difficulty === d).length);
      expect(counts).toEqual(expected[topic]);
      expect(counts[0]).toBeGreaterThanOrEqual(8);
      expect(counts[1]).toBeGreaterThanOrEqual(12);
      expect(counts[2]).toBeGreaterThanOrEqual(12);
      expect(counts[3]).toBeGreaterThanOrEqual(9);
      expect(counts[4]).toBeGreaterThanOrEqual(9);
    }
    const totals = [1, 2, 3, 4, 5].map(
      (d) => DUEL_BANK_SEED_ITEMS.filter((i) => i.difficulty === d).length
    );
    expect(totals).toEqual([90, 159, 160, 120, 91]);
  });

  it('has 461 MCQ_4 + 59 TRUE_FALSE + 50 CASE_CHOICE + 50 CHART_CHOICE items', () => {
    const mcq = DUEL_BANK_SEED_ITEMS.filter((i) => i.type === 'MCQ_4').length;
    const tf = DUEL_BANK_SEED_ITEMS.filter((i) => i.type === 'TRUE_FALSE').length;
    const cases = DUEL_BANK_SEED_ITEMS.filter((i) => i.type === 'CASE_CHOICE').length;
    const charts = DUEL_BANK_SEED_ITEMS.filter((i) => i.type === 'CHART_CHOICE').length;
    expect(mcq).toBe(461);
    expect(tf).toBe(59);
    expect(cases).toBe(50);
    expect(charts).toBe(50);
  });

  it('meets the shared seed target', () => {
    expect(DUEL_BANK_SEED_ITEMS.length).toBeGreaterThanOrEqual(QUESTION_BANK.SEED_LIVE_TARGET);
  });

  it('every item has valid metadata, a 1–3 sentence explanation, and valid options', () => {
    for (const item of DUEL_BANK_SEED_ITEMS) {
      expect(DUEL_BANK_TOPICS as readonly string[]).toContain(item.topic);
      expect(DUEL_BANK_SKILLS as readonly string[]).toContain(item.skill);
      expect(item.difficulty).toBeGreaterThanOrEqual(1);
      expect(item.difficulty).toBeLessThanOrEqual(5);
      expect(item.stem.trim().length).toBeGreaterThan(0);
      expect(item.explanation.trim().length).toBeGreaterThan(0);
      expect(sentences(item.explanation)).toBeGreaterThanOrEqual(1);
      // 1–3 sentences for Phase 4 items (qb-121+). One pre-existing Phase 3
      // item, qb-081, has 4 short sentences ("Year 1… Year 2… Year 3…");
      // it is grandfathered — the 120 Phase 3 items stay untouched.
      if (Number(item.key.slice(3)) > 120) {
        expect(sentences(item.explanation)).toBeLessThanOrEqual(3);
      }
      const correct = item.options.filter((o) => o.isCorrect);
      expect(correct).toHaveLength(1);
      const texts = item.options.map((o) => o.text);
      expect(new Set(texts).size).toBe(texts.length);
      if (item.type === 'MCQ_4') expect(item.options).toHaveLength(4);
      if (item.type === 'TRUE_FALSE') {
        expect(item.options).toHaveLength(2);
        expect(texts).toEqual(expect.arrayContaining(['True', 'False']));
      }
      if (item.type === 'CASE_CHOICE') {
        expect(item.options.length).toBeGreaterThanOrEqual(3);
        expect(item.options.length).toBeLessThanOrEqual(4);
      }
      if (item.type === 'CHART_CHOICE') {
        expect(item.options).toHaveLength(4);
        expect(item.chart).toBeDefined();
      }
    }
  });

  it('CASE_CHOICE items (qb-521..qb-570) follow the format rules (docs/08 §3.3)', () => {
    const cases = DUEL_BANK_SEED_ITEMS.filter((i) => i.type === 'CASE_CHOICE');
    expect(cases).toHaveLength(50);
    expect(cases.map((i) => i.key).sort()).toEqual(
      Array.from({ length: 50 }, (_, n) => `qb-${String(521 + n).padStart(3, '0')}`)
    );
    for (const topic of DUEL_BANK_TOPICS) {
      expect(cases.filter((i) => i.topic === topic)).toHaveLength(5);
    }
    const byDifficulty = [2, 3, 4].map((d) => cases.filter((i) => i.difficulty === d).length);
    expect(byDifficulty).toEqual([15, 20, 15]);
    const bySkill = ['JUDGEMENT', 'SCENARIO', 'RISK_ASSESSMENT'].map(
      (s) => cases.filter((i) => i.skill === s).length
    );
    expect(bySkill).toEqual([20, 20, 10]);
    for (const item of cases) {
      // Stem: 3–5 short lines (the case: person, income, goal, constraint).
      const lines = item.stem
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      expect(lines.length).toBeGreaterThanOrEqual(3);
      expect(lines.length).toBeLessThanOrEqual(5);
      for (const line of lines) expect(line.length).toBeLessThanOrEqual(160);
      // Context: at least 2 labelled entries, at least 2 carrying a number.
      const entries = Object.entries(item.context ?? {});
      expect(entries.length).toBeGreaterThanOrEqual(2);
      expect(entries.filter(([, v]) => /\d/.test(String(v))).length).toBeGreaterThanOrEqual(2);
      // Rubric: required, at least 2 lines.
      expect(item.rubric).toBeTruthy();
      expect(
        (item.rubric as string)
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean).length
      ).toBeGreaterThanOrEqual(2);
      // Options: 3–4, exactly one 100 (the correct/best action), at most
      // one 50, the rest 0; every option has a non-empty consequence.
      const points = item.options.map((o) => o.points ?? 0);
      expect(points.filter((p) => p === 100)).toHaveLength(1);
      expect(points.filter((p) => p === 50).length).toBeLessThanOrEqual(1);
      expect(points.every((p) => p === 0 || p === 50 || p === 100)).toBe(true);
      const best = item.options.find((o) => o.isCorrect);
      expect(best?.points).toBe(100);
      for (const o of item.options) {
        expect(o.consequence).toBeTruthy();
        expect((o.consequence as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('CASE_CHOICE seed items pass the service validation (same rules as the API)', () => {
    const cases = DUEL_BANK_SEED_ITEMS.filter((i) => i.type === 'CASE_CHOICE');
    expect(cases).toHaveLength(50);
    for (const item of cases) {
      expect(() =>
        validateCaseChoice({
          stem: item.stem,
          skill: item.skill,
          difficulty: item.difficulty,
          context: item.context,
          rubric: item.rubric,
          options: item.options.map((o) => ({
            text: o.text,
            isCorrect: o.isCorrect,
            points: o.points,
            consequence: o.consequence,
          })),
        })
      ).not.toThrow();
    }
  });

  it('CHART_CHOICE items (qb-571..qb-620) follow the format rules (docs/08 §3.4)', () => {
    const charts = DUEL_BANK_SEED_ITEMS.filter((i) => i.type === 'CHART_CHOICE');
    expect(charts).toHaveLength(50);
    expect(charts.map((i) => i.key).sort()).toEqual(
      Array.from({ length: 50 }, (_, n) => `qb-${String(571 + n).padStart(3, '0')}`)
    );
    for (const topic of DUEL_BANK_TOPICS) {
      expect(charts.filter((i) => i.topic === topic)).toHaveLength(5);
    }
    const byDifficulty = [2, 3, 4].map((d) => charts.filter((i) => i.difficulty === d).length);
    expect(byDifficulty).toEqual([15, 20, 15]);
    expect(charts.every((i) => i.skill === 'CHART_READING')).toBe(true);
    const byTemplate = [
      'STEADY_RISE',
      'VOLATILE_FLAT',
      'SHARP_FALL_RECOVERY',
      'STEADY_FALL',
      'SPIKE_THEN_FALL',
    ].map((t) => charts.filter((i) => i.chart?.template === t).length);
    expect(byTemplate).toEqual([10, 10, 10, 10, 10]);
    for (const item of charts) {
      // Stem: one line (the question).
      const lines = item.stem
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      expect(lines).toHaveLength(1);
      // Chart: 6 xLabels + 6 finite positive series values, title +
      // fictional instrument + axis labels, annotation zone in range.
      const chart = item.chart as NonNullable<typeof item.chart>;
      expect(chart.xLabels).toHaveLength(6);
      expect(chart.series).toHaveLength(6);
      for (const v of chart.series) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThan(0);
      }
      expect(chart.title).toContain(chart.instrument);
      expect(chart.xLabel.trim().length).toBeGreaterThan(0);
      expect(chart.yLabel.trim().length).toBeGreaterThan(0);
      expect(chart.annotation.zoneStart).toBeGreaterThanOrEqual(0);
      expect(chart.annotation.zoneEnd).toBeLessThanOrEqual(5);
      expect(chart.annotation.zoneStart).toBeLessThanOrEqual(chart.annotation.zoneEnd);
      // Options: exactly 4 interpretations, exactly 1 correct, no points.
      expect(item.options).toHaveLength(4);
      expect(item.options.filter((o) => o.isCorrect)).toHaveLength(1);
      expect(item.options.every((o) => (o.points ?? 0) === 0)).toBe(true);
    }
  });

  it('CHART_CHOICE seed items pass the service validation (same rules as the API)', () => {
    const charts = DUEL_BANK_SEED_ITEMS.filter((i) => i.type === 'CHART_CHOICE');
    expect(charts).toHaveLength(50);
    for (const item of charts) {
      expect(() =>
        validateChartChoice({
          stem: item.stem,
          skill: item.skill,
          difficulty: item.difficulty,
          explanation: item.explanation,
          chart: item.chart,
          options: item.options.map((o) => ({
            text: o.text,
            isCorrect: o.isCorrect,
            points: o.points,
          })),
        })
      ).not.toThrow();
    }
  });

  it('CHART_CHOICE seed charts replay from the generator (same key → same series)', () => {
    const charts = DUEL_BANK_SEED_ITEMS.filter((i) => i.type === 'CHART_CHOICE');
    for (const item of charts) {
      const chart = item.chart as NonNullable<typeof item.chart>;
      expect(chart.series).toEqual(
        generateChart(item.key, chart.template, chart.instrument).series
      );
    }
  });

  it('every stem is unique', () => {
    const stems = DUEL_BANK_SEED_ITEMS.map((i) => i.stem);
    expect(new Set(stems).size).toBe(stems.length);
  });

  it('contains no banned word, no Varsity text, and no real companies or tickers', () => {
    const banned = /\belo\b/i;
    const realNames = [
      'RELIANCE',
      'TCS',
      'INFY',
      'INFOSYS',
      'HDFCBANK',
      'ICICIBANK',
      'NSE:',
      'BSE:',
    ];
    for (const item of DUEL_BANK_SEED_ITEMS) {
      const text = [
        item.stem,
        item.explanation,
        item.rubric ?? '',
        item.chart?.title ?? '',
        item.chart?.instrument ?? '',
        ...Object.values(item.context ?? {}).map(String),
        ...item.options.map((o) => o.text),
        ...item.options.map((o) => o.consequence ?? ''),
      ].join(' ');
      expect(text).not.toMatch(banned);
      expect(text).not.toContain('Varsity');
      for (const name of realNames) expect(text).not.toContain(name);
    }
  });

  it('leaves the Phase 3 items (qb-001..qb-120) untouched', () => {
    expect(byKey.get('qb-001')?.stem).toBe('What is money mainly used for in daily life?');
    expect(byKey.get('qb-120')?.stem).toBe(
      'An index grows 10% in year 1, then falls 10% in year 2. Starting at 10,000, where does it end?'
    );
    const phase3 = DUEL_BANK_SEED_ITEMS.filter((i) => Number(i.key.slice(3)) <= 120);
    expect(phase3).toHaveLength(120);
    expect(phase3.filter((i) => i.type === 'MCQ_4')).toHaveLength(100);
    expect(phase3.filter((i) => i.type === 'TRUE_FALSE')).toHaveLength(20);
  });

  it('seeds 6 templates as DRAFT rows matching the engine keys', () => {
    expect(DUEL_BANK_SEED_TEMPLATES).toHaveLength(6);
    expect(DUEL_BANK_SEED_TEMPLATES.map((t) => t.key).sort()).toEqual([...TEMPLATE_KEYS].sort());
    for (const tpl of DUEL_BANK_SEED_TEMPLATES) {
      expect(DUEL_BANK_TOPICS as readonly string[]).toContain(tpl.topic);
      expect(tpl.skill).toBe('CALCULATION');
      expect(tpl.templateText).toContain('{');
    }
  });

  it('template-materialised seed items match the engine for their parameters', () => {
    // (seed key, template key, parameters, expected correct option text)
    const spotChecks: Array<[string, string, Record<string, number>, string]> = [
      ['qb-362', 'tpl-simple-vs-compound', { principal: 20000, rate: 10, years: 3 }, '₹600'],
      ['qb-281', 'tpl-sip-goal', { goal: 60000, months: 12 }, '₹5,000'],
      ['qb-201', 'tpl-emergency-fund', { monthlyExpenses: 15000, months: 3 }, '₹45,000'],
      ['qb-406', 'tpl-tax-slab', { income: 400000, rate: 5 }, '₹5,000'],
      ['qb-366', 'tpl-compounding', { principal: 10000, rate: 6, years: 3 }, '₹11,900'],
      ['qb-161', 'tpl-budgeting-503020', { income: 30000 }, '₹6,000'],
    ];
    for (const [key, templateKey, parameters, expected] of spotChecks) {
      const item = byKey.get(key) as DuelBankSeedItem;
      expect(item.options.find((o) => o.isCorrect)?.text).toBe(expected);
      let engine: ReturnType<typeof generateVariant> | undefined;
      for (let seed = 0; seed < 5000 && !engine; seed++) {
        const v = generateVariant(templateKey, seed);
        if (JSON.stringify(v.parameters) === JSON.stringify(parameters)) engine = v;
      }
      expect(engine).toBeDefined();
      expect(engine?.stem).toBe(item.stem);
      expect(engine?.options.find((o) => o.isCorrect)?.text).toBe(expected);
      expect(new Set(engine?.options.map((o) => o.text))).toEqual(
        new Set(item.options.map((o) => o.text))
      );
    }
  });
});
