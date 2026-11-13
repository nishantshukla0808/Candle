import {
  blitzStreakBonus,
  buildGameStats,
  decideWinner,
  decideWinnerByPoints,
  pointsForAnswer,
  pointsForBlitzAnswer,
  pointsForCaseAnswer,
} from './duel-scoring';

describe('duel-scoring (docs/07 §5 — 100 base + up to 50 speed bonus)', () => {
  it('pins the worked scoring examples', () => {
    expect(pointsForAnswer(true, 0)).toBe(150);
    expect(pointsForAnswer(true, 7500)).toBe(125);
    expect(pointsForAnswer(true, 15000)).toBe(100);
    expect(pointsForAnswer(true, 14999)).toBe(100);
    expect(pointsForAnswer(false, 0)).toBe(0);
    expect(pointsForAnswer(false, 7500)).toBe(0);
    expect(pointsForAnswer(true, null)).toBe(0);
  });

  it('decides by correct answers first, then total time', () => {
    expect(
      decideWinner({ correct: 5, totalTimeMs: 40000 }, { correct: 4, totalTimeMs: 10000 })
    ).toBe('WIN');
    expect(
      decideWinner({ correct: 4, totalTimeMs: 40000 }, { correct: 5, totalTimeMs: 10000 })
    ).toBe('LOSS');
    expect(
      decideWinner({ correct: 5, totalTimeMs: 20000 }, { correct: 5, totalTimeMs: 40000 })
    ).toBe('WIN');
    expect(
      decideWinner({ correct: 5, totalTimeMs: 40000 }, { correct: 5, totalTimeMs: 20000 })
    ).toBe('LOSS');
    expect(
      decideWinner({ correct: 5, totalTimeMs: 20000 }, { correct: 5, totalTimeMs: 20000 })
    ).toBe('DRAW');
  });

  it('builds stored post-game stats (worst topic first, best streak, times)', () => {
    const items = [
      {
        id: 'q1',
        topic: 'stocks',
        skill: 'RECALL',
        difficulty: 2,
        stem: 'S1',
        explanation: 'E1',
        options: [
          { id: 'o1c', text: 'yes', isCorrect: true },
          { id: 'o1w', text: 'no', isCorrect: false },
        ],
      },
      {
        id: 'q2',
        topic: 'stocks',
        skill: 'RECALL',
        difficulty: 3,
        stem: 'S2',
        explanation: 'E2',
        options: [
          { id: 'o2c', text: 'yes', isCorrect: true },
          { id: 'o2w', text: 'no', isCorrect: false },
        ],
      },
      {
        id: 'q3',
        topic: 'budgeting',
        skill: 'CALCULATION',
        difficulty: 3,
        stem: 'S3',
        explanation: 'E3',
        options: [
          { id: 'o3c', text: 'yes', isCorrect: true },
          { id: 'o3w', text: 'no', isCorrect: false },
        ],
      },
      {
        id: 'q4',
        topic: 'budgeting',
        skill: 'CALCULATION',
        difficulty: 4,
        stem: 'S4',
        explanation: 'E4',
        options: [
          { id: 'o4c', text: 'yes', isCorrect: true },
          { id: 'o4w', text: 'no', isCorrect: false },
        ],
      },
      {
        id: 'q5',
        topic: 'risk',
        skill: 'JUDGEMENT',
        difficulty: 2,
        stem: 'S5',
        explanation: 'E5',
        options: [
          { id: 'o5c', text: 'yes', isCorrect: true },
          { id: 'o5w', text: 'no', isCorrect: false },
        ],
      },
    ];
    const answers = [
      {
        questionId: 'q1',
        optionId: 'o1c',
        skipped: false,
        correct: true,
        timeMs: 2000,
        points: 143,
      },
      {
        questionId: 'q2',
        optionId: 'o2c',
        skipped: false,
        correct: true,
        timeMs: 4000,
        points: 136,
      },
      {
        questionId: 'q3',
        optionId: 'o3w',
        skipped: false,
        correct: false,
        timeMs: 8000,
        points: 0,
      },
      { questionId: 'q4', optionId: null, skipped: true, correct: false, timeMs: null, points: 0 },
      {
        questionId: 'q5',
        optionId: 'o5c',
        skipped: false,
        correct: true,
        timeMs: 1000,
        points: 146,
      },
    ];
    const stats = buildGameStats(answers, items);
    expect(stats.score).toBe(143 + 136 + 146);
    expect(stats.correct).toBe(3);
    expect(stats.wrong).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.accuracy).toBeCloseTo(0.6);
    expect(stats.avgTimeMs).toBe(Math.round((2000 + 4000 + 8000 + 1000) / 4));
    expect(stats.fastestTimeMs).toBe(1000);
    expect(stats.slowestTimeMs).toBe(8000);
    expect(stats.bestStreak).toBe(2);
    expect(stats.totalTimeMs).toBe(15000);
    // per-topic worst-first: budgeting 0/2, risk 1/1, stocks 2/2
    expect(stats.perTopic.map((t) => t.topic)).toEqual(['budgeting', 'risk', 'stocks']);
    expect(stats.perTopic[0]).toEqual({ topic: 'budgeting', correct: 0, total: 2, accuracy: 0 });
    // per-question carries the explanation + correct answer (reveal only)
    expect(stats.perQuestion[2]?.explanation).toBe('E3');
    expect(stats.perQuestion[2]?.correctOptionText).toBe('yes');
    expect(stats.perQuestion[3]?.selectedOptionText).toBeNull();
  });
});

