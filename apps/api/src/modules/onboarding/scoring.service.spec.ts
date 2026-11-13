import type { AnswerConfidence } from '@prisma/client';
import {
  gradeAssessment,
  isAnswerCorrect,
  labelForLevel,
  levelForScore,
  pointsFor,
  type GradedQuestionInput,
} from './scoring.service';

/** Builds one graded input with sensible defaults. */
function q(overrides: Partial<GradedQuestionInput> & { questionId: string }): GradedQuestionInput {
  return {
    topicKey: 'money-basics',
    kind: 'SINGLE',
    correctOptionIds: ['opt-correct'],
    selectedOptionIds: ['opt-correct'],
    confidence: 'CONFIDENT',
    ...overrides,
  };
}

/** 12 inputs — 3 per topic — with per-question overrides. */
function fullAttempt(perQuestion: Array<Partial<GradedQuestionInput>> = []): GradedQuestionInput[] {
  const topics = ['money-basics', 'banking-saving', 'markets', 'investor-mindset'];
  const out: GradedQuestionInput[] = [];
  let n = 0;
  for (const topicKey of topics) {
    for (let tier = 0; tier < 3; tier++) {
      n += 1;
      out.push(
        q({
          questionId: `q${n}`,
          topicKey,
          ...(perQuestion[n - 1] ?? {}),
        })
      );
    }
  }
  return out;
}

describe('isAnswerCorrect', () => {
  it('SINGLE: exactly the correct option', () => {
    expect(isAnswerCorrect('SINGLE', ['a'], ['a'])).toBe(true);
    expect(isAnswerCorrect('SINGLE', ['b'], ['a'])).toBe(false);
    expect(isAnswerCorrect('SINGLE', [], ['a'])).toBe(false);
    expect(isAnswerCorrect('SINGLE', ['a', 'b'], ['a'])).toBe(false);
  });

  it('MULTI: exact set match, order-independent', () => {
    expect(isAnswerCorrect('MULTI', ['a', 'b'], ['b', 'a'])).toBe(true);
    expect(isAnswerCorrect('MULTI', ['a'], ['a', 'b'])).toBe(false);
    expect(isAnswerCorrect('MULTI', ['a', 'b', 'c'], ['a', 'b'])).toBe(false);
    expect(isAnswerCorrect('MULTI', [], ['a', 'b'])).toBe(false);
  });
});

describe('pointsFor (spec §4.1 confidence matrix)', () => {
  const cases: Array<[boolean, AnswerConfidence, number]> = [
    [true, 'CONFIDENT', 1],
    [true, 'GUESSING', 0.5],
    [true, 'SKIPPED', 0],
    [false, 'CONFIDENT', 0],
    [false, 'GUESSING', 0],
    [false, 'SKIPPED', 0],
  ];
  it.each(cases)('correct=%s confidence=%s → %s points', (correct, confidence, points) => {
    expect(pointsFor(correct, confidence)).toBe(points);
  });
});

describe('levelForScore (spec §4.2 boundaries)', () => {
  const cases: Array<[number, number]> = [
    [0, 1],
    [0.5, 2],
    [1, 2],
    [1.5, 3],
    [2, 3],
    [2.5, 4],
    [3, 5],
  ];
  it.each(cases)('score %s → level %s', (score, level) => {
    expect(levelForScore(score)).toBe(level);
  });

  it('labels exist for all levels', () => {
    expect(labelForLevel(1)).toBe('Starting Out');
    expect(labelForLevel(2)).toBe('Foundations');
    expect(labelForLevel(3)).toBe('Building');
    expect(labelForLevel(4)).toBe('Confident');
    expect(labelForLevel(5)).toBe('Market Ready');
  });
});

