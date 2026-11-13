import { grade } from './quiz.service';
import type { QuestionWithOptions } from './quiz.repository';
import type { SubmitQuizDto } from './dto/quiz.dto';

function q(partial: Partial<QuestionWithOptions>): QuestionWithOptions {
  return {
    id: 'q1',
    text: 't',
    explanation: 'e',
    kind: 'SINGLE',
    order: 0,
    points: 10,
    options: [
      { id: 'o1', text: 'a', order: 0, isCorrect: true },
      { id: 'o2', text: 'b', order: 1, isCorrect: false },
    ],
    ...partial,
  };
}

function dto(answers: Array<{ questionId: string; selectedOptionIds: string[] }>): SubmitQuizDto {
  return { answers };
}

describe('grade()', () => {
  it('scores a correct SINGLE answer', () => {
    const r = grade(dto([{ questionId: 'q1', selectedOptionIds: ['o1'] }]), [q({})]);
    expect(r.score).toBe(10);
    expect(r.totalPoints).toBe(10);
    expect(r.answers[0]).toMatchObject({ isCorrect: true, pointsAwarded: 10 });
    expect(r.feedback[0]).toMatchObject({
      correct: true,
      correctOptionIds: ['o1'],
      explanation: 'e',
    });
  });

  it('scores a wrong SINGLE answer as 0', () => {
    const r = grade(dto([{ questionId: 'q1', selectedOptionIds: ['o2'] }]), [q({})]);
    expect(r.score).toBe(0);
    expect(r.feedback[0]?.correct).toBe(false);
  });

  it('rejects multiple selections on SINGLE', () => {
    const r = grade(dto([{ questionId: 'q1', selectedOptionIds: ['o1', 'o2'] }]), [q({})]);
    expect(r.score).toBe(0);
  });

  it('scores a skipped question as 0', () => {
    const r = grade(dto([{ questionId: 'q1', selectedOptionIds: [] }]), [q({})]);
    expect(r.score).toBe(0);
    expect(r.answers[0]?.isCorrect).toBe(false);
  });

  it('requires an exact set match for MULTI', () => {
    const multi = q({
      id: 'qm',
      kind: 'MULTI',
      options: [
        { id: 'a', text: 'a', order: 0, isCorrect: true },
        { id: 'b', text: 'b', order: 1, isCorrect: true },
        { id: 'c', text: 'c', order: 2, isCorrect: false },
      ],
    });
    const full = grade(dto([{ questionId: 'qm', selectedOptionIds: ['a', 'b'] }]), [multi]);
    expect(full.score).toBe(10);
    const partial = grade(dto([{ questionId: 'qm', selectedOptionIds: ['a'] }]), [multi]);
    expect(partial.score).toBe(0);
    const extra = grade(dto([{ questionId: 'qm', selectedOptionIds: ['a', 'b', 'c'] }]), [multi]);
    expect(extra.score).toBe(0);
  });

  it('dedupes repeated selections', () => {
    const r = grade(dto([{ questionId: 'q1', selectedOptionIds: ['o1', 'o1'] }]), [q({})]);
    expect(r.score).toBe(10);
  });

  it('sums points across questions', () => {
    const q2 = q({ id: 'q2', points: 20 });
    const r = grade(
      dto([
        { questionId: 'q1', selectedOptionIds: ['o1'] },
        { questionId: 'q2', selectedOptionIds: ['o2'] },
      ]),
      [q({}), q2]
    );
    expect(r.score).toBe(10);
    expect(r.totalPoints).toBe(30);
  });

  it('ignores answers for unknown question ids', () => {
    const r = grade(
      dto([
        { questionId: 'q1', selectedOptionIds: ['o1'] },
        { questionId: 'nope', selectedOptionIds: ['x'] },
      ]),
      [q({})]
    );
    expect(r.score).toBe(10);
    expect(r.answers).toHaveLength(1);
  });
});