describe('blitz scoring (Phase 6 — 10 s timer + streak bonus, docs/05 §1 L2)', () => {
  it('pins the streak bonus: nothing below 3, +10/+20, capped at +30', () => {
    expect(blitzStreakBonus(0)).toBe(0);
    expect(blitzStreakBonus(1)).toBe(0);
    expect(blitzStreakBonus(2)).toBe(0);
    expect(blitzStreakBonus(3)).toBe(10);
    expect(blitzStreakBonus(4)).toBe(20);
    expect(blitzStreakBonus(5)).toBe(30);
    expect(blitzStreakBonus(6)).toBe(30);
    expect(blitzStreakBonus(10)).toBe(30);
  });

  it('pins the Blitz worked examples (10 s timer + streak)', () => {
    // correct in 0 ms, streak 1 → 100 + 50 + 0
    expect(pointsForBlitzAnswer(true, 0, 1)).toBe(150);
    // correct in 5,000 ms, streak 3 → 100 + 25 + 10
    expect(pointsForBlitzAnswer(true, 5000, 3)).toBe(135);
    // correct in 10,000 ms, streak 5 → 100 + 0 + 30
    expect(pointsForBlitzAnswer(true, 10000, 5)).toBe(130);
    // correct in 0 ms, streak 9 → 100 + 50 + 30 (capped)
    expect(pointsForBlitzAnswer(true, 0, 9)).toBe(180);
    // wrong, any streak → 0 (and the streak resets — the engine owns that)
    expect(pointsForBlitzAnswer(false, 0, 5)).toBe(0);
    expect(pointsForBlitzAnswer(false, 5000, 9)).toBe(0);
    expect(pointsForBlitzAnswer(true, null, 3)).toBe(0);
  });

  it('scales the speed bonus to the 10 s timer, not the 15 s one', () => {
    // At 7,500 ms a Blitz answer is 3/4 through its timer (bonus 12),
    // while a Speed Quiz answer is halfway (bonus 25).
    expect(pointsForBlitzAnswer(true, 7500, 1)).toBe(112);
    expect(pointsForAnswer(true, 7500, 15_000)).toBe(125);
    expect(pointsForAnswer(true, 7500, 10_000)).toBe(112);
  });

  it('does not change Speed Quiz scoring (no streak bonus there)', () => {
    expect(pointsForAnswer(true, 0)).toBe(150);
    expect(pointsForAnswer(true, 7500)).toBe(125);
    expect(pointsForAnswer(true, 15000)).toBe(100);
    expect(pointsForAnswer(true, 14999)).toBe(100);
  });
});