describe('gradeAssessment', () => {
  it('perfect attempt: all level 5, FAST_TRACK waiving modules 0–2', () => {
    const g = gradeAssessment(fullAttempt());
    expect(g.topics).toHaveLength(4);
    for (const t of g.topics) {
      expect(t.level).toBe(5);
      expect(t.score).toBe(3);
      expect(t.maxScore).toBe(3);
    }
    expect(g.overallLevel).toBe(5);
    expect(g.placement.kind).toBe('FAST_TRACK');
    expect(g.placement.recommendedStartModuleOrder).toBe(3);
  });

  it('all skipped: all level 1, START_HERE at module 0', () => {
    const g = gradeAssessment(
      fullAttempt(
        Array.from({ length: 12 }, (): Partial<GradedQuestionInput> => ({
          selectedOptionIds: [],
          confidence: 'SKIPPED',
        }))
      )
    );
    for (const t of g.topics) expect(t.level).toBe(1);
    expect(g.overallLevel).toBe(1);
    expect(g.placement).toEqual({ kind: 'START_HERE', recommendedStartModuleOrder: 0 });
  });

  it('guessed-correct answers earn half credit', () => {
    // money-basics: 3 correct-but-unsure = 1.5 → level 3.
    const g = gradeAssessment(
      fullAttempt([
        { confidence: 'GUESSING' },
        { confidence: 'GUESSING' },
        { confidence: 'GUESSING' },
        ...Array.from({ length: 9 }, (): Partial<GradedQuestionInput> => ({
          selectedOptionIds: [],
          confidence: 'SKIPPED',
        })),
      ])
    );
    const money = g.topics[0] as { level: number; score: number };
    expect(money.score).toBe(1.5);
    expect(money.level).toBe(3);
  });

  it('placement picks the FIRST weak topic in track order', () => {
    // money-basics strong (3.0 → L5), banking-saving weak (0 → L1),
    // markets strong (3.0 → L5), investor-mindset strong (3.0 → L5).
    const strong: Partial<GradedQuestionInput> = { confidence: 'CONFIDENT' };
    const weak: Partial<GradedQuestionInput> = { selectedOptionIds: [], confidence: 'SKIPPED' };
    const g = gradeAssessment(
      fullAttempt([
        strong,
        strong,
        strong,
        weak,
        weak,
        weak,
        strong,
        strong,
        strong,
        strong,
        strong,
        strong,
      ])
    );
    expect(g.placement).toEqual({ kind: 'START_HERE', recommendedStartModuleOrder: 1 });
  });

  it('all topics level 4 (no weak topic) → FAST_TRACK', () => {
    // 2.5 per topic: 2 confident-correct + 1 guessing-correct → level 4.
    const per: Array<Partial<GradedQuestionInput>> = [
      { confidence: 'CONFIDENT' },
      { confidence: 'CONFIDENT' },
      { confidence: 'GUESSING' },
    ];
    const g = gradeAssessment(fullAttempt([...per, ...per, ...per, ...per]));
    for (const t of g.topics) expect(t.level).toBe(4);
    expect(g.placement.kind).toBe('FAST_TRACK');
  });

  it('MULTI partial selection is wrong (exact set required)', () => {
    const g = gradeAssessment(
      fullAttempt([
        {
          kind: 'MULTI',
          correctOptionIds: ['a', 'b'],
          selectedOptionIds: ['a'],
          confidence: 'CONFIDENT',
        },
        ...Array.from({ length: 11 }, (): Partial<GradedQuestionInput> => ({
          selectedOptionIds: [],
          confidence: 'SKIPPED',
        })),
      ])
    );
    expect(g.answers[0]?.isCorrect).toBe(false);
    expect(g.answers[0]?.pointsAwarded).toBe(0);
  });

  it('overall level is the rounded mean of topic levels', () => {
    // Levels: 5, 1, 1, 1 → mean 2 → overall 2.
    const strong: Partial<GradedQuestionInput> = { confidence: 'CONFIDENT' };
    const weak: Partial<GradedQuestionInput> = { selectedOptionIds: [], confidence: 'SKIPPED' };
    const g = gradeAssessment(
      fullAttempt([strong, strong, strong, weak, weak, weak, weak, weak, weak, weak, weak, weak])
    );
    expect(g.topics.map((t) => t.level)).toEqual([5, 1, 1, 1]);
    expect(g.overallLevel).toBe(2);
  });

  it('answers carry per-question correctness and points', () => {
    const g = gradeAssessment(
      fullAttempt([
        { confidence: 'GUESSING' },
        ...Array.from({ length: 11 }, (): Partial<GradedQuestionInput> => ({
          selectedOptionIds: [],
          confidence: 'SKIPPED',
        })),
      ])
    );
    expect(g.answers[0]).toMatchObject({
      questionId: 'q1',
      isCorrect: true,
      confidence: 'GUESSING',
      pointsAwarded: 0.5,
    });
    expect(g.answers[1]?.pointsAwarded).toBe(0);
  });
});
