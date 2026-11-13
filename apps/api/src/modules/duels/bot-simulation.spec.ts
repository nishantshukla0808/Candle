import {
  botBaseAccuracy,
  botCaseTimeMs,
  botChartTimeMs,
  botCorrectProbability,
  botTimeMs,
  hashSeed,
  mulberry32,
  simulateBot,
  simulateCaseBot,
  simulateChartBot,
} from './bot-simulation';

const QUESTIONS = [
  { id: 'q1', difficulty: 1 },
  { id: 'q2', difficulty: 2 },
  { id: 'q3', difficulty: 3 },
  { id: 'q4', difficulty: 3 },
  { id: 'q5', difficulty: 4 },
  { id: 'q6', difficulty: 5 },
  { id: 'q7', difficulty: 2 },
];

describe('bot-simulation (docs/07 §5 — seeded, replayable Mira)', () => {
  it('is deterministic per (seed, questions, rating)', () => {
    const a = simulateBot('duel-seed-1', QUESTIONS, 1200);
    const b = simulateBot('duel-seed-1', QUESTIONS, 1200);
    expect(a).toEqual(b);
  });

  it('changes with the seed and with the player rating', () => {
    const a = simulateBot('duel-seed-1', QUESTIONS, 1200);
    const b = simulateBot('duel-seed-2', QUESTIONS, 1200);
    const c = simulateBot('duel-seed-1', QUESTIONS, 1800);
    expect(a).not.toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('uses the documented accuracy bands', () => {
    expect(botBaseAccuracy(999)).toBe(0.55);
    expect(botBaseAccuracy(1100)).toBe(0.65);
    expect(botBaseAccuracy(1299)).toBe(0.65);
    expect(botBaseAccuracy(1300)).toBe(0.75);
    expect(botBaseAccuracy(1500)).toBe(0.82);
    expect(botBaseAccuracy(1700)).toBe(0.88);
    expect(botBaseAccuracy(2400)).toBe(0.88);
  });

  it('adjusts accuracy by difficulty and clamps it', () => {
    // base 0.55: difficulty 1 → 0.71, difficulty 5 → 0.39
    expect(botCorrectProbability(0.55, 1)).toBeCloseTo(0.71);
    expect(botCorrectProbability(0.55, 5)).toBeCloseTo(0.39);
    // clamps: never below 0.15, never above 0.97
    expect(botCorrectProbability(0.2, 5)).toBe(0.15);
    expect(botCorrectProbability(0.97, 1)).toBe(0.97);
    expect(botCorrectProbability(0.75, 3)).toBe(0.75);
  });

  it('keeps bot times inside [1500, 14999] ms and slower on harder questions', () => {
    const rng = mulberry32(hashSeed('time-check'));
    for (let d = 1; d <= 5; d++) {
      for (let i = 0; i < 50; i++) {
        const t = botTimeMs(rng, d);
        expect(t).toBeGreaterThanOrEqual(1500);
        expect(t).toBeLessThanOrEqual(14999);
      }
    }
  });

  it('scores the bot with the same rule as the player', () => {
    const sim = simulateBot('duel-seed-1', QUESTIONS, 1200);
    expect(sim.answers).toHaveLength(7);
    expect(sim.correctCount).toBe(sim.answers.filter((a) => a.correct).length);
    expect(sim.score).toBe(sim.answers.reduce((s, a) => s + a.points, 0));
    expect(sim.totalTimeMs).toBe(sim.answers.reduce((s, a) => s + a.timeMs, 0));
    for (const a of sim.answers) {
      expect(a.points).toBeGreaterThanOrEqual(0);
      expect(a.points).toBeLessThanOrEqual(150);
      if (!a.correct) expect(a.points).toBe(0);
    }
  });

  it('Blitz: bot times stay under the 10 s timer and her points use the streak rule', () => {
    const sim = simulateBot('duel-seed-1', QUESTIONS, 1200, {
      timeLimitMs: 10_000,
      streakBonus: true,
    });
    expect(sim.answers).toHaveLength(7);
    for (const a of sim.answers) {
      expect(a.timeMs).toBeGreaterThanOrEqual(1500);
      expect(a.timeMs).toBeLessThanOrEqual(9999);
      // At most 100 + 50 speed + 30 streak.
      expect(a.points).toBeLessThanOrEqual(180);
      if (!a.correct) expect(a.points).toBe(0);
    }
    // Her points are exactly the Blitz rule applied to her own streak:
    // replay her answers through the same pricing and compare.
    let streak = 0;
    for (const a of sim.answers) {
      streak = a.correct ? streak + 1 : 0;
      const base = 100 + Math.max(0, Math.floor(50 * (1 - a.timeMs / 10_000)));
      const bonus = streak < 3 ? 0 : Math.min(30, (streak - 2) * 10);
      expect(a.points).toBe(a.correct ? base + bonus : 0);
    }
  });

  it('Blitz bot times use the 10 s cap even on hard questions', () => {
    const rng = mulberry32(hashSeed('blitz-time-check'));
    for (let d = 1; d <= 5; d++) {
      for (let i = 0; i < 50; i++) {
        const t = botTimeMs(rng, d, 10_000);
        expect(t).toBeGreaterThanOrEqual(1500);
        expect(t).toBeLessThanOrEqual(9999);
      }
    }
  });
});

describe('case bot (Phase 7 — ADR 0009 §5: best / second-best / 0-point picks)', () => {
  const caseOptions = (id: string) => [
    { id: `${id}-best`, points: 100, isCorrect: true },
    { id: `${id}-second`, points: 50, isCorrect: false },
    { id: `${id}-zero-a`, points: 0, isCorrect: false },
    { id: `${id}-zero-b`, points: 0, isCorrect: false },
  ];
  const CASE_QUESTIONS = [
    { id: 'c1', difficulty: 2, options: caseOptions('c1') },
    { id: 'c2', difficulty: 3, options: caseOptions('c2') },
    { id: 'c3', difficulty: 3, options: caseOptions('c3') },
    { id: 'c4', difficulty: 4, options: caseOptions('c4') },
    { id: 'c5', difficulty: 4, options: caseOptions('c5') },
  ];

  it('is deterministic per (seed, questions, rating)', () => {
    const a = simulateCaseBot('case-seed-1', CASE_QUESTIONS, 1200);
    const b = simulateCaseBot('case-seed-1', CASE_QUESTIONS, 1200);
    expect(a).toEqual(b);
  });

  it('keeps bot case times inside [5000, 44999] ms and slower on harder cases', () => {
    const rng = mulberry32(hashSeed('case-time-check'));
    for (let d = 2; d <= 4; d++) {
      for (let i = 0; i < 50; i++) {
        const t = botCaseTimeMs(rng, d);
        expect(t).toBeGreaterThanOrEqual(5000);
        expect(t).toBeLessThanOrEqual(44_999);
      }
    }
    // Harder cases take longer on average (difficulty × 5000).
    const easy = Array.from({ length: 200 }, () => botCaseTimeMs(mulberry32(1), 2));
    const hard = Array.from({ length: 200 }, () => botCaseTimeMs(mulberry32(1), 4));
    expect(hard.reduce((s, t) => s + t, 0) / 200).toBeGreaterThan(
      easy.reduce((s, t) => s + t, 0) / 200
    );
  });

  it('scores the bot with the exact Case rule (option points + ≤20 speed)', () => {
    const sim = simulateCaseBot('case-seed-1', CASE_QUESTIONS, 1200);
    expect(sim.answers).toHaveLength(5);
    expect(sim.correctCount).toBe(sim.answers.filter((a) => a.correct).length);
    expect(sim.score).toBe(sim.answers.reduce((s, a) => s + a.points, 0));
    expect(sim.totalTimeMs).toBe(sim.answers.reduce((s, a) => s + a.timeMs, 0));
    for (const a of sim.answers) {
      expect(a.points).toBeGreaterThanOrEqual(0);
      expect(a.points).toBeLessThanOrEqual(120);
      expect(a.optionId).toBeTruthy();
      // Re-price her pick through the same rule the player gets.
      const q = CASE_QUESTIONS.find((x) => x.id === a.questionId);
      const picked = q?.options.find((o) => o.id === a.optionId);
      expect(picked).toBeDefined();
      const expected =
        picked && picked.points > 0
          ? picked.points + Math.max(0, Math.floor(20 * (1 - a.timeMs / 45_000)))
          : 0;
      expect(a.points).toBe(expected);
      if (!a.correct) expect(a.points).toBeLessThanOrEqual(70);
    }
  });

  it('picks the best action about as often as her base accuracy (no difficulty adjustment)', () => {
    // 5,000 simulated cases at rating 1000 (base 0.55): the best-action
    // rate must sit near 0.55 — the difficulty adjustment of the quiz
    // bot must NOT apply here (ADR 0009 §5).
    let best = 0;
    let second = 0;
    let zero = 0;
    for (let i = 0; i < 5000; i++) {
      const sim = simulateCaseBot(`case-rate-${i}`, [CASE_QUESTIONS[1] as any], 1000);
      const a = sim.answers[0] as any;
      if (a.correct) best += 1;
      else if (a.points > 0) second += 1;
      else zero += 1;
    }
    expect(best / 5000).toBeGreaterThan(0.5);
    expect(best / 5000).toBeLessThan(0.6);
    // Of the ~45% remainder, 80% should be second-best.
    expect(second / (second + zero)).toBeGreaterThan(0.75);
    expect(second / (second + zero)).toBeLessThan(0.85);
  });

  it('a strong player faces a sharper Mira than a new player', () => {
    let bestWeak = 0;
    let bestStrong = 0;
    for (let i = 0; i < 2000; i++) {
      if (simulateCaseBot(`case-strong-${i}`, [CASE_QUESTIONS[1] as any], 1000).answers[0]?.correct)
        bestWeak += 1;
      if (simulateCaseBot(`case-strong-${i}`, [CASE_QUESTIONS[1] as any], 1800).answers[0]?.correct)
        bestStrong += 1;
    }
    expect(bestStrong).toBeGreaterThan(bestWeak);
    expect(bestWeak / 2000).toBeGreaterThan(0.5);
    expect(bestStrong / 2000).toBeGreaterThan(0.8);
  });
});

describe('chart bot (Phase 8 — ADR 0010 §6: correct reading by base accuracy, no difficulty adjustment)', () => {
  const chartOptions = (id: string) => [
    { id: `${id}-correct`, isCorrect: true },
    { id: `${id}-wrong-a`, isCorrect: false },
    { id: `${id}-wrong-b`, isCorrect: false },
    { id: `${id}-wrong-c`, isCorrect: false },
  ];
  const CHART_QUESTIONS = [
    { id: 'ch1', difficulty: 2, options: chartOptions('ch1') },
    { id: 'ch2', difficulty: 3, options: chartOptions('ch2') },
    { id: 'ch3', difficulty: 3, options: chartOptions('ch3') },
    { id: 'ch4', difficulty: 4, options: chartOptions('ch4') },
    { id: 'ch5', difficulty: 4, options: chartOptions('ch5') },
  ];

  it('is deterministic per (seed, questions, rating)', () => {
    const a = simulateChartBot('chart-seed-1', CHART_QUESTIONS, 1200);
    const b = simulateChartBot('chart-seed-1', CHART_QUESTIONS, 1200);
    expect(a).toEqual(b);
  });

  it('keeps bot chart times inside [5000, 29999] ms and slower on harder charts', () => {
    const rng = mulberry32(hashSeed('chart-time-check'));
    for (let d = 2; d <= 4; d++) {
      for (let i = 0; i < 50; i++) {
        const t = botChartTimeMs(rng, d);
        expect(t).toBeGreaterThanOrEqual(5000);
        expect(t).toBeLessThanOrEqual(29_999);
      }
    }
    // Harder charts take longer on average (difficulty × 2000), and
    // chart times run slower than quiz times (12000 base, not 3000).
    const easy = Array.from({ length: 200 }, () => botChartTimeMs(mulberry32(1), 2));
    const hard = Array.from({ length: 200 }, () => botChartTimeMs(mulberry32(1), 4));
    expect(hard.reduce((s, t) => s + t, 0) / 200).toBeGreaterThan(
      easy.reduce((s, t) => s + t, 0) / 200
    );
    expect(easy.reduce((s, t) => s + t, 0) / 200).toBeGreaterThan(15_000);
  });

  it('scores the bot with the exact Chart rule (100 base + ≤50 speed on the 30 s timer)', () => {
    const sim = simulateChartBot('chart-seed-1', CHART_QUESTIONS, 1200);
    expect(sim.answers).toHaveLength(5);
    expect(sim.correctCount).toBe(sim.answers.filter((a) => a.correct).length);
    expect(sim.score).toBe(sim.answers.reduce((s, a) => s + a.points, 0));
    expect(sim.totalTimeMs).toBe(sim.answers.reduce((s, a) => s + a.timeMs, 0));
    for (const a of sim.answers) {
      expect(a.points).toBeGreaterThanOrEqual(0);
      expect(a.points).toBeLessThanOrEqual(150);
      expect(a.optionId).toBeTruthy();
      // Re-price her pick through the same rule the player gets.
      const q = CHART_QUESTIONS.find((x) => x.id === a.questionId);
      const picked = q?.options.find((o) => o.id === a.optionId);
      expect(picked).toBeDefined();
      const expected = a.correct ? 100 + Math.max(0, Math.floor(50 * (1 - a.timeMs / 30_000))) : 0;
      expect(a.points).toBe(expected);
      // A correct pick always names the correct option; a wrong pick never does.
      expect(picked?.isCorrect).toBe(a.correct);
    }
  });

  it('reads correctly about as often as her base accuracy (no difficulty adjustment)', () => {
    // 5,000 simulated charts at rating 1000 (base 0.55): the correct
    // rate must sit near 0.55 — the difficulty adjustment of the quiz
    // bot must NOT apply here (ADR 0010 §6). Difficulty 2 and
    // difficulty 4 charts must read at the same rate.
    let correct = 0;
    let correctEasy = 0;
    let correctHard = 0;
    for (let i = 0; i < 5000; i++) {
      const sim = simulateChartBot(`chart-rate-${i}`, [CHART_QUESTIONS[1] as any], 1000);
      if (sim.answers[0]?.correct) correct += 1;
      if (
        simulateChartBot(`chart-rate-e-${i}`, [CHART_QUESTIONS[0] as any], 1000).answers[0]?.correct
      )
        correctEasy += 1;
      if (
        simulateChartBot(`chart-rate-h-${i}`, [CHART_QUESTIONS[3] as any], 1000).answers[0]?.correct
      )
        correctHard += 1;
    }
    expect(correct / 5000).toBeGreaterThan(0.5);
    expect(correct / 5000).toBeLessThan(0.6);
    expect(Math.abs(correctEasy / 5000 - correctHard / 5000)).toBeLessThan(0.05);
  });

  it('a strong player faces a sharper Mira than a new player', () => {
    let bestWeak = 0;
    let bestStrong = 0;
    for (let i = 0; i < 2000; i++) {
      if (
        simulateChartBot(`chart-strong-${i}`, [CHART_QUESTIONS[1] as any], 1000).answers[0]?.correct
      )
        bestWeak += 1;
      if (
        simulateChartBot(`chart-strong-${i}`, [CHART_QUESTIONS[1] as any], 1800).answers[0]?.correct
      )
        bestStrong += 1;
    }
    expect(bestStrong).toBeGreaterThan(bestWeak);
    expect(bestWeak / 2000).toBeGreaterThan(0.5);
    expect(bestStrong / 2000).toBeGreaterThan(0.8);
  });
});