describe('case scoring (Phase 7 — option points + up to 20 speed bonus, ADR 0009 §3)', () => {
  it('pins the worked examples (45 s timer)', () => {
    // best action in 0 ms → 100 + 20
    expect(pointsForCaseAnswer(100, 0)).toBe(120);
    // best action in 22,500 ms → 100 + 10
    expect(pointsForCaseAnswer(100, 22_500)).toBe(110);
    // best action at the deadline → 100 + 0
    expect(pointsForCaseAnswer(100, 45_000)).toBe(100);
    // second-best in 0 ms → 50 + 20
    expect(pointsForCaseAnswer(50, 0)).toBe(70);
    // second-best in 45,000 ms → 50 + 0
    expect(pointsForCaseAnswer(50, 45_000)).toBe(50);
    // second-best halfway → 50 + 10
    expect(pointsForCaseAnswer(50, 22_500)).toBe(60);
    // harmful action, any time → 0 (no speed bonus for a 0-point action)
    expect(pointsForCaseAnswer(0, 0)).toBe(0);
    expect(pointsForCaseAnswer(0, 22_500)).toBe(0);
    // skipped → 0
    expect(pointsForCaseAnswer(100, null)).toBe(0);
    expect(pointsForCaseAnswer(50, null)).toBe(0);
  });

  it('decides a Case Duel on points first, then total time', () => {
    // Five second-best picks (5 × ~60) beat two best picks + three
    // harmful ones (2 × ~110) even though the second player has more
    // "correct" (best-action) answers — points are the Case rule.
    expect(
      decideWinnerByPoints({ score: 300, totalTimeMs: 90000 }, { score: 220, totalTimeMs: 10000 })
    ).toBe('WIN');
    expect(
      decideWinnerByPoints({ score: 220, totalTimeMs: 10000 }, { score: 300, totalTimeMs: 90000 })
    ).toBe('LOSS');
    expect(
      decideWinnerByPoints({ score: 300, totalTimeMs: 20000 }, { score: 300, totalTimeMs: 40000 })
    ).toBe('WIN');
    expect(
      decideWinnerByPoints({ score: 300, totalTimeMs: 40000 }, { score: 300, totalTimeMs: 20000 })
    ).toBe('LOSS');
    expect(
      decideWinnerByPoints({ score: 300, totalTimeMs: 20000 }, { score: 300, totalTimeMs: 20000 })
    ).toBe('DRAW');
  });

  it('carries the rubric into the stored per-question stat for CASE items', () => {
    const items = [
      {
        id: 'c1',
        topic: 'budgeting',
        skill: 'JUDGEMENT',
        difficulty: 3,
        stem: 'Case 1',
        explanation: 'E1',
        rubric: 'Best — saves on time.\nSecond-best — falls short.',
        options: [
          { id: 'o1c', text: 'best', isCorrect: true },
          { id: 'o1s', text: 'second', isCorrect: false },
        ],
      },
    ];
    const stats = buildGameStats(
      [
        {
          questionId: 'c1',
          optionId: 'o1s',
          skipped: false,
          correct: false,
          timeMs: 5000,
          points: 67,
        },
      ],
      items
    );
    expect(stats.perQuestion[0]?.rubric).toBe('Best — saves on time.\nSecond-best — falls short.');
    expect(stats.perQuestion[0]?.points).toBe(67);
    expect(stats.score).toBe(67);
  });
});

describe('chart scoring (Phase 8 — same as MCQ_4 on the 30 s timer, no partial credit, ADR 0010 §5)', () => {
  it('pins the worked examples (30 s timer)', () => {
    // correct in 0 ms → 100 + 50
    expect(pointsForAnswer(true, 0, 30_000)).toBe(150);
    // correct in 15,000 ms → 100 + 25
    expect(pointsForAnswer(true, 15_000, 30_000)).toBe(125);
    // correct at the deadline → 100 + 0
    expect(pointsForAnswer(true, 30_000, 30_000)).toBe(100);
    // correct just before the deadline → 100 + 0 (floor)
    expect(pointsForAnswer(true, 29_999, 30_000)).toBe(100);
    // wrong chart read, any time → 0 (no partial credit — the chart is the question)
    expect(pointsForAnswer(false, 0, 30_000)).toBe(0);
    expect(pointsForAnswer(false, 15_000, 30_000)).toBe(0);
    // skipped → 0
    expect(pointsForAnswer(true, null, 30_000)).toBe(0);
  });

  it('decides a Chart Duel on correct count first, then total time (same as Speed Quiz)', () => {
    expect(
      decideWinner({ correct: 4, totalTimeMs: 90000 }, { correct: 3, totalTimeMs: 10000 })
    ).toBe('WIN');
    expect(
      decideWinner({ correct: 3, totalTimeMs: 10000 }, { correct: 3, totalTimeMs: 20000 })
    ).toBe('WIN');
    expect(
      decideWinner({ correct: 3, totalTimeMs: 20000 }, { correct: 3, totalTimeMs: 20000 })
    ).toBe('DRAW');
  });

  it('carries the chart + annotation into the stored per-question stat for CHART items', () => {
    const items = [
      {
        id: 'ch1',
        topic: 'stocks',
        skill: 'CHART_READING',
        difficulty: 3,
        stem: 'What does the chart show?',
        explanation: 'The line climbs in almost every month.',
        chart: {
          title: 'Meadow Foods — price over 6 months',
          instrument: 'Meadow Foods',
          template: 'STEADY_RISE',
          xLabel: 'Month',
          yLabel: 'Price (₹)',
          xLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          series: [100, 104, 109, 113, 118, 124],
          annotation: { trend: 'rising' as const, zoneStart: 0, zoneEnd: 5 },
        },
        options: [
          { id: 'o1c', text: 'The price rose steadily.', isCorrect: true },
          { id: 'o1w', text: 'The price fell steadily.', isCorrect: false },
        ],
      },
    ];
    const stats = buildGameStats(
      [
        {
          questionId: 'ch1',
          optionId: 'o1c',
          skipped: false,
          correct: true,
          timeMs: 5000,
          points: 141,
        },
      ],
      items
    );
    // The stored stat carries the chart WITHOUT the annotation, plus
    // the annotation separately — the result screen draws the
    // annotated chart from these two fields (ADR 0010 §5).
    expect(stats.perQuestion[0]?.chart).toEqual({
      title: 'Meadow Foods — price over 6 months',
      instrument: 'Meadow Foods',
      template: 'STEADY_RISE',
      xLabel: 'Month',
      yLabel: 'Price (₹)',
      xLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
      series: [100, 104, 109, 113, 118, 124],
    });
    expect(stats.perQuestion[0]?.chart).not.toHaveProperty('annotation');
    expect(stats.perQuestion[0]?.annotation).toEqual({ trend: 'rising', zoneStart: 0, zoneEnd: 5 });
    expect(stats.perQuestion[0]?.points).toBe(141);
    expect(stats.score).toBe(141);
  });

  it('carries null chart + annotation for non-CHART items', () => {
    const stats = buildGameStats(
      [
        {
          questionId: 'q1',
          optionId: 'o1c',
          skipped: false,
          correct: true,
          timeMs: 2000,
          points: 143,
        },
      ],
      [
        {
          id: 'q1',
          topic: 'stocks',
          skill: 'RECALL',
          difficulty: 2,
          stem: 'S1',
          explanation: 'E1',
          options: [
            { id: 'o1c', text: 'yes', isCorrect: true },
            { id: 'o1w', text: 'no', isCorrect: false },
          ],
        },
      ]
    );
    expect(stats.perQuestion[0]?.chart).toBeNull();
    expect(stats.perQuestion[0]?.annotation).toBeNull();
  });
});
