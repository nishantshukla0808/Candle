import { HttpStatus, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io, type Socket as ClientSocket } from 'socket.io-client';
import cookieParser from 'cookie-parser';
import { ContentStatus, Prisma } from '@prisma/client';
import {
  ApiErrorResponse,
  ApiSuccessResponse,
  ErrorCode,
  QUIZ_PASS_MARK,
  XP,
} from '@candle/shared';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';
import { RedisService } from '../src/common/services/redis.service';
import { TransactionService } from '../src/database/transaction.service';
import { AuthRepository } from '../src/modules/auth/auth.repository';
import { UsersRepository } from '../src/modules/users/users.repository';
import { LearningRepository } from '../src/modules/learning/learning.repository';
import { QuizRepository } from '../src/modules/quiz/quiz.repository';
import { GamificationRepository } from '../src/modules/gamification/gamification.repository';
import { AdminRepository } from '../src/modules/admin/admin.repository';
import { SimulatorRepository } from '../src/modules/simulator/simulator.repository';
import { OnboardingRepository } from '../src/modules/onboarding/onboarding.repository';
import { RatingsRepository } from '../src/modules/ratings/ratings.repository';
import { QuestionBankRepository } from '../src/modules/question-bank/question-bank.repository';
import { DuelsRepository } from '../src/modules/duels/duels.repository';
import { FriendChallengeRepository } from '../src/modules/friend-challenge/friend-challenge.repository';
import { SprintRepository } from '../src/modules/trading-sprint/sprint.repository';
import { WeeklyRepository } from '../src/modules/weekly-battle/weekly.repository';
import { softReset } from '../src/modules/ratings/rating-math';
import { OutboxRepository } from '../src/common/events/outbox.repository';
import { IdempotencyRepository } from '../src/common/idempotency/idempotency.repository';
import { FakeDb, FakeAuthRepository, FakeUsersRepository, FakeLearningRepository } from './fakes';
import {
  FakeQuizRepository,
  FakeGamificationRepository,
  FakeAdminRepository,
  FakeSimulatorRepository,
  FakeOnboardingRepository,
  FakeRatingsRepository,
  FakeQuestionBankRepository,
  FakeDuelsRepository,
  FakeFriendChallengeRepository,
  FakeSprintRepository,
  FakeWeeklyRepository,
  FakeOutboxRepository,
  FakeIdempotencyRepository,
  FakeTransactionService,
  FakeRedisService,
} from './fakes2';

/**
 * Phase 1 e2e — full Gamified Learning Engine over in-memory fakes
 * (ADR 0002/13). HTTP pipeline, guards, DTO validation, envelope,
 * transactions, idempotency, and RBAC run for real; only the Prisma
 * port is faked (no Postgres/Redis on this VM).
 */

const TEST_ENV: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  PORT: '3101',
  DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
  REDIS_URL: 'redis://localhost:6379',
  JWT_SECRET: 'test-secret-that-is-at-least-32-chars-long!',
  RATE_LIMIT_MAX: '1000',
  RATE_LIMIT_STRICT_MAX: '1000',
  STORAGE_LOCAL_DIR: '/tmp/candle-e2e-uploads',
  OUTBOX_POLL_MS: '60000',
  // Live duels (docs/09): short countdown / reveal pause / disconnect
  // grace so the socket tests run fast; the 15 s question timer stays.
  // Case Duel (docs/12): the 45 s case timer and the 10 s reason window
  // shrink too, so a 5-case duel finishes in seconds in tests.
  LIVE_COUNTDOWN_MS: '300',
  LIVE_REVEAL_PAUSE_MS: '100',
  LIVE_DISCONNECT_GRACE_MS: '1000',
  CASE_QUESTION_MS: '3000',
  CASE_REASON_WINDOW_MS: '2000',
  // Chart Detective (docs/13): the 30 s chart timer shrinks too, so a
  // 5-chart duel finishes in seconds in tests.
  CHART_QUESTION_MS: '3000',
  // Paper Trading Sprint (docs/14): the 15-minute sprint and the 30 s
  // tick shrink so a full sprint settles in seconds in tests.
  SPRINT_DURATION_MS: '20000',
  SPRINT_TICK_MS: '5000',
  // Weekly Portfolio Battle (docs/16): the one-week season shrinks to
  // 15 s so a full weekly cycle — create → join → trade → end →
  // settle — runs in test time.
  WEEKLY_SEASON_DURATION_MS: '15000',
};

function applyEnv(): void {
  Object.assign(process.env, TEST_ENV);
}

function serverOf(app: INestApplication): Server {
  return app.getHttpServer() as Server;
}

type Agent = ReturnType<typeof request.agent>;

function okBody<T>(res: request.Response): ApiSuccessResponse<T> {
  return res.body as ApiSuccessResponse<T>;
}
function errBody(res: request.Response): ApiErrorResponse {
  return res.body as ApiErrorResponse;
}

/** Minimal PNG (magic bytes only) — passes the §10 sniff test. */
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 0),
]);
const NOT_AN_IMAGE = Buffer.from('hello, this is plain text, not an image');

// --- learning content seed (mirrors prisma/seed.ts shape) -----------------------

const L1 = '174bced2-1423-4a73-b79c-e1d99116752b';
const L2 = 'dbde7cd4-7e9a-45d4-8895-21c40e2f1854';
const L3 = '759ab52e-5f3e-4acc-bc83-69108f30b373';
const V1 = '66b0cbf5-bd68-4ab2-aa03-854085526bd1';
const V2 = '056b175f-3e07-4d21-8382-571cee3398d3';
const V3 = '10514e52-24fa-432f-8b0a-e88b016b60a3';

/** Registry of seeded question/option ids: Q.q1 -> question id, Q.q1Correct -> [option ids]. */
const Q: Record<string, string | string[]> = {};
for (const k of ['q1', 'q2', 'q3', 'q4', 'q5']) {
  Q[`${k}Correct`] = [];
  Q[`${k}Wrong`] = [];
}
const uuidv4 = (): string =>
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });

function seedLearning(db: FakeDb): void {
  db.tracks.set('trk1', {
    id: 'trk1',
    slug: 'foundations',
    title: 'Money Foundations',
    description: 'Test track',
    order: 0,
    status: ContentStatus.PUBLISHED,
  });
  db.modules.set('mod1', {
    id: 'mod1',
    trackId: 'trk1',
    title: 'Module 1',
    description: null,
    order: 0,
    status: ContentStatus.PUBLISHED,
  });
  db.modules.set('mod2', {
    id: 'mod2',
    trackId: 'trk1',
    title: 'Module 2',
    description: null,
    order: 1,
    status: ContentStatus.PUBLISHED,
  });
  const lesson = (id: string, moduleId: string, order: number) =>
    db.lessons.set(id, { id, moduleId, title: `Lesson ${id}`, order });
  lesson(L1, 'mod1', 0);
  lesson(L2, 'mod1', 1);
  lesson(L3, 'mod2', 2);
  const version = (id: string, lessonId: string) =>
    db.lessonVersions.set(id, {
      id,
      lessonId,
      version: 1,
      title: `Lesson ${lessonId}`,
      contentMarkdown: 'Content. *Educational purpose only — this is not investment advice.*',
      status: ContentStatus.PUBLISHED,
      publishedAt: new Date(),
    });
  version(V1, L1);
  version(V2, L2);
  version(V3, L3);

  // L1: 3 questions (2 SINGLE + 1 MULTI), 10 pts each. UUIDs everywhere
  // (QuizAnswerDto validates UUID v4). Correct option ids are recorded.
  const q = (
    key: string,
    versionId: string,
    order: number,
    kind: 'SINGLE' | 'MULTI',
    options: Array<[string, boolean]>
  ) => {
    const id = uuidv4();
    Q[key] = id;
    db.questions.set(id, {
      id,
      lessonVersionId: versionId,
      text: `Q ${key}?`,
      explanation: `Because ${key}.`,
      kind,
      order,
      points: 10,
    });
    options.forEach(([text, isCorrect], i) => {
      const oid = uuidv4();
      if (isCorrect) (Q[`${key}Correct`] as string[]).push(oid);
      else (Q[`${key}Wrong`] as string[]).push(oid);
      db.questionOptions.set(oid, { id: oid, questionId: id, text, isCorrect, order: i });
    });
  };
  q('q1', V1, 0, 'SINGLE', [
    ['correct-a', true],
    ['wrong-b', false],
  ]);
  q('q2', V1, 1, 'SINGLE', [
    ['wrong-a', false],
    ['correct-b', true],
  ]);
  q('q3', V1, 2, 'MULTI', [
    ['right-1', true],
    ['right-2', true],
    ['wrong-3', false],
  ]);
  // L2: 2 SINGLE questions.
  q('q4', V2, 0, 'SINGLE', [
    ['correct', true],
    ['wrong', false],
  ]);
  q('q5', V2, 1, 'SINGLE', [
    ['wrong', false],
    ['correct', true],
  ]);
  // L3: no questions — no quiz gate.
}

// --- simulator seed (mirrors prisma/seed.ts instruments) --------------------------

const SIM_INSTRUMENTS: Array<{ symbol: string; name: string; basePrice: string }> = [
  { symbol: 'NVLT', name: 'NovaVolt Energy', basePrice: '842.50' },
  { symbol: 'KVRF', name: 'Kaveri Foods', basePrice: '315.20' },
  { symbol: 'ASTL', name: 'AstraLogix', basePrice: '1204.00' },
  { symbol: 'MRUM', name: 'Meru Motors', basePrice: '96.75' },
  { symbol: 'SGNR', name: 'Sagar Semiconductors', basePrice: '2210.40' },
  { symbol: 'HELX', name: 'Helix Healthcare', basePrice: '458.90' },
];

function seedSimulator(db: FakeDb): void {
  for (const inst of SIM_INSTRUMENTS) {
    const id = uuidv4();
    db.instruments.set(id, {
      id,
      symbol: inst.symbol,
      name: inst.name,
      description: `Fictional ${inst.name}.`,
      basePrice: new Prisma.Decimal(inst.basePrice),
      active: true,
    });
  }
}

// --- onboarding assessment seed (12 questions, 3 per topic) ------------------------
// Correct option ids are recorded in AQ so tests can build answers; the real
// content lives in prisma/assessment-bank.ts (seeded via prisma/seed.ts).

const AQ: Record<string, string | string[]> = {};

function seedAssessment(db: FakeDb): void {
  db.assessmentVersions.set('av1', {
    id: 'av1',
    version: 1,
    trackId: 'trk1',
    status: ContentStatus.PUBLISHED,
    publishedAt: new Date(),
  });
  const topics = ['money-basics', 'banking-saving', 'markets', 'investor-mindset'];
  let n = 0;
  for (const topicKey of topics) {
    for (let difficulty = 1; difficulty <= 3; difficulty++) {
      n += 1;
      const qid = uuidv4();
      AQ[`q${n}`] = qid;
      AQ[`q${n}Correct`] = [];
      // Question 9 (markets tier 3) is MULTI with 2 correct options;
      // everything else is SINGLE with exactly one correct option.
      const multi = n === 9;
      db.assessmentQuestions.set(qid, {
        id: qid,
        versionId: 'av1',
        topicKey,
        difficulty,
        text: `AQ${n} text?`,
        explanation: `Because AQ${n}.`,
        kind: multi ? 'MULTI' : 'SINGLE',
        order: n - 1,
      });
      for (let i = 0; i < 4; i++) {
        const oid = uuidv4();
        const isCorrect = multi ? i < 2 : i === 0;
        if (isCorrect) (AQ[`q${n}Correct`] as string[]).push(oid);
        db.assessmentOptions.set(oid, {
          id: oid,
          questionId: qid,
          text: `opt${i}`,
          isCorrect,
          order: i,
        });
      }
    }
  }
}

// --- question bank seed (docs/05 §2) ----------------------------------------------
// 96 LIVE MCQ_4 items: 4 topics x 4 skills x difficulties 1–3 x 2 copies, plus one
// DRAFT compounding template. Enough for stratified selection tests with a
// per-topic cap of 2 (4 topics x 2 = 8 max per set).
//
// Plus 64 LIVE TRUE_FALSE items (Phase 6): 4 topics x 4 skills x
// difficulties 4–5 x 2 copies, options "True"/"False" (the correct side
// alternates, so the bank is not all-True). They sit at difficulties
// 4–5 on purpose: the existing selection/coverage pins assert the
// MCQ-only difficulty 1–3 cells (e.g. budgeting d1 = 8), and the
// Blitz blueprint ({2:3, 3:4, 4:3}) reaches them through the
// nearest-difficulty fallback — the same fallback the Phase 5 e2e
// already exercises for its difficulty-4 cells. The production bank
// holds TRUE_FALSE items across all difficulties; the e2e seed only
// needs enough TRUE_FALSE depth for a 10-question Blitz set.

const QB_TOPICS = ['budgeting', 'stocks', 'risk', 'markets'];
const QB_SKILLS = ['RECALL', 'CALCULATION', 'JUDGEMENT', 'SCENARIO'];

function seedQuestionBank(db: FakeDb): void {
  let n = 0;
  for (const topic of QB_TOPICS) {
    for (const skill of QB_SKILLS) {
      for (let difficulty = 1; difficulty <= 3; difficulty++) {
        for (let copy = 0; copy < 2; copy++) {
          n += 1;
          const id = uuidv4();
          db.duelBankItems.set(id, {
            id,
            key: `e2e-qb-${n}`,
            topic,
            skill,
            type: 'MCQ_4',
            difficulty,
            language: 'en',
            sourceLessonId: null,
            stem: `QB ${n}: ${topic} / ${skill} / d${difficulty}?`,
            explanation: `Because QB ${n}.`,
            status: 'LIVE',
            version: 1,
            templateId: null,
            parameters: null,
            authorId: null,
            reviewerId: null,
            publishedAt: new Date(),
            pilotAnswers: 0,
            pilotCorrect: 0,
            correctRate: null,
            discrimination: null,
            exposureCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          for (let i = 0; i < 4; i++) {
            const oid = uuidv4();
            db.duelBankOptions.set(oid, {
              id: oid,
              itemId: id,
              text: `opt-${i}`,
              isCorrect: i === 0,
              order: i,
            });
          }
        }
      }
    }
  }
  // TRUE_FALSE items (Phase 6 Blitz pool): same topics/skills, harder
  // difficulties, exactly 2 options, exactly 1 correct.
  let m = 0;
  for (const topic of QB_TOPICS) {
    for (const skill of QB_SKILLS) {
      for (let difficulty = 4; difficulty <= 5; difficulty++) {
        for (let copy = 0; copy < 2; copy++) {
          m += 1;
          const id = uuidv4();
          const trueIsCorrect = m % 2 === 0;
          db.duelBankItems.set(id, {
            id,
            key: `e2e-qb-tf-${m}`,
            topic,
            skill,
            type: 'TRUE_FALSE',
            difficulty,
            language: 'en',
            sourceLessonId: null,
            stem: `QB TF ${m}: ${topic} / ${skill} / d${difficulty} — true or false?`,
            explanation: `Because QB TF ${m}.`,
            status: 'LIVE',
            version: 1,
            templateId: null,
            parameters: null,
            authorId: null,
            reviewerId: null,
            publishedAt: new Date(),
            pilotAnswers: 0,
            pilotCorrect: 0,
            correctRate: null,
            discrimination: null,
            exposureCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          const options: Array<[string, boolean]> = [
            ['True', trueIsCorrect],
            ['False', !trueIsCorrect],
          ];
          options.forEach(([text, isCorrect], i) => {
            const oid = uuidv4();
            db.duelBankOptions.set(oid, {
              id: oid,
              itemId: id,
              text,
              isCorrect,
              order: i,
            });
          });
        }
      }
    }
  }
  // CASE_CHOICE items (Phase 7 Case Duel pool): 3 topics x 3
  // difficulties x 2 copies = 18 items, 3 actions each — best (100),
  // second-best (50), one 0-point action — with context, rubric, and
  // consequences. They deliberately mirror the Stage 1 item's shape
  // (same 3-option layout, context, and rubric) so the Stage 1
  // selection test and the Case duel tests hold whichever LIVE
  // CASE item the random selection picks. They sit in topics the
  // MCQ/TF seed does not use (insurance / tax-basics / compounding),
  // so the selection/coverage pins above hold; the Case blueprint
  // ({2:1, 3:2, 4:2}, max 2/topic) reaches them directly. The
  // production bank holds 50 CASE items (qb-521..qb-570); the e2e
  // seed only needs enough depth for a 5-case duel.
  const QB_CASE_TOPICS = ['insurance', 'tax-basics', 'compounding'];
  const QB_CASE_SKILLS = ['JUDGEMENT', 'SCENARIO'];
  let k = 0;
  for (const topic of QB_CASE_TOPICS) {
    for (let difficulty = 2; difficulty <= 4; difficulty++) {
      for (let copy = 0; copy < 2; copy++) {
        k += 1;
        const id = uuidv4();
        const skill = QB_CASE_SKILLS[k % 2] as string;
        db.duelBankItems.set(id, {
          id,
          key: `e2e-qb-case-${k}`,
          topic,
          skill,
          type: 'CASE_CHOICE',
          difficulty,
          language: 'en',
          sourceLessonId: null,
          stem: `QB CASE ${k}: ${topic} / ${skill} / d${difficulty}\nAsha earns ₹45,000 a month.\nShe has ₹20,000 saved.\nShe wants a ₹1,50,000 emergency fund in 6 months.`,
          explanation: `Because QB CASE ${k}.`,
          context: {
            'Monthly income': '₹45,000',
            'Saved so far': '₹20,000',
            Goal: '₹1,50,000 in 6 months',
          },
          rubric:
            'Best — saving ₹22,000 a month reaches the goal on time.\nSecond-best — saving less falls short.\nWeak — waiting leaves no fund at all.',
          status: 'LIVE',
          version: 1,
          templateId: null,
          parameters: null,
          authorId: null,
          reviewerId: null,
          publishedAt: new Date(),
          pilotAnswers: 0,
          pilotCorrect: 0,
          correctRate: null,
          discrimination: null,
          exposureCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const caseOptions: Array<[string, boolean, number, string]> = [
          ['Save ₹22,000 a month in a separate account', true, 100, 'Fund is ready in 6 months.'],
          ['Save ₹15,000 a month and use a card for surprises', false, 50, 'Fund falls short.'],
          ['Wait for a bonus, then save everything at once', false, 0, 'No fund for 6 months.'],
        ];
        caseOptions.forEach(([text, isCorrect, points, consequence], i) => {
          const oid = uuidv4();
          db.duelBankOptions.set(oid, {
            id: oid,
            itemId: id,
            text,
            isCorrect,
            points,
            consequence,
            order: i,
          });
        });
      }
    }
  }
  // CHART_CHOICE items (Phase 8 Chart Detective pool): 3 topics x 3
  // difficulties x 2 copies = 18 items, 4 interpretations each — one
  // correct reading — with the chart (STEADY_RISE, series [100..124])
  // and the reveal-only annotation. They deliberately mirror the
  // Stage 1 item's shape (same instrument, template, series, stem,
  // explanation, and option texts) so the Stage 1 selection test and
  // the Chart duel tests hold whichever LIVE CHART item the random
  // selection picks. They sit in the SAME (topic, difficulty) cells
  // the CASE seed already uses (insurance / tax-basics / compounding,
  // d2–4), so the coverage pin (50 cells) still holds — no new cell
  // is added. The production bank holds 50 CHART items
  // (qb-571..qb-620); the e2e seed only needs enough depth for a
  // 5-chart duel ({2:1, 3:2, 4:2}, max 2/topic).
  const QB_CHART_TOPICS = ['insurance', 'tax-basics', 'compounding'];
  let h = 0;
  for (const topic of QB_CHART_TOPICS) {
    for (let difficulty = 2; difficulty <= 4; difficulty++) {
      for (let copy = 0; copy < 2; copy++) {
        h += 1;
        const id = uuidv4();
        db.duelBankItems.set(id, {
          id,
          key: `e2e-qb-chart-${h}`,
          topic,
          skill: 'CHART_READING',
          type: 'CHART_CHOICE',
          difficulty,
          language: 'en',
          sourceLessonId: null,
          stem: 'Look at the price chart of Meadow Foods, a fictional snack company, from January to June. What does the chart show?',
          explanation:
            'The line climbs in almost every month and ends clearly higher than January. A rising line means the price rose.',
          chart: {
            title: 'Meadow Foods — price over 6 months',
            instrument: 'Meadow Foods',
            template: 'STEADY_RISE',
            xLabel: 'Month',
            yLabel: 'Price (₹)',
            xLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
            series: [100, 104, 109, 113, 118, 124],
            annotation: { trend: 'rising', zoneStart: 0, zoneEnd: 5 },
          },
          status: 'LIVE',
          version: 1,
          templateId: null,
          parameters: null,
          authorId: null,
          reviewerId: null,
          publishedAt: new Date(),
          pilotAnswers: 0,
          pilotCorrect: 0,
          correctRate: null,
          discrimination: null,
          exposureCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        const chartOptions: Array<[string, boolean]> = [
          ['The price rose steadily over the six months.', true],
          ['The price fell steadily over the six months.', false],
          ['The price stayed flat all six months.', false],
          ['The price rose, then fell below where it started.', false],
        ];
        chartOptions.forEach(([text, isCorrect], i) => {
          const oid = uuidv4();
          db.duelBankOptions.set(oid, {
            id: oid,
            itemId: id,
            text,
            isCorrect,
            order: i,
          });
        });
      }
    }
  }
  db.duelBankTemplates.set('7f3e1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b', {
    id: '7f3e1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b',
    key: 'tpl-compounding',
    topic: 'compounding',
    skill: 'CALCULATION',
    templateText: 'You invest ₹{principal} at {rate}% per year.',
    parameterSchema: {},
    answerFormula: 'round100(principal * (1 + rate / 100) ** years)',
    distractorRules: {},
    status: 'DRAFT',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

// --- app bootstrap ---------------------------------------------------------------

async function createApp(db: FakeDb): Promise<INestApplication> {
  applyEnv();
  const module: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaService)
    .useValue({ $queryRaw: async () => [{ '?column?': 1 }] })
    .overrideProvider(RedisService)
    .useValue(new FakeRedisService())
    .overrideProvider(TransactionService)
    .useValue(new FakeTransactionService())
    .overrideProvider(AuthRepository)
    .useValue(new FakeAuthRepository(db))
    .overrideProvider(UsersRepository)
    .useValue(new FakeUsersRepository(db))
    .overrideProvider(LearningRepository)
    .useValue(new FakeLearningRepository(db))
    .overrideProvider(QuizRepository)
    .useValue(new FakeQuizRepository(db))
    .overrideProvider(GamificationRepository)
    .useValue(new FakeGamificationRepository(db))
    .overrideProvider(AdminRepository)
    .useValue(new FakeAdminRepository(db))
    .overrideProvider(SimulatorRepository)
    .useValue(new FakeSimulatorRepository(db))
    .overrideProvider(OnboardingRepository)
    .useValue(new FakeOnboardingRepository(db))
    .overrideProvider(RatingsRepository)
    .useValue(new FakeRatingsRepository(db))
    .overrideProvider(QuestionBankRepository)
    .useValue(new FakeQuestionBankRepository(db))
    .overrideProvider(DuelsRepository)
    .useValue(new FakeDuelsRepository(db))
    .overrideProvider(FriendChallengeRepository)
    .useValue(new FakeFriendChallengeRepository(db))
    .overrideProvider(SprintRepository)
    .useValue(new FakeSprintRepository(db))
    .overrideProvider(WeeklyRepository)
    .useValue(new FakeWeeklyRepository(db))
    .overrideProvider(OutboxRepository)
    .useValue(new FakeOutboxRepository(db))
    .overrideProvider(IdempotencyRepository)
    .useValue(new FakeIdempotencyRepository(db))
    .compile();
  const app = module.createNestApplication();
  app.setGlobalPrefix('api/v1');
  app.use(cookieParser()); // mirror main.ts — refresh flow needs req.cookies
  await app.init();
  return app;
}

// --- helpers ---------------------------------------------------------------------

const PASSWORD = 'Str0ng!Passphrase12';

async function registerLogin(
  server: Server,
  email: string,
  opts: { roles?: string[] } = {}
): Promise<{ agent: Agent; userId: string; accessToken: string }> {
  const agent = request.agent(server);
  const reg = await agent
    .post('/api/v1/auth/register')
    .send({ email, password: PASSWORD, displayName: 'Test User' })
    .expect(HttpStatus.CREATED);
  const token = okBody<{ devVerificationToken: string }>(reg).data.devVerificationToken;
  if (opts.roles) {
    const userId = okBody<{ user: { id: string } }>(reg).data.user.id;
    // Promote directly in the fake store (simulates ADMIN_SEED_EMAILS).
    const db = (global as any).__fakeDb as FakeDb;
    db.users.get(userId).roles = opts.roles;
  }
  await agent.post('/api/v1/auth/verify-email').send({ token }).expect(HttpStatus.OK);
  const login = await agent
    .post('/api/v1/auth/login')
    .send({ email, password: PASSWORD })
    .expect(HttpStatus.OK);
  const accessToken = okBody<{ accessToken: string }>(login).data.accessToken;
  // Authenticated requests use the Bearer access token; the agent keeps the
  // refresh cookie for the refresh/logout flows.
  agent.set('Authorization', `Bearer ${accessToken}`);
  return {
    agent,
    userId: okBody<{ user: { id: string } }>(login).data.user.id,
    accessToken,
  };
}

describe('Phase 1 — Gamified Learning Engine (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let db: FakeDb;

  beforeAll(async () => {
    db = new FakeDb();
    (global as any).__fakeDb = db;
    seedLearning(db);
    seedSimulator(db);
    seedAssessment(db);
    seedQuestionBank(db);
    app = await createApp(db);
    server = serverOf(app);
  });

  afterAll(async () => {
    await app.close();
  });

  // --- auth --------------------------------------------------------------------

  describe('auth', () => {
    it('rejects weak passwords with per-field details (never the value)', async () => {
      const res = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'weak@example.com', password: 'weak' })
        .expect(HttpStatus.BAD_REQUEST);
      const body = errBody(res);
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(ErrorCode.VALIDATION_FAILED);
      const details = body.error.details as Array<{ field: string; value?: unknown }>;
      expect(details.length).toBeGreaterThan(0);
      expect(details.every((d) => d.field === 'password')).toBe(true);
      expect(details.every((d) => d.value === undefined)).toBe(true);
    });

    it('rejects malformed input (forbidNonWhitelisted + strict DTOs)', async () => {
      const res = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'not-an-email', password: PASSWORD, isAdmin: true })
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(res).error.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('register → verify → login issues access token + refresh cookie', async () => {
      const agent = request.agent(server);
      const reg = await agent
        .post('/api/v1/auth/register')
        .send({ email: 'alice@example.com', password: PASSWORD, displayName: 'Alice' })
        .expect(HttpStatus.CREATED);
      const regBody = okBody<{ user: { id: string; email: string }; devVerificationToken: string }>(
        reg
      );
      expect(regBody.data.user.email).toBe('alice@example.com');
      expect(typeof regBody.data.devVerificationToken).toBe('string');

      // Login before verification is blocked.
      const early = await agent
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: PASSWORD })
        .expect(HttpStatus.FORBIDDEN);
      expect(errBody(early).error.code).toBe(ErrorCode.EMAIL_NOT_VERIFIED);

      await agent
        .post('/api/v1/auth/verify-email')
        .send({ token: regBody.data.devVerificationToken })
        .expect(HttpStatus.OK);

      // Verification tokens are single-use.
      await agent
        .post('/api/v1/auth/verify-email')
        .send({ token: regBody.data.devVerificationToken })
        .expect(HttpStatus.UNAUTHORIZED);

      const login = await agent
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: PASSWORD })
        .expect(HttpStatus.OK);
      const loginBody = okBody<{ user: { id: string }; accessToken: string }>(login);
      expect(loginBody.data.accessToken).toBeTruthy();
      const cookies = login.headers['set-cookie'] as unknown as string[];
      expect(cookies.some((c) => c.startsWith('candle_refresh='))).toBe(true);
      expect(cookies.some((c) => /HttpOnly/i.test(c))).toBe(true);
    });

    it('duplicate registration does not enumerate (409, no user data leak)', async () => {
      const res = await request(server)
        .post('/api/v1/auth/register')
        .send({ email: 'alice@example.com', password: PASSWORD })
        .expect(HttpStatus.CONFLICT);
      expect(errBody(res).error.code).toBe(ErrorCode.CONFLICT);
    });

    it('wrong password returns generic "invalid credentials" (no enumeration)', async () => {
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: 'Wr0ng!Passphrase99' })
        .expect(HttpStatus.UNAUTHORIZED);
      const body = errBody(res);
      expect(body.error.code).toBe(ErrorCode.UNAUTHORIZED);
      expect(body.error.message).toBe('Invalid email or password.');
      // Unknown email yields the identical response.
      const res2 = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: 'nobody-here@example.com', password: 'Wr0ng!Passphrase99' })
        .expect(HttpStatus.UNAUTHORIZED);
      expect(errBody(res2).error.message).toBe(body.error.message);
    });

    it('refresh rotates; reuse of the old token revokes the whole family', async () => {
      const raw = request(server);
      const loginRes = await raw
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: PASSWORD });
      expect(loginRes.status).toBe(200);
      const stolenCookie = (
        (loginRes.headers['set-cookie'] as unknown as string[])[0] as string
      ).split(';')[0] as string;
      // Attacker rotates once with the stolen cookie…
      const rotated = await raw
        .post('/api/v1/auth/refresh')
        .set('Cookie', stolenCookie)
        .expect(200);
      const attackerCookie = (
        (rotated.headers['set-cookie'] as unknown as string[])[0] as string
      ).split(';')[0] as string;
      // …then the legitimate user's ORIGINAL cookie is replayed (reuse).
      const replay = await raw
        .post('/api/v1/auth/refresh')
        .set('Cookie', stolenCookie)
        .expect(HttpStatus.UNAUTHORIZED);
      expect(errBody(replay).error.message).toMatch(/reused|log in again/i);
      // The whole family is revoked — even the attacker's newest token is dead.
      await raw
        .post('/api/v1/auth/refresh')
        .set('Cookie', attackerCookie)
        .expect(HttpStatus.UNAUTHORIZED);
      // Fresh login mints a new family and works.
      await raw
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: PASSWORD })
        .expect(200);
    });

    it('logout revokes the refresh token', async () => {
      const agent = request.agent(server);
      await agent
        .post('/api/v1/auth/login')
        .send({ email: 'alice@example.com', password: PASSWORD })
        .expect(200);
      await agent.post('/api/v1/auth/logout').expect(HttpStatus.OK);
      await agent.post('/api/v1/auth/refresh').expect(HttpStatus.UNAUTHORIZED);
    });

    it('password reset: single-use hashed token, revokes sessions', async () => {
      const agent = request.agent(server);
      const reg = await agent
        .post('/api/v1/auth/register')
        .send({ email: 'bob@example.com', password: PASSWORD })
        .expect(HttpStatus.CREATED);
      const vToken = okBody<{ devVerificationToken: string }>(reg).data.devVerificationToken;
      await agent.post('/api/v1/auth/verify-email').send({ token: vToken }).expect(200);
      await agent
        .post('/api/v1/auth/login')
        .send({ email: 'bob@example.com', password: PASSWORD })
        .expect(200);

      // Forgot never reveals whether the email exists.
      await request(server)
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'ghost@example.com' })
        .expect(HttpStatus.OK);

      const forgot = await request(server)
        .post('/api/v1/auth/password/forgot')
        .send({ email: 'bob@example.com' })
        .expect(HttpStatus.OK);
      const resetToken = okBody<{ devResetToken: string }>(forgot).data.devResetToken;

      await agent
        .post('/api/v1/auth/password/reset')
        .send({ token: resetToken, newPassword: 'N3w!StrongPassphrase' })
        .expect(HttpStatus.OK);
      // Single-use: replay fails.
      await agent
        .post('/api/v1/auth/password/reset')
        .send({ token: resetToken, newPassword: 'An0ther!Passphrase' })
        .expect(HttpStatus.UNAUTHORIZED);
      // Old sessions revoked: refresh with the pre-reset cookie fails.
      await agent.post('/api/v1/auth/refresh').expect(HttpStatus.UNAUTHORIZED);
      // New password works.
      await agent
        .post('/api/v1/auth/login')
        .send({ email: 'bob@example.com', password: 'N3w!StrongPassphrase' })
        .expect(HttpStatus.OK);
    });
  });

  // --- users -------------------------------------------------------------------

  describe('users', () => {
    let learner: { agent: Agent; userId: string; accessToken: string };
    let other: { agent: Agent; userId: string; accessToken: string };

    beforeAll(async () => {
      learner = await registerLogin(server, 'carol@example.com');
      other = await registerLogin(server, 'dave@example.com');
    });

    it('GET /users/me returns the private profile (owner only)', async () => {
      const res = await learner.agent.get('/api/v1/users/me').expect(HttpStatus.OK);
      const me = okBody<{ id: string; email: string }>(res).data;
      expect(me.id).toBe(learner.userId);
      expect(me.email).toBe('carol@example.com');
    });

    it('PATCH /users/me updates displayName', async () => {
      const res = await learner.agent
        .patch('/api/v1/users/me')
        .send({ displayName: 'Carol C.' })
        .expect(HttpStatus.OK);
      expect(okBody<{ displayName: string }>(res).data.displayName).toBe('Carol C.');
    });

    it('public profile hides email (no cross-user data leak)', async () => {
      const res = await learner.agent.get(`/api/v1/users/${other.userId}`).expect(HttpStatus.OK);
      const pub = okBody<Record<string, unknown>>(res).data;
      expect(pub.id).toBe(other.userId);
      expect(pub.email).toBeUndefined();
    });

    it('avatar upload: real magic-byte validation via the storage port', async () => {
      const up = await learner.agent
        .post('/api/v1/users/me/avatar')
        .attach('avatar', PNG, { filename: 'avatar.png', contentType: 'image/png' })
        .expect(HttpStatus.CREATED);
      const key = okBody<{ avatarKey: string }>(up).data.avatarKey;
      expect(key).toMatch(/^avatars\//);

      // The avatar streams back.
      await learner.agent.get('/api/v1/users/me/avatar').expect(HttpStatus.OK);

      // Fake images are rejected.
      const bad = await learner.agent
        .post('/api/v1/users/me/avatar')
        .attach('avatar', NOT_AN_IMAGE, { filename: 'evil.txt', contentType: 'text/plain' })
        .expect(HttpStatus.UNSUPPORTED_MEDIA_TYPE);
      expect(errBody(bad).error.code).toBe(ErrorCode.UNSUPPORTED_FILE_TYPE);
    });
  });

  // --- learning ----------------------------------------------------------------

  describe('learning', () => {
    let s: { agent: Agent; userId: string; accessToken: string };

    beforeAll(async () => {
      s = await registerLogin(server, 'erin@example.com');
    });

    it('GET /learning/tracks lists published tracks; detail returns the tree', async () => {
      const res = await s.agent.get('/api/v1/learning/tracks').expect(HttpStatus.OK);
      const tracks = okBody<any[]>(res).data;
      expect(tracks).toHaveLength(1);
      expect(tracks[0].slug).toBe('foundations');

      const detail = await s.agent.get('/api/v1/learning/tracks/foundations').expect(HttpStatus.OK);
      const tree = okBody<any>(detail).data;
      expect(tree.modules).toHaveLength(2);
      expect(tree.modules[0].lessons).toHaveLength(2);
      expect(tree.modules[0].lessons[0].published.questionCount).toBe(3);
    });

    it('track detail marks linear lock state', async () => {
      const res = await s.agent.get('/api/v1/learning/tracks/foundations').expect(HttpStatus.OK);
      const track = okBody<any>(res).data;
      const lessons = track.modules.flatMap((m: any) => m.lessons);
      expect(lessons[0].locked).toBe(false);
      expect(lessons[1].locked).toBe(true);
      expect(lessons[2].locked).toBe(true);
      expect(track.totalLessons).toBe(3);
      expect(track.completedLessons).toBe(0);
    });

    it('lesson player returns content + disclaimer + lock state', async () => {
      const res = await s.agent.get(`/api/v1/learning/lessons/${L1}`).expect(HttpStatus.OK);
      const lesson = okBody<any>(res).data;
      expect(lesson.contentMarkdown).toContain('Educational purpose only');
      expect(lesson.disclaimer).toMatch(/not investment advice/i);
      expect(lesson.questionCount).toBe(3);
      expect(lesson.locked).toBe(false);
      expect(lesson.completed).toBe(false);
    });

    it('completing a later lesson first fails with the prerequisite domain error', async () => {
      const res = await s.agent
        .post(`/api/v1/learning/lessons/${L2}/complete`)
        .set('Idempotency-Key', 'k-l2-early')
        .expect(HttpStatus.CONFLICT);
      expect(errBody(res).error.code).toBe(ErrorCode.PREREQUISITE_NOT_COMPLETED);
    });

    it('completing a quiz-gated lesson without passing fails first', async () => {
      const res = await s.agent
        .post(`/api/v1/learning/lessons/${L1}/complete`)
        .set('Idempotency-Key', 'k-l1-noquiz')
        .expect(HttpStatus.CONFLICT);
      expect(errBody(res).error.code).toBe(ErrorCode.PREREQUISITE_NOT_COMPLETED);
    });

    it('completion requires Idempotency-Key', async () => {
      const res = await s.agent
        .post(`/api/v1/learning/lessons/${L3}/complete`)
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(res).error.code).toBe(ErrorCode.VALIDATION_FAILED);
    });
  });

  // --- quiz --------------------------------------------------------------------

  describe('quiz', () => {
    let s: { agent: Agent; userId: string; accessToken: string };
    let intruder: { agent: Agent; userId: string; accessToken: string };

    beforeAll(async () => {
      s = await registerLogin(server, 'quizzer@example.com');
      intruder = await registerLogin(server, 'intruder@example.com');
    });

    const correctAnswers = () => [
      { questionId: Q.q1 as string, selectedOptionIds: Q.q1Correct as string[] },
      { questionId: Q.q2 as string, selectedOptionIds: Q.q2Correct as string[] },
      { questionId: Q.q3 as string, selectedOptionIds: Q.q3Correct as string[] },
    ];

    it('start attempt strips correctness from options', async () => {
      const res = await s.agent
        .post(`/api/v1/quiz/lessons/${L1}/attempts`)
        .expect(HttpStatus.CREATED);
      const view = okBody<any>(res).data;
      expect(view.attemptId).toBeTruthy();
      expect(view.questions).toHaveLength(3);
      for (const q of view.questions) {
        for (const o of q.options) expect(o.isCorrect).toBeUndefined();
      }
    });

    it('cannot start a quiz on a locked lesson', async () => {
      const res = await s.agent
        .post(`/api/v1/quiz/lessons/${L2}/attempts`)
        .expect(HttpStatus.CONFLICT);
      expect(errBody(res).error.code).toBe(ErrorCode.PREREQUISITE_NOT_COMPLETED);
    });

    it('submit requires Idempotency-Key', async () => {
      const start = await s.agent.post(`/api/v1/quiz/lessons/${L1}/attempts`).expect(201);
      const attemptId = okBody<any>(start).data.attemptId;
      const res = await s.agent
        .post(`/api/v1/quiz/attempts/${attemptId}/submit`)
        .send({ answers: correctAnswers() })
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(res).error.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('submit grades with per-question feedback + explanations, awards quiz XP', async () => {
      const start = await s.agent.post(`/api/v1/quiz/lessons/${L1}/attempts`).expect(201);
      const attemptId = okBody<any>(start).data.attemptId;
      const res = await s.agent
        .post(`/api/v1/quiz/attempts/${attemptId}/submit`)
        .set('Idempotency-Key', 'quiz-pass-1')
        .send({ answers: correctAnswers() });
      expect(res.status).toBe(HttpStatus.CREATED);
      const result = okBody<any>(res).data;
      expect(result.score).toBe(30);
      expect(result.totalPoints).toBe(30);
      expect(result.passed).toBe(true);
      expect(result.feedback).toHaveLength(3);
      for (const f of result.feedback) {
        expect(f.correct).toBe(true);
        expect(f.explanation).toBeTruthy();
        expect(f.correctOptionIds.length).toBeGreaterThan(0);
      }
      expect(result.rewards.xpAwarded).toBe(XP.QUIZ_PASS);
    });

    it('partial MULTI answers score zero; below pass mark fails', async () => {
      const start = await s.agent.post(`/api/v1/quiz/lessons/${L1}/attempts`).expect(201);
      const attemptId = okBody<any>(start).data.attemptId;
      const res = await s.agent
        .post(`/api/v1/quiz/attempts/${attemptId}/submit`)
        .set('Idempotency-Key', 'quiz-fail-1')
        .send({
          answers: [
            { questionId: Q.q1, selectedOptionIds: Q.q1Correct }, // 10
            { questionId: Q.q2, selectedOptionIds: Q.q2Wrong }, // 0 (wrong)
            { questionId: Q.q3, selectedOptionIds: [(Q.q3Correct as string[])[0]] }, // 0 (partial MULTI)
          ],
        })
        .expect(HttpStatus.CREATED);
      const result = okBody<any>(res).data;
      expect(result.score).toBe(10);
      expect(result.passed).toBe(result.score / result.totalPoints >= QUIZ_PASS_MARK);
      expect(result.passed).toBe(false);
      expect(result.rewards.xpAwarded).toBe(0);
    });

    it('submit replay returns 409 IDEMPOTENCY_REPLAY with the original', async () => {
      const start = await s.agent.post(`/api/v1/quiz/lessons/${L1}/attempts`).expect(201);
      const attemptId = okBody<any>(start).data.attemptId;
      const payload = { answers: correctAnswers() };
      const first = await s.agent
        .post(`/api/v1/quiz/attempts/${attemptId}/submit`)
        .set('Idempotency-Key', 'quiz-replay-1')
        .send(payload)
        .expect(201);
      // A new attempt with the same key replays the ORIGINAL result.
      const start2 = await s.agent.post(`/api/v1/quiz/lessons/${L1}/attempts`).expect(201);
      const attempt2 = okBody<any>(start2).data.attemptId;
      const replay = await s.agent
        .post(`/api/v1/quiz/attempts/${attempt2}/submit`)
        .set('Idempotency-Key', 'quiz-replay-1')
        .send(payload)
        .expect(HttpStatus.CONFLICT);
      const body = errBody(replay);
      expect(body.error.code).toBe(ErrorCode.IDEMPOTENCY_REPLAY);
      expect((body.error.details as any).original.score).toBe(okBody<any>(first).data.score);
    });

    it("intruder cannot read or submit another user's attempt", async () => {
      const start = await s.agent.post(`/api/v1/quiz/lessons/${L1}/attempts`).expect(201);
      const attemptId = okBody<any>(start).data.attemptId;
      // Ownership enforced: another user's attempt is forbidden (never leaked).
      await intruder.agent.get(`/api/v1/quiz/attempts/${attemptId}`).expect(HttpStatus.FORBIDDEN);
      await intruder.agent
        .post(`/api/v1/quiz/attempts/${attemptId}/submit`)
        .set('Idempotency-Key', 'intruder-x')
        .send({ answers: correctAnswers() })
        .expect(HttpStatus.FORBIDDEN);
    });
  });

  // --- gamification (full loop) --------------------------------------------------

  describe('gamification', () => {
    let s: { agent: Agent; userId: string; accessToken: string };

    beforeAll(async () => {
      s = await registerLogin(server, 'gamer@example.com');
    });

    async function passQuiz(lessonId: string, answers: any[], key: string): Promise<void> {
      const start = await s.agent.post(`/api/v1/quiz/lessons/${lessonId}/attempts`).expect(201);
      const attemptId = okBody<any>(start).data.attemptId;
      const res = await s.agent
        .post(`/api/v1/quiz/attempts/${attemptId}/submit`)
        .set('Idempotency-Key', key)
        .send({ answers })
        .expect(201);
      expect(okBody<any>(res).data.passed).toBe(true);
    }

    it('full loop: quiz pass → lesson complete → XP + streak + badges, all idempotent', async () => {
      await passQuiz(
        L1,
        [
          { questionId: Q.q1, selectedOptionIds: Q.q1Correct },
          { questionId: Q.q2, selectedOptionIds: Q.q2Correct },
          { questionId: Q.q3, selectedOptionIds: Q.q3Correct },
        ],
        'g-quiz-1'
      );

      // Complete L1 (transactional: completion + XP + streak + badges + outbox).
      const done = await s.agent
        .post(`/api/v1/learning/lessons/${L1}/complete`)
        .set('Idempotency-Key', 'g-complete-1')
        .expect(HttpStatus.CREATED);
      const completion = okBody<any>(done).data;
      expect(completion.rewards.xpAwarded).toBe(XP.LESSON_COMPLETION);
      expect(completion.rewards.applied).toBe(true);
      expect(completion.rewards.currentStreak).toBe(1);
      expect(completion.rewards.newBadges.map((b: any) => b.slug)).toContain('first-lesson');

      // Replay with the same key → original result, nothing double-applied.
      const replay = await s.agent
        .post(`/api/v1/learning/lessons/${L1}/complete`)
        .set('Idempotency-Key', 'g-complete-1')
        .expect(HttpStatus.CONFLICT);
      const replayBody = errBody(replay);
      expect(replayBody.error.code).toBe(ErrorCode.IDEMPOTENCY_REPLAY);
      expect((replayBody.error.details as any).original.rewards.xpAwarded).toBe(
        XP.LESSON_COMPLETION
      );

      // Same lesson, NEW key → already completed (never double XP).
      const dup = await s.agent
        .post(`/api/v1/learning/lessons/${L1}/complete`)
        .set('Idempotency-Key', 'g-complete-2')
        .expect(HttpStatus.CONFLICT);
      expect(errBody(dup).error.code).toBe(ErrorCode.CONFLICT);

      // L2 unlocks now; pass its quiz and complete it.
      await passQuiz(
        L2,
        [
          { questionId: Q.q4, selectedOptionIds: Q.q4Correct },
          { questionId: Q.q5, selectedOptionIds: Q.q5Correct },
        ],
        'g-quiz-2'
      );
      await s.agent
        .post(`/api/v1/learning/lessons/${L2}/complete`)
        .set('Idempotency-Key', 'g-complete-3')
        .expect(HttpStatus.CREATED);

      // L3 has no quiz — completes directly, finishing the track.
      const l3 = await s.agent
        .post(`/api/v1/learning/lessons/${L3}/complete`)
        .set('Idempotency-Key', 'g-complete-4')
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(l3).data.rewards.newBadges.map((b: any) => b.slug)).toContain(
        'foundation-graduate'
      );

      // Dashboard: XP = 2 quiz passes + 3 completions; streak 1; badges; track 3/3.
      const dash = await s.agent.get('/api/v1/gamification/dashboard').expect(HttpStatus.OK);
      const d = okBody<any>(dash).data;
      expect(d.stats.totalXp).toBe(2 * XP.QUIZ_PASS + 3 * XP.LESSON_COMPLETION);
      expect(d.stats.level).toBe(2); // 190 XP >= 100 threshold
      expect(d.stats.currentStreak).toBe(1);
      expect(d.badges.map((b: any) => b.slug)).toEqual(
        expect.arrayContaining(['first-lesson', 'foundation-graduate'])
      );
      expect(d.tracks[0].slug).toBe('foundations');
      expect(d.tracks[0].completedLessons).toBe(3);
      expect(d.tracks[0].totalLessons).toBe(3);
    });

    it('progress is per-user: a fresh user sees zero XP (ownership by construction)', async () => {
      const fresh = await registerLogin(server, 'freshgamer@example.com');
      const dash = await fresh.agent.get('/api/v1/gamification/dashboard').expect(HttpStatus.OK);
      const d = okBody<any>(dash).data;
      expect(d.stats.totalXp).toBe(0);
      expect(d.badges).toHaveLength(0);
      expect(d.tracks[0].completedLessons).toBe(0);
    });
  });

  // --- admin CMS -----------------------------------------------------------------

  describe('admin CMS', () => {
    let admin: { agent: Agent; userId: string; accessToken: string };
    let learner: { agent: Agent; userId: string; accessToken: string };

    beforeAll(async () => {
      admin = await registerLogin(server, 'admin@example.com', { roles: ['ADMIN'] });
      learner = await registerLogin(server, 'pleb@example.com');
    });

    it('non-admin is forbidden from admin routes', async () => {
      await learner.agent
        .post('/api/v1/admin/tracks')
        .send({ slug: 'x', title: 'X' })
        .expect(HttpStatus.FORBIDDEN);
      await learner.agent.get('/api/v1/admin/audit-log').expect(HttpStatus.FORBIDDEN);
    });

    it('track → module → lesson → draft → question → publish flow', async () => {
      const t = await admin.agent
        .post('/api/v1/admin/tracks')
        .send({
          slug: 'test-track',
          title: 'Test Track',
          description: 'A test track for e2e.',
          order: 5,
        })
        .expect(HttpStatus.CREATED);
      const trackId = okBody<any>(t).data.id;

      await admin.agent
        .patch(`/api/v1/admin/tracks/${trackId}`)
        .send({ title: 'Test Track 2' })
        .expect(HttpStatus.OK);
      await admin.agent.post(`/api/v1/admin/tracks/${trackId}/publish`).expect(HttpStatus.CREATED);

      const m = await admin.agent
        .post('/api/v1/admin/modules')
        .send({ trackId, title: 'M1', order: 0 })
        .expect(HttpStatus.CREATED);
      const moduleId = okBody<any>(m).data.id;
      await admin.agent
        .post(`/api/v1/admin/modules/${moduleId}/publish`)
        .expect(HttpStatus.CREATED);

      const l = await admin.agent
        .post('/api/v1/admin/lessons')
        .send({ moduleId, title: 'Lesson A', order: 0 })
        .expect(HttpStatus.CREATED);
      const lessonId = okBody<any>(l).data.lesson.id;

      // Draft exists (v1); edit it.
      const draft = await admin.agent
        .get(`/api/v1/admin/lessons/${lessonId}/draft`)
        .expect(HttpStatus.OK);
      expect(okBody<any>(draft).data.version).toBe(1);
      await admin.agent
        .patch(`/api/v1/admin/lessons/${lessonId}/draft`)
        .send({ contentMarkdown: 'Draft content v1.' })
        .expect(HttpStatus.OK);

      // Add a question to the draft.
      const q = await admin.agent
        .post(`/api/v1/admin/lessons/${lessonId}/questions`)
        .send({
          text: 'What is 2+2?',
          explanation: 'Basic arithmetic.',
          kind: 'SINGLE',
          order: 0,
          points: 10,
          options: [
            { text: '4', isCorrect: true, order: 0 },
            { text: '5', isCorrect: false, order: 1 },
          ],
        })
        .expect(HttpStatus.CREATED);
      const questionId = okBody<any>(q).data.id;

      // Publish v1.
      const pub = await admin.agent
        .post(`/api/v1/admin/lessons/${lessonId}/publish`)
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(pub).data.status).toBe('PUBLISHED');

      // Published version is immutable: editing the question now fails…
      await admin.agent
        .patch(`/api/v1/admin/questions/${questionId}`)
        .send({ text: 'Hacked?' })
        .expect(HttpStatus.CONFLICT);
      await admin.agent.delete(`/api/v1/admin/questions/${questionId}`).expect(HttpStatus.CONFLICT);

      // …edits go to a new draft (v2), published versions untouched.
      const draft2 = await admin.agent
        .patch(`/api/v1/admin/lessons/${lessonId}/draft`)
        .send({ contentMarkdown: 'Draft content v2.' })
        .expect(HttpStatus.OK);
      expect(okBody<any>(draft2).data.version).toBe(2);
      const versions = await admin.agent
        .get(`/api/v1/admin/lessons/${lessonId}/versions`)
        .expect(HttpStatus.OK);
      const vs = okBody<any[]>(versions).data;
      expect(vs.map((v: any) => v.version).sort()).toEqual([1, 2]);
      expect(vs.find((v: any) => v.version === 1).contentMarkdown).toBe('Draft content v1.');
    });

    it('admin track tree + draft questions list', async () => {
      // Seed a track via the API, then read the tree.
      const t = await admin.agent
        .post('/api/v1/admin/tracks')
        .send({
          slug: 'tree-track',
          title: 'Tree Track',
          description: 'Tree description here.',
          order: 9,
        })
        .expect(HttpStatus.CREATED);
      const trackId = okBody<any>(t).data.id;
      const m = await admin.agent
        .post('/api/v1/admin/modules')
        .send({ trackId, title: 'TM1', order: 0 })
        .expect(HttpStatus.CREATED);
      const moduleId = okBody<any>(m).data.id;
      const l = await admin.agent
        .post('/api/v1/admin/lessons')
        .send({ moduleId, title: 'TL1', order: 0 })
        .expect(HttpStatus.CREATED);
      const lessonId = okBody<any>(l).data.lesson.id;

      const tree = await admin.agent.get(`/api/v1/admin/tracks/${trackId}`).expect(HttpStatus.OK);
      const treeData = okBody<any>(tree).data;
      expect(treeData.modules).toHaveLength(1);
      expect(treeData.modules[0].lessons).toHaveLength(1);
      expect(treeData.modules[0].lessons[0].latestVersion.status).toBe('DRAFT');

      await admin.agent
        .get('/api/v1/admin/tracks/00000000-0000-4000-8000-000000000000')
        .expect(HttpStatus.NOT_FOUND);

      const qs = await admin.agent
        .get(`/api/v1/admin/lessons/${lessonId}/questions`)
        .expect(HttpStatus.OK);
      expect(okBody<any[]>(qs).data).toHaveLength(0);
    });

    it('audit log records admin actions with actor, before/after, IP', async () => {
      const res = await admin.agent
        .get('/api/v1/admin/audit-log')
        .query({ limit: 5 })
        .expect(HttpStatus.OK);
      const log = okBody<any>(res).data;
      expect(log.total).toBeGreaterThan(0);
      const entry = log.items[0];
      expect(entry.actorId).toBe(admin.userId);
      expect(entry.action).toBeTruthy();
      expect(entry.entityType).toBeTruthy();
      expect(entry.createdAt).toBeTruthy();
    });
  });

  // --- simulator -----------------------------------------------------------------

  describe('simulator', () => {
    let trader: { agent: Agent; userId: string };
    let instrumentId: string;
    let instrumentSymbol: string;

    beforeAll(async () => {
      trader = await registerLogin(server, 'trader@example.com');
      const res = await trader.agent.get('/api/v1/simulator/instruments').expect(HttpStatus.OK);
      const instruments = okBody<any[]>(res).data;
      instrumentId = instruments[0].id;
      instrumentSymbol = instruments[0].symbol;
    });

    async function portfolioCash(): Promise<string> {
      const res = await trader.agent.get('/api/v1/simulator/portfolio').expect(HttpStatus.OK);
      return okBody<any>(res).data.cash as string;
    }

    async function placeOrder(
      body: Record<string, unknown>,
      key = uuidv4(),
      expectedStatus = HttpStatus.CREATED
    ): Promise<request.Response> {
      return trader.agent
        .post('/api/v1/simulator/orders')
        .set('Idempotency-Key', key)
        .send(body)
        .expect(expectedStatus);
    }

    it('instruments are public and carry simulated prices', async () => {
      const res = await request(server).get('/api/v1/simulator/instruments').expect(HttpStatus.OK);
      const instruments = okBody<any[]>(res).data;
      expect(instruments).toHaveLength(6);
      for (const i of instruments) {
        expect(i.symbol).toMatch(/^[A-Z]{4}$/);
        expect(Number(i.price)).toBeGreaterThan(0);
      }
      const symbols = instruments.map((i: any) => i.symbol);
      expect(symbols).not.toContain('RELIANCE');
      expect(symbols).not.toContain('TCS');
    });

    it('portfolio requires auth', async () => {
      await request(server).get('/api/v1/simulator/portfolio').expect(HttpStatus.UNAUTHORIZED);
    });

    it('a new portfolio starts with 100,000 virtual cash', async () => {
      const res = await trader.agent.get('/api/v1/simulator/portfolio').expect(HttpStatus.OK);
      const portfolio = okBody<any>(res).data;
      expect(portfolio.cash).toBe('100000.00');
      expect(portfolio.totalEquity).toBe('100000.00');
      expect(portfolio.holdings).toEqual([]);
    });

    it('placing an order requires an Idempotency-Key', async () => {
      const res = await trader.agent
        .post('/api/v1/simulator/orders')
        .send({ instrumentId, side: 'BUY', quantity: 1 })
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(res).error.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('BUY spends virtual cash and creates a holding at the simulated price', async () => {
      const res = await placeOrder({ instrumentId, side: 'BUY', quantity: 10 });
      const body = okBody<any>(res).data;
      expect(body.order.symbol).toBe(instrumentSymbol);
      expect(body.order.side).toBe('BUY');
      expect(body.order.quantity).toBe('10');
      const price = Number(body.order.price);
      expect(price).toBeGreaterThan(0);

      const expectedCost = Math.round(price * 10 * 100) / 100;
      expect(await portfolioCash()).toBe((100000 - expectedCost).toFixed(2));

      const pf = okBody<any>(await trader.agent.get('/api/v1/simulator/portfolio')).data;
      expect(pf.holdings).toHaveLength(1);
      expect(pf.holdings[0].quantity).toBe('10');
      expect(pf.holdings[0].avgCost).toBe(price.toFixed(2));
      // Equity = cash + market value ≈ starting cash (same-minute price).
      expect(Math.abs(Number(pf.totalEquity) - 100000)).toBeLessThan(5000);
    });

    it('a trade grants XP exactly once (event-driven, idempotent)', async () => {
      const dash = okBody<any>(await trader.agent.get('/api/v1/gamification/dashboard')).data;
      expect(dash.stats.totalXp).toBe(5);

      // The outbox carries the trade event for the relay recovery path.
      const tradeEvents = db.outbox.filter((r: any) => r.type === 'trade.executed');
      expect(tradeEvents.length).toBeGreaterThan(0);
      expect(tradeEvents[0].payload.symbol).toBe(instrumentSymbol);
    });

    it('replays with the same Idempotency-Key return the original result without double-spend', async () => {
      const key = uuidv4();
      const first = await placeOrder({ instrumentId, side: 'BUY', quantity: 2 }, key);
      const firstOrderId = okBody<any>(first).data.order.id;
      const cashAfterFirst = await portfolioCash();

      const replay = await placeOrder(
        { instrumentId, side: 'BUY', quantity: 2 },
        key,
        HttpStatus.CONFLICT
      );
      const replayBody = errBody(replay);
      expect(replayBody.error.code).toBe(ErrorCode.IDEMPOTENCY_REPLAY);
      expect((replayBody.error.details as any).original.order.id).toBe(firstOrderId);
      expect(await portfolioCash()).toBe(cashAfterFirst);
    });

    it('BUY beyond virtual cash is rejected with INSUFFICIENT_FUNDS', async () => {
      const res = await placeOrder(
        { instrumentId, side: 'BUY', quantity: 1_000_000 },
        uuidv4(),
        HttpStatus.CONFLICT
      );
      expect(errBody(res).error.code).toBe(ErrorCode.INSUFFICIENT_FUNDS);
    });

    it('SELL converts holdings back to virtual cash', async () => {
      const cashBefore = Number(await portfolioCash());
      const res = await placeOrder({ instrumentId, side: 'SELL', quantity: 4 });
      const proceeds = Number(okBody<any>(res).data.order.totalValue);
      expect(await portfolioCash()).toBe((cashBefore + proceeds).toFixed(2));

      const pf = okBody<any>(await trader.agent.get('/api/v1/simulator/portfolio')).data;
      // 10 + 2 bought, 4 sold = 8 remaining.
      expect(pf.holdings[0].quantity).toBe('8');
    });

    it('SELL without enough holdings is rejected with INSUFFICIENT_HOLDINGS', async () => {
      const res = await placeOrder(
        { instrumentId, side: 'SELL', quantity: 1_000_000 },
        uuidv4(),
        HttpStatus.CONFLICT
      );
      expect(errBody(res).error.code).toBe(ErrorCode.INSUFFICIENT_HOLDINGS);
    });

    it('selling the entire position removes the holding', async () => {
      await placeOrder({ instrumentId, side: 'SELL', quantity: 8 });
      const pf = okBody<any>(await trader.agent.get('/api/v1/simulator/portfolio')).data;
      expect(pf.holdings).toEqual([]);
    });

    it('order history is paginated, newest first, and scoped to the caller', async () => {
      const res = await trader.agent
        .get('/api/v1/simulator/orders')
        .query({ page: 1, limit: 2 })
        .expect(HttpStatus.OK);
      const body = okBody<any>(res).data;
      expect(body.items).toHaveLength(2);
      expect(body.meta.total).toBeGreaterThanOrEqual(4);
      expect(body.meta.page).toBe(1);
      const times = body.items.map((o: any) => new Date(o.executedAt).getTime());
      expect(times[0]).toBeGreaterThanOrEqual(times[1]);

      // Another user sees an empty history — portfolios never leak across users.
      const other = await registerLogin(server, 'other-trader@example.com');
      const otherRes = await other.agent.get('/api/v1/simulator/orders').expect(HttpStatus.OK);
      expect(okBody<any>(otherRes).data.meta.total).toBe(0);
    });

    it('invalid order input is rejected at the boundary', async () => {
      // Negative quantity.
      const neg = await placeOrder(
        { instrumentId, side: 'BUY', quantity: -5 },
        uuidv4(),
        HttpStatus.BAD_REQUEST
      );
      expect(errBody(neg).error.code).toBe(ErrorCode.VALIDATION_FAILED);

      // Unknown side.
      const side = await placeOrder(
        { instrumentId, side: 'HOLD', quantity: 1 },
        uuidv4(),
        HttpStatus.BAD_REQUEST
      );
      expect(errBody(side).error.code).toBe(ErrorCode.VALIDATION_FAILED);

      // Unknown instrument id shape.
      const badId = await placeOrder(
        { instrumentId: 'not-a-uuid', side: 'BUY', quantity: 1 },
        uuidv4(),
        HttpStatus.BAD_REQUEST
      );
      expect(errBody(badId).error.code).toBe(ErrorCode.VALIDATION_FAILED);

      // Well-formed UUID but no such instrument.
      const missing = await placeOrder(
        { instrumentId: uuidv4(), side: 'BUY', quantity: 1 },
        uuidv4(),
        HttpStatus.NOT_FOUND
      );
      expect(errBody(missing).error.code).toBe(ErrorCode.NOT_FOUND);
    });
  });

  // --- onboarding assessment (docs/03) ---------------------------------------------

  describe('onboarding', () => {
    // --- helpers -----------------------------------------------------------------

    async function registerOnboard(email: string): Promise<{ token: string; userId: string }> {
      const { accessToken, userId } = await registerLogin(server, email);
      return { token: accessToken, userId };
    }

    /** Full-correct answer set (all CONFIDENT) for the bank seeded above. */
    function allCorrectAnswers(): Array<{
      questionId: string;
      selectedOptionIds: string[];
      confidence: string;
    }> {
      const out: Array<{ questionId: string; selectedOptionIds: string[]; confidence: string }> =
        [];
      for (let n = 1; n <= 12; n++) {
        out.push({
          questionId: AQ[`q${n}`] as string,
          selectedOptionIds: [...(AQ[`q${n}Correct`] as string[])],
          confidence: 'CONFIDENT',
        });
      }
      return out;
    }

    async function startAttempt(token: string): Promise<{ versionId: string; attemptId: string }> {
      const res = await request(server)
        .post('/api/v1/onboarding/assessment/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.CREATED);
      const data = okBody<{ versionId: string; attemptId: string }>(res).data;
      return { versionId: data.versionId, attemptId: data.attemptId };
    }

    function submitUrl(attemptId: string): string {
      return `/api/v1/onboarding/assessment/attempts/${attemptId}/submit`;
    }

    /** Runs a full start → submit cycle; returns the submit body. */
    async function submitAttempt(token: string, key = 'k1', answers?: any): Promise<any> {
      const { attemptId } = await startAttempt(token);
      const res = await request(server)
        .post(submitUrl(attemptId))
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', key)
        .send({ answers: answers ?? allCorrectAnswers() })
        .expect(HttpStatus.CREATED);
      return okBody<Record<string, any>>(res).data;
    }

    // --- start -------------------------------------------------------------------

    it('requires auth', async () => {
      await request(server)
        .post('/api/v1/onboarding/assessment/start')
        .expect(HttpStatus.UNAUTHORIZED);
    });

    it('start returns 12 questions with no correct answers or explanations', async () => {
      const { token } = await registerOnboard('ob1@example.com');
      const res = await request(server)
        .post('/api/v1/onboarding/assessment/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.CREATED);
      const data = okBody<Record<string, any>>(res).data;
      expect(data.questions).toHaveLength(12);
      for (const q of data.questions) {
        expect(q).not.toHaveProperty('topicKey');
        expect(q).not.toHaveProperty('explanation');
        expect(q.options).toHaveLength(4);
        for (const o of q.options) {
          expect(o).not.toHaveProperty('isCorrect');
        }
      }
    });

    it('second start resumes the same attempt', async () => {
      const { token } = await registerOnboard('ob2@example.com');
      const first = await request(server)
        .post('/api/v1/onboarding/assessment/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.CREATED);
      const second = await request(server)
        .post('/api/v1/onboarding/assessment/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.CREATED);
      expect(okBody<Record<string, any>>(second).data.attemptId).toBe(
        okBody<Record<string, any>>(first).data.attemptId
      );
    });

    // --- submit ------------------------------------------------------------------

    it('full correct submit: all level 5, FAST_TRACK, profile created', async () => {
      const { token } = await registerOnboard('ob3@example.com');
      const data = await submitAttempt(token);
      expect(data.topics).toHaveLength(4);
      for (const t of data.topics) {
        expect(t.level).toBe(5);
        expect(t.label).toBe('Market Ready');
        expect(t).not.toHaveProperty('score');
      }
      expect(data.overallLevel).toBe(5);
      expect(data.placement.kind).toBe('FAST_TRACK');
      expect(data.placement.recommendedStartModuleOrder).toBe(3);
      // No bonus on submit — the one-time 50 XP is granted on placement accept (spec §6.3).

      const profile = await request(server)
        .get('/api/v1/onboarding/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.OK);
      expect(okBody<Record<string, any>>(profile).data.overallLevel).toBe(5);
      expect(okBody<Record<string, any>>(profile).data.topicLevels.placement.kind).toBe(
        'FAST_TRACK'
      );

      // Answers must never leak correctness or explanations in the submit response either.
      for (const t of data.topics) {
        expect(t).not.toHaveProperty('answers');
      }
    });

    it('submit rejects bad payloads', async () => {
      const { token } = await registerOnboard('ob4@example.com');
      const { attemptId } = await startAttempt(token);
      const url = submitUrl(attemptId);

      // 11 answers.
      const short = allCorrectAnswers().slice(0, 11);
      await request(server)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-short')
        .send({ answers: short })
        .expect(HttpStatus.BAD_REQUEST);

      // Malformed attempt UUID in the path.
      await request(server)
        .post(submitUrl('not-a-uuid'))
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-bad-uuid')
        .send({ answers: allCorrectAnswers() })
        .expect(HttpStatus.BAD_REQUEST);

      // Malformed question UUID in the body.
      const badQ = allCorrectAnswers();
      badQ[0] = { ...(badQ[0] as (typeof badQ)[number]), questionId: 'not-a-uuid' };
      await request(server)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-bad-q-uuid')
        .send({ answers: badQ })
        .expect(HttpStatus.BAD_REQUEST);

      // Duplicate question id.
      const dup = allCorrectAnswers();
      dup[1] = dup[0] as (typeof dup)[number];
      await request(server)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-dup')
        .send({ answers: dup })
        .expect(HttpStatus.BAD_REQUEST);
    });

    it('submit requires an Idempotency-Key', async () => {
      // Fresh user, first attempt: no key → the idempotency guard rejects with 400.
      const { token } = await registerOnboard('ob5@example.com');
      const { attemptId } = await startAttempt(token);
      const res = await request(server)
        .post(submitUrl(attemptId))
        .set('Authorization', `Bearer ${token}`)
        .send({ answers: allCorrectAnswers() })
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(res).error.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('replaying the same Idempotency-Key returns IDEMPOTENCY_REPLAY', async () => {
      const { token } = await registerOnboard('ob6@example.com');
      const { attemptId } = await startAttempt(token);
      const url = submitUrl(attemptId);
      await request(server)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'replay-key')
        .send({ answers: allCorrectAnswers() })
        .expect(HttpStatus.CREATED);
      const replay = await request(server)
        .post(url)
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'replay-key')
        .send({ answers: allCorrectAnswers() })
        .expect(HttpStatus.CONFLICT);
      expect(errBody(replay).error.code).toBe(ErrorCode.IDEMPOTENCY_REPLAY);
    });

    it("one user cannot submit another user's attempt", async () => {
      const a = await registerOnboard('ob7a@example.com');
      const b = await registerOnboard('ob7b@example.com');
      const { attemptId } = await startAttempt(a.token);
      const res = await request(server)
        .post(submitUrl(attemptId))
        .set('Authorization', `Bearer ${b.token}`)
        .set('Idempotency-Key', 'k-cross')
        .send({ answers: allCorrectAnswers() })
        .expect(HttpStatus.FORBIDDEN);
      expect(errBody(res).error.code).toBe(ErrorCode.FORBIDDEN);
    });

    it('abandon blocks later submit', async () => {
      const { token } = await registerOnboard('ob8@example.com');
      const { attemptId } = await startAttempt(token);
      await request(server)
        .post(`/api/v1/onboarding/assessment/attempts/${attemptId}/abandon`)
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.CREATED);
      const res = await request(server)
        .post(submitUrl(attemptId))
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'k-abandon')
        .send({ answers: allCorrectAnswers() })
        .expect(HttpStatus.CONFLICT);
      expect(errBody(res).error.code).toBe(ErrorCode.ASSESSMENT_ALREADY_SUBMITTED);
    });

    // --- retakes -----------------------------------------------------------------

    it('retake cooldown blocks start within 7 days; exhaustion after 3 submits', async () => {
      const { token } = await registerOnboard('ob9@example.com');
      const db = (global as any).__fakeDb as FakeDb;

      // Submit 1 → cooldown blocks start.
      const { attemptId: id1 } = await startAttempt(token);
      await request(server)
        .post(submitUrl(id1))
        .set('Authorization', `Bearer ${token}`)
        .set('Idempotency-Key', 'cool-1')
        .send({ answers: allCorrectAnswers() })
        .expect(HttpStatus.CREATED);
      const soon = await request(server)
        .post('/api/v1/onboarding/assessment/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(429);
      expect(errBody(soon).error.code).toBe(ErrorCode.ASSESSMENT_RETAKE_TOO_SOON);

      // Age submit 1 past cooldown → submits 2 and 3 succeed.
      db.assessmentAttempts.get(id1).submittedAt = new Date(Date.now() - 8 * 24 * 3600_000);
      for (let i = 2; i <= 3; i++) {
        const { attemptId: id } = await startAttempt(token);
        await request(server)
          .post(submitUrl(id))
          .set('Authorization', `Bearer ${token}`)
          .set('Idempotency-Key', `cool-${i}`)
          .send({ answers: allCorrectAnswers() })
          .expect(HttpStatus.CREATED);
        db.assessmentAttempts.get(id).submittedAt = new Date(Date.now() - 8 * 24 * 3600_000);
      }

      // 4th start → attempts exhausted.
      const exhausted = await request(server)
        .post('/api/v1/onboarding/assessment/start')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.FORBIDDEN);
      expect(errBody(exhausted).error.code).toBe(ErrorCode.ASSESSMENT_ATTEMPTS_EXHAUSTED);
    });

    // --- placement ---------------------------------------------------------------

    it('placement accept grants the 50 XP bonus exactly once and unlocks waived modules', async () => {
      const { token } = await registerOnboard('ob10@example.com');
      await submitAttempt(token, 'k-place');

      const accept = await request(server)
        .post('/api/v1/onboarding/placement/accept')
        .set('Authorization', `Bearer ${token}`)
        .send({ choice: 'RECOMMENDED' })
        .expect(HttpStatus.CREATED);
      const placed = okBody<Record<string, any>>(accept).data;
      expect(placed.placementChoice).toBe('RECOMMENDED');
      expect(placed.rewards.xpAwarded).toBe(50);
      expect(placed.waivedUpToModuleOrder).toBe(3);

      // XP ledger carries exactly one onboarding bonus for the user.
      const db = (global as any).__fakeDb as FakeDb;
      const bonusEntries = db.xpLedger.filter((e: any) => e.reason === 'onboarding.completed');
      expect(bonusEntries).toHaveLength(1);
      expect(bonusEntries[0].amount).toBe(50);

      // Second accept → single-use violation.
      const again = await request(server)
        .post('/api/v1/onboarding/placement/accept')
        .set('Authorization', `Bearer ${token}`)
        .send({ choice: 'FROM_BEGINNING' })
        .expect(HttpStatus.CONFLICT);
      expect(errBody(again).error.code).toBe(ErrorCode.PLACEMENT_ALREADY_ACCEPTED);

      // Accept without a submit → 404.
      const fresh = await registerOnboard('ob10b@example.com');
      await request(server)
        .post('/api/v1/onboarding/placement/accept')
        .set('Authorization', `Bearer ${fresh.token}`)
        .send({ choice: 'RECOMMENDED' })
        .expect(HttpStatus.NOT_FOUND);
    });

    it('FROM_BEGINNING creates no waiver but still grants the one-time bonus', async () => {
      const { token } = await registerOnboard('ob11@example.com');
      await submitAttempt(token, 'k-from-beginning');
      const accept = await request(server)
        .post('/api/v1/onboarding/placement/accept')
        .set('Authorization', `Bearer ${token}`)
        .send({ choice: 'FROM_BEGINNING' })
        .expect(HttpStatus.CREATED);
      expect(okBody<Record<string, any>>(accept).data.waivedUpToModuleOrder).toBeNull();
      expect(okBody<Record<string, any>>(accept).data.rewards.xpAwarded).toBe(50);
    });

    // --- learning gate -----------------------------------------------------------

    it('waiver unlocks placed-out modules; fresh users still see locked', async () => {
      const waived = await registerOnboard('ob12a@example.com');
      await submitAttempt(waived.token, 'k-gate');
      await request(server)
        .post('/api/v1/onboarding/placement/accept')
        .set('Authorization', `Bearer ${waived.token}`)
        .send({ choice: 'RECOMMENDED' })
        .expect(HttpStatus.CREATED);

      const track = await request(server)
        .get('/api/v1/learning/tracks/foundations')
        .set('Authorization', `Bearer ${waived.token}`)
        .expect(HttpStatus.OK);
      const modules: Array<any> = okBody<Record<string, any>>(track).data.modules;
      const mod2 = modules.find((m) => m.id === 'mod2');
      expect(mod2.lessons.every((l: any) => l.locked === false)).toBe(true);

      // Fresh user without a waiver: later modules stay locked.
      const fresh = await registerOnboard('ob12b@example.com');
      const track2 = await request(server)
        .get('/api/v1/learning/tracks/foundations')
        .set('Authorization', `Bearer ${fresh.token}`)
        .expect(HttpStatus.OK);
      const modules2: Array<any> = okBody<Record<string, any>>(track2).data.modules;
      const mod2fresh = modules2.find((m) => m.id === 'mod2');
      expect(mod2fresh.lessons.every((l: any) => l.locked === true)).toBe(true);
    });

    it('completeLesson honours the waiver on prerequisites', async () => {
      const waived = await registerOnboard('ob13a@example.com');
      await submitAttempt(waived.token, 'k-gate2');
      await request(server)
        .post('/api/v1/onboarding/placement/accept')
        .set('Authorization', `Bearer ${waived.token}`)
        .send({ choice: 'RECOMMENDED' })
        .expect(HttpStatus.CREATED);
      // L3 lives in module order 1 (< waivedUpTo 2) and has no quiz gate.
      const completed = await request(server)
        .post(`/api/v1/learning/lessons/${L3}/complete`)
        .set('Authorization', `Bearer ${waived.token}`)
        .set('Idempotency-Key', 'gate-l3')
        .expect(HttpStatus.CREATED);
      expect(okBody<Record<string, any>>(completed).data.rewards).toBeDefined();

      // Fresh user → prerequisite gate fires.
      const fresh = await registerOnboard('ob13b@example.com');
      const res = await request(server)
        .post(`/api/v1/learning/lessons/${L3}/complete`)
        .set('Authorization', `Bearer ${fresh.token}`)
        .set('Idempotency-Key', 'gate-l3-fresh')
        .expect(HttpStatus.CONFLICT);
      expect(errBody(res).error.code).toBe(ErrorCode.PREREQUISITE_NOT_COMPLETED);
    });

    // --- admin bank --------------------------------------------------------------

    it('admin bank read returns answers; non-admin is forbidden', async () => {
      const { token } = await registerOnboard('ob14a@example.com');
      const res = await request(server)
        .get('/api/v1/onboarding/assessment/bank')
        .set('Authorization', `Bearer ${token}`)
        .expect(HttpStatus.FORBIDDEN);
      expect(errBody(res).error.code).toBe(ErrorCode.FORBIDDEN);

      const { accessToken: adminToken } = await registerLogin(server, 'ob14admin@example.com', {
        roles: ['ADMIN'],
      });
      const bank = await request(server)
        .get('/api/v1/onboarding/assessment/bank')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(HttpStatus.OK);
      const versions: Array<any> = okBody<Array<any>>(bank).data;
      expect(versions).toHaveLength(1);
      expect(versions[0].questions).toHaveLength(12);
      const first = versions[0].questions[0];
      expect(first).toHaveProperty('explanation');
      expect(first.options.some((o: any) => o.isCorrect === true)).toBe(true);
    });

    // Note: the strict rate-limit bucket wiring (prefix match on
    // /api/v1/onboarding/assessment) is config in .env.example; the limit
    // value itself is env-driven, so no request-count assertion here.
  });

  // --- ratings (docs/04) -----------------------------------------------------------

  describe('ratings', () => {
    let alice: { agent: Agent; userId: string; accessToken: string };
    let bob: { agent: Agent; userId: string; accessToken: string };
    let carol: { agent: Agent; userId: string; accessToken: string };
    let admin: { agent: Agent; userId: string; accessToken: string };

    beforeAll(async () => {
      alice = await registerLogin(server, 'r-alice@example.com');
      bob = await registerLogin(server, 'r-bob@example.com');
      carol = await registerLogin(server, 'r-carol@example.com');
      admin = await registerLogin(server, 'r-admin@example.com', { roles: ['ADMIN'] });
      // 30 s: registering 4 users hashes 4 passwords (Argon2) and exceeds
      // Jest's 5-second default hook timeout on a loaded VM — same
      // precedent as the question-bank beforeAll (ADR 0005 §15.13).
    }, 30000);

    it('PATCH /users/me sets a country; invalid codes are rejected at the boundary', async () => {
      const res = await alice.agent
        .patch('/api/v1/users/me')
        .send({ countryCode: 'IN' })
        .expect(HttpStatus.OK);
      expect(okBody<{ countryCode: string }>(res).data.countryCode).toBe('IN');

      await bob.agent.patch('/api/v1/users/me').send({ countryCode: 'US' }).expect(HttpStatus.OK);

      // 3 letters, lowercase, and empty all fail validation.
      for (const bad of ['IND', 'in', '']) {
        const badRes = await carol.agent
          .patch('/api/v1/users/me')
          .send({ countryCode: bad })
          .expect(HttpStatus.BAD_REQUEST);
        expect(errBody(badRes).error.code).toBe(ErrorCode.VALIDATION_FAILED);
      }
    });

    it('changing country to a different code within 90 days is a 409; same code is a no-op', async () => {
      const res = await alice.agent
        .patch('/api/v1/users/me')
        .send({ countryCode: 'US' })
        .expect(HttpStatus.CONFLICT);
      expect(errBody(res).error.code).toBe(ErrorCode.RATING_COUNTRY_COOLDOWN);

      const same = await alice.agent
        .patch('/api/v1/users/me')
        .send({ countryCode: 'IN' })
        .expect(HttpStatus.OK);
      expect(okBody<{ countryCode: string }>(same).data.countryCode).toBe('IN');
    });

    it('GET /ratings/me defaults a fresh user to 1000 / Bronze / provisional', async () => {
      const res = await carol.agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
      const me = okBody<any>(res).data;
      expect(me.learning.rating).toBe(1000);
      expect(me.learning.tier).toBe('Bronze');
      expect(me.learning.provisional).toBe(true);
      expect(me.learning.gamesPlayed).toBe(0);
      expect(me.trading.rating).toBe(1000);
      expect(me.candleRating).toBe(1000);
      expect(me.candleTier).toBe('Bronze');
      expect(me.countryCode).toBeNull();
      expect(me.learning.globalRank).toBeNull();
    });

    it('ratings reads require auth', async () => {
      await request(server).get('/api/v1/ratings/me').expect(HttpStatus.UNAUTHORIZED);
    });

    it('duel validation: missing key, mismatched key, self-duel, unknown opponent', async () => {
      // No Idempotency-Key header.
      const noKey = await alice.agent
        .post('/api/v1/ratings/duels')
        .send({ opponentId: bob.userId, result: 'WIN', idempotencyKey: 'd-no-key' })
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(noKey).error.code).toBe(ErrorCode.VALIDATION_FAILED);

      // Body key must match the header.
      const mismatch = await alice.agent
        .post('/api/v1/ratings/duels')
        .set('Idempotency-Key', 'header-key')
        .send({ opponentId: bob.userId, result: 'WIN', idempotencyKey: 'body-key' })
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(mismatch).error.code).toBe(ErrorCode.VALIDATION_FAILED);

      // Self-duel.
      const self = await alice.agent
        .post('/api/v1/ratings/duels')
        .set('Idempotency-Key', 'd-self')
        .send({ opponentId: alice.userId, result: 'WIN', idempotencyKey: 'd-self' })
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(self).error.code).toBe(ErrorCode.VALIDATION_FAILED);

      // Unknown opponent.
      const ghost = await alice.agent
        .post('/api/v1/ratings/duels')
        .set('Idempotency-Key', 'd-ghost')
        .send({ opponentId: uuidv4(), result: 'WIN', idempotencyKey: 'd-ghost' })
        .expect(HttpStatus.NOT_FOUND);
      expect(errBody(ghost).error.code).toBe(ErrorCode.NOT_FOUND);

      // Bad result enum.
      const badResult = await alice.agent
        .post('/api/v1/ratings/duels')
        .set('Idempotency-Key', 'd-bad-result')
        .send({ opponentId: bob.userId, result: 'WON', idempotencyKey: 'd-bad-result' })
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(badResult).error.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('a rated duel updates BOTH players in one call (provisional K=40, equal ratings)', async () => {
      const res = await alice.agent
        .post('/api/v1/ratings/duels')
        .set('Idempotency-Key', 'duel-ab-1')
        .send({ opponentId: bob.userId, result: 'WIN', idempotencyKey: 'duel-ab-1' })
        .expect(HttpStatus.CREATED);
      const duel = okBody<any>(res).data;
      expect(duel.me.ratingBefore).toBe(1000);
      expect(duel.me.ratingAfter).toBe(1020);
      expect(duel.me.delta).toBe(20);
      expect(duel.me.gamesPlayed).toBe(1);
      expect(duel.me.provisional).toBe(true);
      expect(duel.opponent.ratingAfter).toBe(980);
      expect(duel.opponent.delta).toBe(-20);
      expect(duel.me.delta + duel.opponent.delta).toBe(0);

      // Both sides see the same event in history.
      const mine = await alice.agent.get('/api/v1/ratings/me/history').expect(HttpStatus.OK);
      const myHistory = okBody<any>(mine).data;
      expect(myHistory.meta.total).toBe(1);
      expect(myHistory.items[0].eventId).toBe('duel-ab-1');
      expect(myHistory.items[0].opponentId).toBe(bob.userId);
      expect(myHistory.items[0].ratingAfter).toBe(1020);
      const his = await bob.agent.get('/api/v1/ratings/me/history').expect(HttpStatus.OK);
      expect(okBody<any>(his).data.meta.total).toBe(1);
    });

    it('duel replay returns IDEMPOTENCY_REPLAY; the opponent replaying hits the duplicate guard', async () => {
      const replay = await alice.agent
        .post('/api/v1/ratings/duels')
        .set('Idempotency-Key', 'duel-ab-1')
        .send({ opponentId: bob.userId, result: 'WIN', idempotencyKey: 'duel-ab-1' })
        .expect(HttpStatus.CONFLICT);
      const replayBody = errBody(replay);
      expect(replayBody.error.code).toBe(ErrorCode.IDEMPOTENCY_REPLAY);
      expect((replayBody.error.details as any).original.me.ratingAfter).toBe(1020);

      // Bob replays the same event from his side: the history guard fires.
      const dup = await bob.agent
        .post('/api/v1/ratings/duels')
        .set('Idempotency-Key', 'duel-ab-1')
        .send({ opponentId: alice.userId, result: 'LOSS', idempotencyKey: 'duel-ab-1' })
        .expect(HttpStatus.CONFLICT);
      expect(errBody(dup).error.code).toBe(ErrorCode.RATING_EVENT_DUPLICATE);

      // Nothing double-applied: Alice is still on 1 game.
      const me = okBody<any>(await alice.agent.get('/api/v1/ratings/me')).data;
      expect(me.learning.gamesPlayed).toBe(1);
      expect(me.learning.rating).toBe(1020);
    });

    it('an immediate rematch against the same pair is a 409 cooldown', async () => {
      const res = await alice.agent
        .post('/api/v1/ratings/duels')
        .set('Idempotency-Key', 'duel-ab-2')
        .send({ opponentId: bob.userId, result: 'WIN', idempotencyKey: 'duel-ab-2' })
        .expect(HttpStatus.CONFLICT);
      expect(errBody(res).error.code).toBe(ErrorCode.RATING_DUEL_COOLDOWN);
    });

    it('duels against other pairs work; history filters by kind', async () => {
      // Alice (1020) beats Carol (1000): expected ~0.5288, K=40 -> +18.8.
      const ac = await alice.agent
        .post('/api/v1/ratings/duels')
        .set('Idempotency-Key', 'duel-ac-1')
        .send({ opponentId: carol.userId, result: 'WIN', idempotencyKey: 'duel-ac-1' })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(ac).data.me.ratingAfter).toBe(1038.8);
      expect(okBody<any>(ac).data.me.gamesPlayed).toBe(2);

      // Bob (980) beats Carol (981.2): expected ~0.4983, K=40 -> +20.1.
      const bc = await bob.agent
        .post('/api/v1/ratings/duels')
        .set('Idempotency-Key', 'duel-bc-1')
        .send({ opponentId: carol.userId, result: 'WIN', idempotencyKey: 'duel-bc-1' })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(bc).data.me.ratingAfter).toBe(1000.1);
      expect(okBody<any>(bc).data.me.gamesPlayed).toBe(2);

      // History kind filter: Alice has 2 LEARNING rows, 0 TRADING rows.
      const trading = await alice.agent
        .get('/api/v1/ratings/me/history')
        .query({ kind: 'TRADING' })
        .expect(HttpStatus.OK);
      expect(okBody<any>(trading).data.meta.total).toBe(0);
      const learning = await alice.agent
        .get('/api/v1/ratings/me/history')
        .query({ kind: 'LEARNING', limit: 1 })
        .expect(HttpStatus.OK);
      const page = okBody<any>(learning).data;
      expect(page.meta.total).toBe(2);
      expect(page.meta.totalPages).toBe(2);
      expect(page.items).toHaveLength(1);
    });

    it('leaderboard is public, ranked with percentiles, and never leaks email', async () => {
      const res = await request(server)
        .get('/api/v1/ratings/leaderboard')
        .query({ kind: 'LEARNING', scope: 'global' })
        .expect(HttpStatus.OK);
      const board = okBody<any>(res).data;
      expect(board.total).toBe(3);
      expect(board.entries.map((e: any) => e.userId)).toEqual([
        alice.userId,
        bob.userId,
        carol.userId,
      ]);
      expect(board.entries[0].rank).toBe(1);
      expect(board.entries[0].rating).toBe(1038.8);
      expect(board.entries[0].percentile).toBe(66.7);
      expect(board.entries[2].percentile).toBe(0);
      expect(board.entries[0].tier).toBe('Bronze');
      for (const e of board.entries) {
        expect(e.email).toBeUndefined();
        expect(e.displayName).toBeDefined();
      }

      // National boards filter by country; Carol (no country) is global-only.
      const india = await request(server)
        .get('/api/v1/ratings/leaderboard')
        .query({ kind: 'LEARNING', scope: 'country', country: 'IN' })
        .expect(HttpStatus.OK);
      expect(okBody<any>(india).data.entries.map((e: any) => e.userId)).toEqual([alice.userId]);
      const usa = await request(server)
        .get('/api/v1/ratings/leaderboard')
        .query({ kind: 'LEARNING', scope: 'country', country: 'US' })
        .expect(HttpStatus.OK);
      expect(okBody<any>(usa).data.entries.map((e: any) => e.userId)).toEqual([bob.userId]);

      // scope=country without a country is a validation error.
      const bad = await request(server)
        .get('/api/v1/ratings/leaderboard')
        .query({ kind: 'LEARNING', scope: 'country' })
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(bad).error.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('GET /ratings/users/:id is public; unknown users are 404', async () => {
      const res = await request(server)
        .get(`/api/v1/ratings/users/${bob.userId}`)
        .expect(HttpStatus.OK);
      const view = okBody<any>(res).data;
      expect(view.userId).toBe(bob.userId);
      expect(view.learning.rating).toBe(1000.1);
      expect(view.candleRating).toBe(1000.1); // trading still 1000: (1000.1+1000)/2
      expect(view.email).toBeUndefined();

      await request(server).get(`/api/v1/ratings/users/${uuidv4()}`).expect(HttpStatus.NOT_FOUND);
    });

    it('trading-week is ADMIN-only; a win vs the 1200 index pays +30.4 at K=40', async () => {
      // Non-admin is forbidden.
      await alice.agent
        .post('/api/v1/ratings/trading-week')
        .send({
          userId: alice.userId,
          portfolioReturnPct: 5,
          indexReturnPct: 1,
          tradeCount: 5,
          weekStart: '2026-11-09',
          idempotencyKey: 'tw-a-1',
        })
        .expect(HttpStatus.FORBIDDEN);

      const res = await admin.agent
        .post('/api/v1/ratings/trading-week')
        .send({
          userId: alice.userId,
          portfolioReturnPct: 5,
          indexReturnPct: 1,
          tradeCount: 5,
          weekStart: '2026-11-09',
          idempotencyKey: 'tw-a-1',
        })
        .expect(HttpStatus.CREATED);
      const week = okBody<any>(res).data;
      expect(week.applied).toBe(true);
      expect(week.score).toBe('WIN');
      expect(week.weekStart).toBe('2026-11-09');
      expect(week.ratingBefore).toBe(1000);
      expect(week.delta).toBe(30.4);
      expect(week.ratingAfter).toBe(1030.4);

      // Candle rating is now the mix of the two parts.
      const me = okBody<any>(await alice.agent.get('/api/v1/ratings/me')).data;
      expect(me.trading.rating).toBe(1030.4);
      expect(me.candleRating).toBe(1034.6); // (1038.8 + 1030.4) / 2
    });

    it('trading-week: fewer than 3 trades is unrated; same week twice is a duplicate', async () => {
      const unrated = await admin.agent
        .post('/api/v1/ratings/trading-week')
        .send({
          userId: bob.userId,
          portfolioReturnPct: 9,
          indexReturnPct: 1,
          tradeCount: 2,
          weekStart: '2026-11-09',
          idempotencyKey: 'tw-b-1',
        })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(unrated).data.applied).toBe(false);
      expect(okBody<any>(unrated).data.reason).toBe('MIN_TRADES_NOT_MET');

      // Same week, fresh key: still a duplicate (one rated update per week).
      const dup = await admin.agent
        .post('/api/v1/ratings/trading-week')
        .send({
          userId: alice.userId,
          portfolioReturnPct: 5,
          indexReturnPct: 1,
          tradeCount: 5,
          weekStart: '2026-11-11', // same week, Wednesday normalises to Monday 09
          idempotencyKey: 'tw-a-2',
        })
        .expect(HttpStatus.CONFLICT);
      expect(errBody(dup).error.code).toBe(ErrorCode.RATING_EVENT_DUPLICATE);

      // Same key replay: IDEMPOTENCY_REPLAY with the original.
      const replay = await admin.agent
        .post('/api/v1/ratings/trading-week')
        .send({
          userId: alice.userId,
          portfolioReturnPct: 5,
          indexReturnPct: 1,
          tradeCount: 5,
          weekStart: '2026-11-09',
          idempotencyKey: 'tw-a-1',
        })
        .expect(HttpStatus.CONFLICT);
      expect(errBody(replay).error.code).toBe(ErrorCode.IDEMPOTENCY_REPLAY);

      // Unknown user.
      const ghost = await admin.agent
        .post('/api/v1/ratings/trading-week')
        .send({
          userId: uuidv4(),
          portfolioReturnPct: 5,
          indexReturnPct: 1,
          tradeCount: 5,
          weekStart: '2026-11-09',
          idempotencyKey: 'tw-ghost',
        })
        .expect(HttpStatus.NOT_FOUND);
      expect(errBody(ghost).error.code).toBe(ErrorCode.NOT_FOUND);
    });

    it('trading leaderboard lists only users with a Trading rating', async () => {
      const res = await request(server)
        .get('/api/v1/ratings/leaderboard')
        .query({ kind: 'TRADING', scope: 'global' })
        .expect(HttpStatus.OK);
      const board = okBody<any>(res).data;
      expect(board.total).toBe(1);
      expect(board.entries[0].userId).toBe(alice.userId);
      expect(board.entries[0].rating).toBe(1030.4);
    });

    it('after the 90-day cooldown a country change moves national leaderboard membership', async () => {
      // Age Alice's last country change past the cooldown (white-box: the
      // suite already mutates the fake store for role promotion).
      const aliceRow = db.users.get(alice.userId);
      aliceRow.countryCodeChangedAt = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
      const res = await alice.agent
        .patch('/api/v1/users/me')
        .send({ countryCode: 'US' })
        .expect(HttpStatus.OK);
      expect(okBody<{ countryCode: string }>(res).data.countryCode).toBe('US');

      const india = await request(server)
        .get('/api/v1/ratings/leaderboard')
        .query({ kind: 'LEARNING', scope: 'country', country: 'IN' })
        .expect(HttpStatus.OK);
      expect(okBody<any>(india).data.total).toBe(0);
      expect(okBody<any>(india).data.entries).toEqual([]);
      const usa = await request(server)
        .get('/api/v1/ratings/leaderboard')
        .query({ kind: 'LEARNING', scope: 'country', country: 'US' })
        .expect(HttpStatus.OK);
      expect(
        okBody<any>(usa)
          .data.entries.map((e: any) => e.userId)
          .sort()
      ).toEqual([alice.userId, bob.userId].sort());
    });

    it('season reset is ADMIN-only, halves the distance to 1000, and never double-applies', async () => {
      await alice.agent
        .post('/api/v1/ratings/admin/season-reset')
        .send({ season: '2027-Q1' })
        .expect(HttpStatus.FORBIDDEN);

      // How many rating rows does the reset actually move? A row whose
      // soft reset rounds back to itself (e.g. 1000.1) is a no-op.
      const offStart = [...db.userRatings.values()].filter(
        (r: any) => softReset(r.rating) !== r.rating
      ).length;
      expect(offStart).toBeGreaterThan(0);

      const res = await admin.agent
        .post('/api/v1/ratings/admin/season-reset')
        .send({ season: '2027-Q1' })
        .expect(HttpStatus.CREATED);
      const reset = okBody<any>(res).data;
      expect(reset.season).toBe('2027-Q1');
      expect(reset.updated).toBe(offStart);

      // Alice: 1038.8 -> 1019.4 (learning), 1030.4 -> 1015.2 (trading).
      const me = okBody<any>(await alice.agent.get('/api/v1/ratings/me')).data;
      expect(me.learning.rating).toBe(1019.4);
      expect(me.learning.season).toBe('2027-Q1');
      expect(me.trading.rating).toBe(1015.2);

      // Re-running the same season changes nothing.
      const again = await admin.agent
        .post('/api/v1/ratings/admin/season-reset')
        .send({ season: '2027-Q1' })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(again).data.updated).toBe(0);
    });

    it('decay is ADMIN-only and drifts only ratings idle 30+ days (never double-applies in a week)', async () => {
      await alice.agent.post('/api/v1/ratings/admin/decay').send({}).expect(HttpStatus.FORBIDDEN);

      // Nothing is idle yet: a decay run applies nothing.
      const idle = await admin.agent
        .post('/api/v1/ratings/admin/decay')
        .send({})
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(idle).data.applied).toEqual([]);

      // Age Bob's Learning rating 40 days (white-box store edit), then decay.
      // Bob's rating after the reset is 1000.1; 40 days idle is 2 weeks past
      // the grace, so 20 points toward 1000 — capped by the 0.1 gap -> 1000.
      const bobRow = db.userRatings.get(`${bob.userId}:LEARNING`);
      const before = bobRow.rating as number;
      bobRow.lastRatedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
      const run = await admin.agent
        .post('/api/v1/ratings/admin/decay')
        .send({})
        .expect(HttpStatus.CREATED);
      const applied = okBody<any>(run).data.applied as Array<any>;
      expect(applied).toHaveLength(1);
      expect(applied[0].userId).toBe(bob.userId);
      expect(applied[0].kind).toBe('LEARNING');
      expect(applied[0].ratingBefore).toBe(before);
      expect(applied[0].ratingAfter).toBe(1000);
      expect(applied[0].delta).toBeCloseTo(1000 - before, 5);

      // Same week again: no double-apply.
      const again = await admin.agent
        .post('/api/v1/ratings/admin/decay')
        .send({})
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(again).data.applied).toEqual([]);
    });
  });

  describe('question-bank', () => {
    let admin1: { agent: Agent; userId: string; accessToken: string };
    let admin2: { agent: Agent; userId: string; accessToken: string };
    let user1: { agent: Agent; userId: string; accessToken: string };
    let user2: { agent: Agent; userId: string; accessToken: string };
    let publishedId = '';

    beforeAll(async () => {
      admin1 = await registerLogin(server, 'qb-admin1@example.com', { roles: ['ADMIN'] });
      admin2 = await registerLogin(server, 'qb-admin2@example.com', { roles: ['ADMIN'] });
      user1 = await registerLogin(server, 'qb-user1@example.com');
      user2 = await registerLogin(server, 'qb-user2@example.com');
    }, 30000);

    const itemDto = (overrides: Record<string, unknown> = {}) => ({
      topic: 'budgeting',
      skill: 'RECALL',
      type: 'MCQ_4',
      difficulty: 2,
      stem: 'What is a budget?',
      explanation: 'A budget is a plan for how to use income.',
      options: [
        { text: 'A plan for how to use income', isCorrect: true },
        { text: 'A loan from a bank', isCorrect: false },
        { text: 'A tax you must pay', isCorrect: false },
        { text: 'A type of savings account', isCorrect: false },
      ],
      ...overrides,
    });
    // Quiz formats only: CASE_CHOICE items have 3 actions, not 4, so
    // an unfiltered selection could serve one and break the 4-option
    // pin below. CASE selection is covered by its own test.
    const selectDto = {
      count: 7,
      difficultyMix: { 1: 2, 2: 3, 3: 2 },
      types: ['MCQ_4', 'TRUE_FALSE'],
    };

    async function toReview(agent: Agent, overrides: Record<string, unknown> = {}) {
      const created = await agent
        .post('/api/v1/question-bank/items')
        .send(itemDto(overrides))
        .expect(HttpStatus.CREATED);
      const id = okBody<any>(created).data.id as string;
      await agent.post(`/api/v1/question-bank/items/${id}/submit-review`).send({}).expect(201);
      return id;
    }

    it('admin create → submit → review (second admin) → publish runs the full workflow', async () => {
      const created = await admin1.agent
        .post('/api/v1/question-bank/items')
        .send(itemDto())
        .expect(HttpStatus.CREATED);
      const item = okBody<any>(created).data;
      expect(item.status).toBe('DRAFT');
      expect(item.authorId).toBe(admin1.userId);

      const submitted = await admin1.agent
        .post(`/api/v1/question-bank/items/${item.id}/submit-review`)
        .send({})
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(submitted).data.status).toBe('REVIEW');

      const reviewed = await admin2.agent
        .post(`/api/v1/question-bank/items/${item.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(reviewed).data.status).toBe('PILOT');
      expect(okBody<any>(reviewed).data.reviewerId).toBe(admin2.userId);

      const published = await admin2.agent
        .post(`/api/v1/question-bank/items/${item.id}/publish`)
        .send({})
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(published).data.status).toBe('LIVE');
      expect(okBody<any>(published).data.publishedAt).toBeTruthy();
      publishedId = item.id;
    });

    it('the author cannot approve their own item (403, two-person rule)', async () => {
      const id = await toReview(admin1.agent);
      const res = await admin1.agent
        .post(`/api/v1/question-bank/items/${id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(HttpStatus.FORBIDDEN);
      expect(errBody(res).error.code).toBe(ErrorCode.QUESTION_BANK_REVIEWER_MUST_DIFFER);
    });

    it('reject sends REVIEW → DRAFT', async () => {
      const id = await toReview(admin1.agent);
      const res = await admin2.agent
        .post(`/api/v1/question-bank/items/${id}/review`)
        .send({ decision: 'REJECT' })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(res).data.status).toBe('DRAFT');
    });

    it('publish from DRAFT is a 409 invalid transition (never direct DRAFT → LIVE)', async () => {
      const created = await admin1.agent
        .post('/api/v1/question-bank/items')
        .send(itemDto())
        .expect(HttpStatus.CREATED);
      const id = okBody<any>(created).data.id as string;
      const res = await admin1.agent
        .post(`/api/v1/question-bank/items/${id}/publish`)
        .send({})
        .expect(HttpStatus.CONFLICT);
      expect(errBody(res).error.code).toBe(ErrorCode.QUESTION_BANK_INVALID_TRANSITION);
    });

    it('non-admins cannot author items (403) and MCQ_4 with the wrong shape is a 400', async () => {
      const forbidden = await user1.agent
        .post('/api/v1/question-bank/items')
        .send(itemDto())
        .expect(HttpStatus.FORBIDDEN);
      expect(errBody(forbidden).error.code).toBe(ErrorCode.FORBIDDEN);

      const bad = await admin1.agent
        .post('/api/v1/question-bank/items')
        .send(
          itemDto({
            options: [
              { text: 'a', isCorrect: true },
              { text: 'b', isCorrect: true },
              { text: 'c', isCorrect: false },
            ],
          })
        )
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(bad).error.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('admin list filters by status/topic and includes correct answers', async () => {
      const res = await admin1.agent
        .get('/api/v1/question-bank/items?status=LIVE&topic=budgeting&limit=100')
        .expect(HttpStatus.OK);
      const data = okBody<any>(res).data;
      expect(data.items.length).toBeGreaterThanOrEqual(24);
      expect(data.items.every((i: any) => i.status === 'LIVE' && i.topic === 'budgeting')).toBe(
        true
      );
      expect(data.items[0].options.some((o: any) => o.isCorrect === true)).toBe(true);
      expect(typeof data.items[0].explanation).toBe('string');
    });

    it('coverage shows LIVE counts per topic × difficulty', async () => {
      const res = await admin1.agent.get('/api/v1/question-bank/coverage').expect(HttpStatus.OK);
      const data = okBody<any>(res).data;
      expect(data.total).toBeGreaterThanOrEqual(96);
      expect(data.cells).toHaveLength(50);
      const budgetingD1 = data.cells.find(
        (c: any) => c.topic === 'budgeting' && c.difficulty === 1
      );
      expect(budgetingD1.count).toBe(8);
    });

    it('selection hides answers, respects the difficulty mix, and never repeats', async () => {
      const res = await user1.agent
        .post('/api/v1/question-bank/select')
        .send(selectDto)
        .expect(HttpStatus.CREATED);
      const items = okBody<any>(res).data.items as Array<any>;
      expect(items).toHaveLength(7);
      expect(JSON.stringify(res.body)).not.toContain('isCorrect');
      expect(JSON.stringify(res.body)).not.toContain('explanation');
      expect(new Set(items.map((i) => i.id)).size).toBe(7);
      const byDifficulty: Record<number, number> = {};
      const byTopic: Record<string, number> = {};
      for (const q of items) {
        byDifficulty[q.difficulty] = (byDifficulty[q.difficulty] ?? 0) + 1;
        byTopic[q.topic] = (byTopic[q.topic] ?? 0) + 1;
        expect(q.options).toHaveLength(4);
      }
      expect(byDifficulty).toEqual({ 1: 2, 2: 3, 3: 2 });
      expect(Object.values(byTopic).every((n) => n <= 2)).toBe(true);
    });

    it('a second selection never repeats the first set (exposure exclusion)', async () => {
      const first = await user2.agent
        .post('/api/v1/question-bank/select')
        .send(selectDto)
        .expect(HttpStatus.CREATED);
      const firstIds = new Set((okBody<any>(first).data.items as Array<any>).map((i) => i.id));
      const second = await user2.agent
        .post('/api/v1/question-bank/select')
        .send(selectDto)
        .expect(HttpStatus.CREATED);
      const secondIds = (okBody<any>(second).data.items as Array<any>).map((i) => i.id);
      expect(secondIds).toHaveLength(7);
      expect(secondIds.every((id) => !firstIds.has(id))).toBe(true);
    });

    it('selection throws 409 when the bank cannot fill the set', async () => {
      const res = await user1.agent
        .post('/api/v1/question-bank/select')
        .send({ count: 20, difficultyMix: { 1: 20 } })
        .expect(HttpStatus.CONFLICT);
      expect(errBody(res).error.code).toBe(ErrorCode.QUESTION_BANK_INSUFFICIENT_COVERAGE);
    });

    it('template generation creates DRAFT items, and re-running the seed skips them', async () => {
      const gen = await admin1.agent
        .post('/api/v1/question-bank/templates/7f3e1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b/generate')
        .send({ count: 2, seed: 3 })
        .expect(HttpStatus.CREATED);
      const data = okBody<any>(gen).data;
      expect(data.created).toHaveLength(2);
      expect(data.skipped).toBe(0);
      expect(data.templateKey).toBe('tpl-compounding');
      expect(data.created.every((i: any) => i.status === 'DRAFT')).toBe(true);
      expect(
        data.created.every((i: any) => i.templateId === '7f3e1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b')
      ).toBe(true);

      const again = await admin1.agent
        .post('/api/v1/question-bank/templates/7f3e1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b/generate')
        .send({ count: 2, seed: 3 })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(again).data.created).toHaveLength(0);
      expect(okBody<any>(again).data.skipped).toBe(2);
    });

    it('new-version creates a DRAFT v2 and leaves the LIVE row untouched', async () => {
      const v2 = await admin2.agent
        .post(`/api/v1/question-bank/items/${publishedId}/new-version`)
        .send({ stem: 'What is a budget, exactly?' })
        .expect(HttpStatus.CREATED);
      const v2data = okBody<any>(v2).data;
      expect(v2data.version).toBe(2);
      expect(v2data.status).toBe('DRAFT');
      expect(v2data.key.endsWith('-v2')).toBe(true);
      expect(v2data.stem).toBe('What is a budget, exactly?');

      const old = await admin1.agent
        .get(`/api/v1/question-bank/items/${publishedId}`)
        .expect(HttpStatus.OK);
      expect(okBody<any>(old).data.status).toBe('LIVE');
      expect(okBody<any>(old).data.stem).toBe('What is a budget?');
    });

    it('select requires auth', async () => {
      await request(server)
        .post('/api/v1/question-bank/select')
        .send(selectDto)
        .expect(HttpStatus.UNAUTHORIZED);
    });

    // --- CASE_CHOICE (Phase 7 Stage 1, docs/08 §3.3) -------------------------------
    // These tests run last in this describe on purpose: publishing a
    // LIVE CASE item here must not leak into the selection tests above
    // (which assert 4-option sets), and the Bot/Daily blueprints only
    // select MCQ_4 + TRUE_FALSE, so later duel tests never see it.

    const caseDto = (overrides: Record<string, unknown> = {}) => ({
      topic: 'budgeting',
      skill: 'JUDGEMENT',
      type: 'CASE_CHOICE',
      difficulty: 3,
      stem: 'Asha earns ₹45,000 a month and spends ₹25,000.\nShe has ₹20,000 saved.\nShe wants a ₹1,50,000 emergency fund in 6 months.',
      explanation:
        'Saving a fixed amount each month in a separate account reaches the goal on time.',
      context: {
        'Monthly income': '₹45,000',
        'Saved so far': '₹20,000',
        Goal: '₹1,50,000 in 6 months',
      },
      rubric:
        'Best — saving ₹22,000 a month reaches the goal on time.\nSecond-best — saving less falls short.\nWeak — waiting leaves no fund at all.',
      options: [
        {
          text: 'Save ₹22,000 a month in a separate account',
          isCorrect: true,
          points: 100,
          consequence: 'Fund is ready in 6 months.',
        },
        {
          text: 'Save ₹15,000 a month and use a card for surprises',
          isCorrect: false,
          points: 50,
          consequence: 'Fund falls short.',
        },
        {
          text: 'Wait for a bonus, then save everything at once',
          isCorrect: false,
          points: 0,
          consequence: 'No fund for 6 months.',
        },
      ],
      ...overrides,
    });

    it('CASE_CHOICE create → review → publish stores context, rubric, points, consequences', async () => {
      const created = await admin1.agent
        .post('/api/v1/question-bank/items')
        .send(caseDto())
        .expect(HttpStatus.CREATED);
      const item = okBody<any>(created).data;
      expect(item.status).toBe('DRAFT');
      expect(item.context).toEqual({
        'Monthly income': '₹45,000',
        'Saved so far': '₹20,000',
        Goal: '₹1,50,000 in 6 months',
      });
      expect(item.rubric).toContain('Best —');
      expect(item.options.map((o: any) => o.points)).toEqual([100, 50, 0]);
      expect(item.options.map((o: any) => o.consequence)).toEqual([
        'Fund is ready in 6 months.',
        'Fund falls short.',
        'No fund for 6 months.',
      ]);

      await admin1.agent
        .post(`/api/v1/question-bank/items/${item.id}/submit-review`)
        .send({})
        .expect(HttpStatus.CREATED);
      const reviewed = await admin2.agent
        .post(`/api/v1/question-bank/items/${item.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(reviewed).data.status).toBe('PILOT');
      const published = await admin2.agent
        .post(`/api/v1/question-bank/items/${item.id}/publish`)
        .send({})
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(published).data.status).toBe('LIVE');
    });

    it('CASE_CHOICE validation rejects a missing rubric, bad points, and a real-security tip', async () => {
      const noRubric = await admin1.agent
        .post('/api/v1/question-bank/items')
        .send(caseDto({ rubric: undefined }))
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(noRubric).error.code).toBe(ErrorCode.VALIDATION_FAILED);

      const twoHundreds = caseDto();
      (twoHundreds.options as Array<Record<string, unknown>>)[1]!.points = 100;
      const badPoints = await admin1.agent
        .post('/api/v1/question-bank/items')
        .send(twoHundreds)
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(badPoints).error.code).toBe(ErrorCode.VALIDATION_FAILED);

      const realTip = caseDto();
      (realTip.options as Array<Record<string, unknown>>)[0]!.text = 'Buy shares of Reliance today';
      const tip = await admin1.agent
        .post('/api/v1/question-bank/items')
        .send(realTip)
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(tip).error.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('CASE_CHOICE selection returns context + consequences and hides points/rubric/answers', async () => {
      const res = await user1.agent
        .post('/api/v1/question-bank/select')
        .send({ count: 1, difficultyMix: { 3: 1 }, types: ['CASE_CHOICE'] })
        .expect(HttpStatus.CREATED);
      const items = okBody<any>(res).data.items as Array<any>;
      expect(items).toHaveLength(1);
      const q = items[0];
      expect(q.id).toBeTruthy();
      expect(q.type).toBe('CASE_CHOICE');
      expect(q.context).toEqual({
        'Monthly income': '₹45,000',
        'Saved so far': '₹20,000',
        Goal: '₹1,50,000 in 6 months',
      });
      expect(q.options).toHaveLength(3);
      expect(q.options.every((o: any) => typeof o.consequence === 'string')).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('isCorrect');
      expect(JSON.stringify(res.body)).not.toContain('explanation');
      expect(JSON.stringify(res.body)).not.toContain('rubric');
      expect(JSON.stringify(res.body)).not.toContain('"points"');
    });

    // --- CHART_CHOICE (Phase 8 Stage 1, docs/08 §3.4) -------------------------------
    // These tests run last in this describe on purpose: publishing a
    // LIVE CHART item here must not leak into the selection tests above,
    // and the Bot/Daily blueprints only select MCQ_4 + TRUE_FALSE, so
    // later duel tests never see it.

    const chartDto = (overrides: Record<string, unknown> = {}) => ({
      topic: 'stocks',
      skill: 'CHART_READING',
      type: 'CHART_CHOICE',
      difficulty: 3,
      stem: 'Look at the price chart of Meadow Foods, a fictional snack company, from January to June. What does the chart show?',
      explanation:
        'The line climbs in almost every month and ends clearly higher than January. A rising line means the price rose.',
      chart: {
        title: 'Meadow Foods — price over 6 months',
        instrument: 'Meadow Foods',
        template: 'STEADY_RISE',
        xLabel: 'Month',
        yLabel: 'Price (₹)',
        xLabels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        series: [100, 104, 109, 113, 118, 124],
        annotation: { trend: 'rising', zoneStart: 0, zoneEnd: 5 },
      },
      options: [
        {
          text: 'The price rose steadily over the six months.',
          isCorrect: true,
        },
        {
          text: 'The price fell steadily over the six months.',
          isCorrect: false,
        },
        {
          text: 'The price stayed flat all six months.',
          isCorrect: false,
        },
        {
          text: 'The price rose, then fell below where it started.',
          isCorrect: false,
        },
      ],
      ...overrides,
    });

    it('CHART_CHOICE create → review → publish stores the chart (series + annotation)', async () => {
      const created = await admin1.agent
        .post('/api/v1/question-bank/items')
        .send(chartDto())
        .expect(HttpStatus.CREATED);
      const item = okBody<any>(created).data;
      expect(item.status).toBe('DRAFT');
      expect(item.chart.instrument).toBe('Meadow Foods');
      expect(item.chart.template).toBe('STEADY_RISE');
      expect(item.chart.series).toEqual([100, 104, 109, 113, 118, 124]);
      expect(item.chart.xLabels).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']);
      expect(item.chart.annotation).toEqual({ trend: 'rising', zoneStart: 0, zoneEnd: 5 });
      expect(item.options).toHaveLength(4);

      await admin1.agent
        .post(`/api/v1/question-bank/items/${item.id}/submit-review`)
        .send({})
        .expect(HttpStatus.CREATED);
      const reviewed = await admin2.agent
        .post(`/api/v1/question-bank/items/${item.id}/review`)
        .send({ decision: 'APPROVE' })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(reviewed).data.status).toBe('PILOT');
      const published = await admin2.agent
        .post(`/api/v1/question-bank/items/${item.id}/publish`)
        .send({})
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(published).data.status).toBe('LIVE');
    });

    it('CHART_CHOICE validation rejects a missing chart, a short series, a ticker, and a real-security tip', async () => {
      const noChart = await admin1.agent
        .post('/api/v1/question-bank/items')
        .send(chartDto({ chart: undefined }))
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(noChart).error.code).toBe(ErrorCode.VALIDATION_FAILED);

      const shortSeries = chartDto();
      (shortSeries.chart as Record<string, unknown>).series = [100, 104, 109, 113, 118];
      const short = await admin1.agent
        .post('/api/v1/question-bank/items')
        .send(shortSeries)
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(short).error.code).toBe(ErrorCode.VALIDATION_FAILED);

      const ticker = chartDto();
      (ticker.chart as Record<string, unknown>).instrument = 'TCS';
      const tick = await admin1.agent
        .post('/api/v1/question-bank/items')
        .send(ticker)
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(tick).error.code).toBe(ErrorCode.VALIDATION_FAILED);

      const realTip = chartDto();
      (realTip.options as Array<Record<string, unknown>>)[0]!.text = 'Buy shares of Reliance today';
      const tip = await admin1.agent
        .post('/api/v1/question-bank/items')
        .send(realTip)
        .expect(HttpStatus.BAD_REQUEST);
      expect(errBody(tip).error.code).toBe(ErrorCode.VALIDATION_FAILED);
    });

    it('CHART_CHOICE selection returns the chart WITHOUT the annotation and hides answers', async () => {
      const res = await user1.agent
        .post('/api/v1/question-bank/select')
        .send({ count: 1, difficultyMix: { 3: 1 }, types: ['CHART_CHOICE'] })
        .expect(HttpStatus.CREATED);
      const items = okBody<any>(res).data.items as Array<any>;
      expect(items).toHaveLength(1);
      const q = items[0];
      expect(q.id).toBeTruthy();
      expect(q.type).toBe('CHART_CHOICE');
      expect(q.chart.instrument).toBe('Meadow Foods');
      expect(q.chart.template).toBe('STEADY_RISE');
      expect(q.chart.series).toEqual([100, 104, 109, 113, 118, 124]);
      expect(q.chart.xLabels).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']);
      expect(q.chart).not.toHaveProperty('annotation');
      expect(q.options).toHaveLength(4);
      expect(JSON.stringify(res.body)).not.toContain('isCorrect');
      expect(JSON.stringify(res.body)).not.toContain('explanation');
      expect(JSON.stringify(res.body)).not.toContain('annotation');
      expect(JSON.stringify(res.body)).not.toContain('"points"');
    });
  });

  // --- duels (Phase 4 Step 2 — Bot Duel + Async Daily Duel, docs/07) ------------

  describe('duels', () => {
    const istToday = (): string =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());

    const optionIdFor = (questionId: string, correct: boolean): string => {
      for (const o of db.duelBankOptions.values()) {
        if (o.itemId === questionId && o.isCorrect === correct) return o.id;
      }
      throw new Error(`no ${correct ? 'correct' : 'wrong'} option for ${questionId}`);
    };

    const playAll = async (
      agent: Agent,
      duelId: string,
      kind: 'bot' | 'daily',
      questions: Array<{ id: string }>,
      correctCount: number,
      timeMs: number
    ): Promise<void> => {
      for (let i = 0; i < questions.length; i++) {
        const q = questions[i] as { id: string };
        const res = await agent
          .post(`/api/v1/duels/${kind}/${duelId}/answer`)
          .send({
            questionId: q.id,
            optionId: optionIdFor(q.id, i < correctCount),
            timeMs,
          })
          .expect(HttpStatus.CREATED);
        expect(okBody<any>(res).data.answeredCount).toBe(i + 1);
      }
    };

    it('bot happy path: start hides answers, finish scores + stores result, replay is identical', async () => {
      const u = await registerLogin(server, 'duel-bot@example.com');
      const start = await u.agent
        .post('/api/v1/duels/bot/start')
        .send({})
        .expect(HttpStatus.CREATED);
      const started = okBody<any>(start).data;
      expect(started.questions).toHaveLength(7);
      expect(JSON.stringify(started)).not.toContain('isCorrect');
      expect(JSON.stringify(started)).not.toContain('Because QB');
      expect(started.opponent.name).toBe('Mira');
      await playAll(u.agent, started.duelId, 'bot', started.questions, 5, 5000);
      const finish = await u.agent
        .post(`/api/v1/duels/bot/${started.duelId}/finish`)
        .send({})
        .expect(HttpStatus.CREATED);
      const result = okBody<any>(finish).data;
      // 5 correct at 5000 ms: 100 + floor(50*(1-5000/15000)) = 133 each
      expect(result.score).toBe(5 * 133);
      expect(result.correct).toBe(5);
      expect(result.wrong).toBe(2);
      expect(result.ratingBefore).toBeNull();
      expect(result.ratingDelta).toBeNull();
      expect(result.ratingReason).toBe('no Rating change — practice');
      expect(result.perQuestion).toHaveLength(7);
      expect(result.perQuestion[0].explanation).toMatch(/^Because QB/);
      expect([0, 5, 20]).toContain(result.xp.awarded);
      const replay = await u.agent
        .post(`/api/v1/duels/bot/${started.duelId}/finish`)
        .send({})
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(replay).data).toEqual(result);
      // XP applied exactly once (ledger key duel:{duelId}:{userId}).
      expect(
        db.xpLedger.filter((x) => x.userId === u.userId && x.reason === 'duel.bot_completed')
      ).toHaveLength(1);
      const history = await u.agent.get('/api/v1/duels/history').expect(HttpStatus.OK);
      expect(okBody<any>(history).data.items).toHaveLength(1);
      expect(okBody<any>(history).data.items[0].opponentName).toBe('Mira');
    });

    it('bot answers enforce order, ownership, and the 15 s limit', async () => {
      const u = await registerLogin(server, 'duel-bot-rules@example.com');
      const other = await registerLogin(server, 'duel-bot-other@example.com');
      const start = await u.agent
        .post('/api/v1/duels/bot/start')
        .send({})
        .expect(HttpStatus.CREATED);
      const started = okBody<any>(start).data;
      const [q1, q2] = started.questions as Array<{ id: string }>;
      await other.agent
        .post(`/api/v1/duels/bot/${started.duelId}/answer`)
        .send({
          questionId: (q1 as { id: string }).id,
          optionId: optionIdFor((q1 as { id: string }).id, true),
          timeMs: 1000,
        })
        .expect(HttpStatus.FORBIDDEN);
      await u.agent
        .post(`/api/v1/duels/bot/${started.duelId}/answer`)
        .send({
          questionId: (q2 as { id: string }).id,
          optionId: optionIdFor((q2 as { id: string }).id, true),
          timeMs: 1000,
        })
        .expect(HttpStatus.BAD_REQUEST);
      await u.agent
        .post(`/api/v1/duels/bot/${started.duelId}/answer`)
        .send({
          questionId: (q1 as { id: string }).id,
          optionId: optionIdFor((q1 as { id: string }).id, true),
          timeMs: 15001,
        })
        .expect(HttpStatus.BAD_REQUEST);
      const ok = await u.agent
        .post(`/api/v1/duels/bot/${started.duelId}/answer`)
        .send({
          questionId: (q1 as { id: string }).id,
          optionId: optionIdFor((q1 as { id: string }).id, true),
          timeMs: 1000,
        })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(ok).data.answeredCount).toBe(1);
    });

    it('bot cap: 10 starts per IST day, the 11th is 409', async () => {
      const u = await registerLogin(server, 'duel-bot-cap@example.com');
      for (let i = 0; i < 10; i++) {
        await u.agent.post('/api/v1/duels/bot/start').send({}).expect(HttpStatus.CREATED);
      }
      const res = await u.agent
        .post('/api/v1/duels/bot/start')
        .send({})
        .expect(HttpStatus.CONFLICT);
      expect(errBody(res).error.code).toBe(ErrorCode.DUEL_BOT_DAILY_LIMIT);
    });

    it('daily happy path: same set both players, second finish settles + rates once, 1/day 409', async () => {
      const u1 = await registerLogin(server, 'duel-daily-1@example.com');
      const u2 = await registerLogin(server, 'duel-daily-2@example.com');
      const today = await u1.agent.get('/api/v1/duels/daily/today').expect(HttpStatus.OK);
      expect(okBody<any>(today).data.date).toBe(istToday());
      expect(okBody<any>(today).data.myDuel).toBeNull();
      const s1 = await u1.agent
        .post('/api/v1/duels/daily/start')
        .send({})
        .expect(HttpStatus.CREATED);
      const d1 = okBody<any>(s1).data;
      const s2 = await u2.agent
        .post('/api/v1/duels/daily/start')
        .send({})
        .expect(HttpStatus.CREATED);
      const d2 = okBody<any>(s2).data;
      expect(d1.questions).toHaveLength(5);
      expect(d1.questions.map((q: { id: string }) => q.id)).toEqual(
        d2.questions.map((q: { id: string }) => q.id)
      );
      await playAll(u1.agent, d1.duelId, 'daily', d1.questions, 5, 4000);
      const w1 = await u1.agent
        .post(`/api/v1/duels/daily/${d1.duelId}/finish`)
        .send({})
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(w1).data.status).toBe('WAITING_OPPONENT');
      await playAll(u2.agent, d2.duelId, 'daily', d2.questions, 5, 8000);
      const f2 = await u2.agent
        .post(`/api/v1/duels/daily/${d2.duelId}/finish`)
        .send({})
        .expect(HttpStatus.CREATED);
      const r2 = okBody<any>(f2).data;
      // Both 5/5; u1 total 20000 ms beats u2 total 40000 ms → u2 loses, -20 (both 1000, K=40).
      expect(r2.status).toBe('SETTLED');
      expect(r2.result).toBe('LOSS');
      expect(r2.ratingDelta).toBe(-20);
      expect(r2.ratingBefore).toBe(1000);
      expect(r2.ratingAfter).toBe(980);
      const r1 = await u1.agent.get(`/api/v1/duels/${d1.duelId}/result`).expect(HttpStatus.OK);
      expect(okBody<any>(r1).data.result).toBe('WIN');
      expect(okBody<any>(r1).data.ratingDelta).toBe(20);
      // Rating applied exactly once per player (one history row each).
      expect(db.ratingHistory.filter((h) => h.userId === u1.userId)).toHaveLength(1);
      expect(db.ratingHistory.filter((h) => h.userId === u2.userId)).toHaveLength(1);
      const me = await u1.agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
      expect(okBody<any>(me).data.learning.gamesPlayed).toBe(1);
      expect(okBody<any>(me).data.learning.rating).toBe(1020);
      const again = await u1.agent
        .post('/api/v1/duels/daily/start')
        .send({})
        .expect(HttpStatus.CONFLICT);
      expect(errBody(again).error.code).toBe(ErrorCode.DUEL_DAILY_ALREADY_PLAYED);
      // 30 s: two Argon2 registrations + two full duels on a loaded VM.
    }, 30000);

    it('daily bot fallback: lone player settles vs Mira via the admin endpoint', async () => {
      const u = await registerLogin(server, 'duel-daily-lone@example.com');
      const admin = await registerLogin(server, 'duel-admin@example.com', { roles: ['ADMIN'] });
      const s = await u.agent.post('/api/v1/duels/daily/start').send({}).expect(HttpStatus.CREATED);
      const d = okBody<any>(s).data;
      await playAll(u.agent, d.duelId, 'daily', d.questions, 3, 4000);
      await u.agent
        .post(`/api/v1/duels/daily/${d.duelId}/finish`)
        .send({})
        .expect(HttpStatus.CREATED);
      const settle = await admin.agent
        .post('/api/v1/duels/daily/settle-unpaired')
        .send({ date: istToday() })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(settle).data.settled).toBe(1);
      expect(okBody<any>(settle).data.failed).toHaveLength(0);
      const res = await u.agent.get(`/api/v1/duels/${d.duelId}/result`).expect(HttpStatus.OK);
      const r = okBody<any>(res).data;
      expect(r.status).toBe('SETTLED');
      expect(r.opponent.name).toBe('Mira');
      expect(typeof r.ratingDelta).toBe('number');
      expect(r.ratingReason).toMatch(/Mira \(bot\)/);
      const me = await u.agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
      expect(okBody<any>(me).data.learning.gamesPlayed).toBe(1);
      const again = await admin.agent
        .post('/api/v1/duels/daily/settle-unpaired')
        .send({ date: istToday() })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(again).data.settled).toBe(0);
      // 30 s: two Argon2 registrations + a full duel on a loaded VM.
    }, 30000);

    it('daily settle-unpaired requires ADMIN', async () => {
      const u = await registerLogin(server, 'duel-daily-nonadmin@example.com');
      const res = await u.agent
        .post('/api/v1/duels/daily/settle-unpaired')
        .send({ date: istToday() })
        .expect(HttpStatus.FORBIDDEN);
      expect(errBody(res).error.code).toBe(ErrorCode.FORBIDDEN);
    });
  });

  // --- live duels (Phase 5 Step 3 — Speed Quiz Duel L1, docs/09) ------------

  describe('live duels', () => {
    /** Buffered socket client: events are queued, so nothing is missed between emits. */
    class LiveClient {
      socket: ClientSocket;
      label = '?';
      private readonly seen = new Map<string, any[]>();
      private readonly waiters = new Map<string, Array<(p: any) => void>>();

      constructor(socket: ClientSocket) {
        this.socket = socket;
        for (const event of [
          'live:queued',
          'live:queue-left',
          'live:bot-offer',
          'live:matched',
          'live:countdown',
          'live:question',
          'live:score',
          'live:answer-accepted',
          'live:reveal',
          'live:reason-window',
          'live:opponent-disconnected',
          'live:opponent-reconnected',
          'live:rematch-requested',
          'live:finished',
          'live:error',
        ]) {
          socket.on(event, (payload: any) => this.push(event, payload));
        }
      }

      private push(event: string, payload: any): void {
        const waiters = this.waiters.get(event) ?? [];
        const w = waiters.shift();
        if (w) {
          w(payload);
          return;
        }
        const list = this.seen.get(event) ?? [];
        list.push(payload);
        this.seen.set(event, list);
      }

      waitFor(event: string, timeoutMs = 10000): Promise<any> {
        const buffered = this.seen.get(event);
        if (buffered && buffered.length > 0) return Promise.resolve(buffered.shift());
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`timed out waiting for ${event}`)),
            timeoutMs
          );
          const list = this.waiters.get(event) ?? [];
          list.push((payload: any) => {
            clearTimeout(timer);
            resolve(payload);
          });
          this.waiters.set(event, list);
        });
      }

      emit(event: string, payload: unknown): Promise<any> {
        return new Promise((resolve) => {
          this.socket.emit(event, payload, (ack: any) => resolve(ack));
        });
      }

      disconnect(): void {
        this.socket.disconnect();
      }
    }

    const livePort = async (): Promise<number> => {
      const httpServer = serverOf(app);
      if (!httpServer.listening) {
        await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
      }
      return (httpServer.address() as AddressInfo).port;
    };

    const connectLive = async (token?: string, label = '?'): Promise<LiveClient> => {
      const port = await livePort();
      const socket = io(`http://127.0.0.1:${port}/duels-live`, {
        auth: token ? { token } : {},
        transports: ['websocket'],
        forceNew: true,
      });
      const client = new LiveClient(socket);
      client.label = label;
      return client;
    };

    const correctOptionId = (questionId: string): string => {
      for (const o of db.duelBankOptions.values()) {
        if (o.itemId === questionId && o.isCorrect) return o.id;
      }
      throw new Error(`no correct option for ${questionId}`);
    };
    const wrongOptionId = (questionId: string): string => {
      for (const o of db.duelBankOptions.values()) {
        if (o.itemId === questionId && !o.isCorrect) return o.id;
      }
      throw new Error(`no wrong option for ${questionId}`);
    };

    /** The second-best action (50 points) of a CASE_CHOICE question. */
    const secondBestOptionId = (questionId: string): string => {
      for (const o of db.duelBankOptions.values()) {
        if (o.itemId === questionId && o.points === 50) return o.id;
      }
      throw new Error(`no second-best option for ${questionId}`);
    };

    /** A 0-point action of a CASE_CHOICE question. */
    const zeroOptionId = (questionId: string): string => {
      for (const o of db.duelBankOptions.values()) {
        if (o.itemId === questionId && o.points === 0) return o.id;
      }
      throw new Error(`no 0-point option for ${questionId}`);
    };

    /** Play a full 5-case Case Duel: A follows `aPicks`, B follows `bPicks`. */
    const playCaseDuel = async (
      a: LiveClient,
      b: LiveClient,
      aPicks: Array<'best' | 'second' | 'zero'>,
      bPicks: Array<'best' | 'second' | 'zero'>
    ): Promise<any> => {
      let finished: any = null;
      for (let i = 0; i < 5; i++) {
        const [qa, qb] = await Promise.all([
          a.waitFor('live:question'),
          b.waitFor('live:question'),
        ]);
        expect(qa.question.id).toBe(qb.question.id);
        // CASE_CHOICE rendering payload: 4 actions with consequences,
        // the case numbers table, 45 s timer (3 s in TEST_ENV).
        expect(qa.question.type).toBe('CASE_CHOICE');
        expect(qa.question.options).toHaveLength(3);
        expect(qa.question.context).toBeDefined();
        expect(qa.question.context['Monthly income']).toBe('₹45,000');
        expect(qa.timeLimitMs).toBe(3_000);
        expect(qa.deadlineMs - qa.serverNowMs).toBe(3_000);
        expect(JSON.stringify(qa)).not.toContain('isCorrect');
        expect(JSON.stringify(qa)).not.toContain('Because QB');
        const pick = (who: 'best' | 'second' | 'zero', qid: string): string =>
          who === 'best'
            ? correctOptionId(qid)
            : who === 'second'
              ? secondBestOptionId(qid)
              : zeroOptionId(qid);
        const aPick = aPicks[i];
        const bPick = bPicks[i];
        if (!aPick || !bPick) throw new Error(`missing pick for case ${i}`);
        const ackA = await a.emit('live:answer', {
          duelId: qa.duelId,
          questionId: qa.question.id,
          optionId: pick(aPick, qa.question.id),
        });
        expect(ackA.ok).toBe(true);
        const ackB = await b.emit('live:answer', {
          duelId: qb.duelId,
          questionId: qb.question.id,
          optionId: pick(bPick, qb.question.id),
        });
        expect(ackB.ok).toBe(true);
        // Both answered — but NO reveal yet: the reason window is open.
        const window = await a.waitFor('live:reason-window');
        expect(window.index).toBe(i);
        // A gives a reason, B skips hers (null) — then the case reveals.
        const ackReasonA = await a.emit('live:reason', {
          duelId: qa.duelId,
          questionId: qa.question.id,
          reason: 'Safest for my goal',
        });
        expect(ackReasonA.ok).toBe(true);
        const ackReasonB = await b.emit('live:reason', {
          duelId: qb.duelId,
          questionId: qb.question.id,
          reason: null,
        });
        expect(ackReasonB.ok).toBe(true);
        const [ra, rb] = await Promise.all([a.waitFor('live:reveal'), b.waitFor('live:reveal')]);
        expect(ra.correctOptionId).toBe(correctOptionId(qa.question.id));
        // The explanation is either the seeded CASE explanation or the
        // Stage 1 item's — the random pick decides which item is served.
        expect(ra.explanation).toMatch(/^(Because QB CASE|Saving a fixed amount)/);
        // The reveal carries the rubric + the points breakdown in plain words.
        expect(ra.rubric).toContain('Best — saving ₹22,000 a month reaches the goal on time.');
        expect(ra.pointsBreakdown).toContain('Best action +100, your action +');
        expect(ra.myReason).toBe('Safest for my goal');
        expect(rb.myReason).toBeNull();
      }
      finished = await a.waitFor('live:finished');
      const finishedB = await b.waitFor('live:finished');
      expect(finishedB.duelId).toBe(finished.duelId);
      return finished;
    };

    it('case happy path: queue → match → 5 cases → settle + rate once', async () => {
      const u1 = await registerLogin(server, 'duel-case-1@example.com');
      const u2 = await registerLogin(server, 'duel-case-2@example.com');
      const a = await connectLive(u1.accessToken, 'A');
      const b = await connectLive(u2.accessToken, 'B');
      try {
        const [ackA, ackB] = await Promise.all([
          a.emit('live:join-queue', { variant: 'CASE' }),
          b.emit('live:join-queue', { variant: 'CASE' }),
        ]);
        expect(ackA.ok).toBe(true);
        expect(ackA.variant).toBe('CASE');
        expect(ackB.ok).toBe(true);
        const [ma, mb] = await Promise.all([a.waitFor('live:matched'), b.waitFor('live:matched')]);
        expect(ma.duelId).toBe(mb.duelId);
        expect(ma.variant).toBe('CASE');
        expect(ma.questionCount).toBe(5);
        expect(ma.timeLimitMs).toBe(3_000); // TEST_ENV CASE_QUESTION_MS
        expect(ma.opponent.kind).toBe('HUMAN');
        expect(ma.host.name).toBe('Kabir');
        expect(ma.host.line).toContain('5 cases, 45 seconds each');
        // A picks the best action every case; B picks the second-best.
        const finished = await playCaseDuel(a, b, Array(5).fill('best'), Array(5).fill('second'));
        expect(finished.result).toBe('WIN');
        expect(finished.correct).toBe(5);
        expect(finished.ratingDelta).toBe(20); // provisional K=40, equal ratings
        expect(finished.ratingReason).toContain('You beat');
        expect(finished.host.name).toBe('Kabir');
        // A: 5 × (100 + ~19 speed) ≈ 595. B: 5 × (50 + ~19 speed) ≈ 345.
        expect(finished.score).toBeGreaterThan(500);
        const result = await u1.agent
          .get(`/api/v1/duels/${finished.duelId}/result`)
          .expect(HttpStatus.OK);
        expect(okBody<any>(result).data.result).toBe('WIN');
        expect(okBody<any>(result).data.type).toBe('CASE');
        expect(okBody<any>(result).data.ratingDelta).toBe(20);
        // The stored per-question stat carries the rubric (result screen).
        const perQuestion = okBody<any>(result).data.perQuestion as Array<any>;
        expect(perQuestion).toHaveLength(5);
        expect(perQuestion[0].rubric).toContain('Best — saving ₹22,000 a month');
        expect(perQuestion[0].points).toBeGreaterThan(100);
        // B's result: second-best pays 50 + speed every case (250 < score < 350).
        const resultB = await u2.agent
          .get(`/api/v1/duels/${finished.duelId}/result`)
          .expect(HttpStatus.OK);
        expect(okBody<any>(resultB).data.result).toBe('LOSS');
        expect(okBody<any>(resultB).data.score).toBeGreaterThan(250);
        expect(okBody<any>(resultB).data.score).toBeLessThan(350);
        // Reasons are stored on the DuelAnswer rows: A's chip, B's null.
        const aAnswers = db.duelAnswers.filter(
          (x: any) => x.duelId === finished.duelId && x.userId === u1.userId
        );
        expect(aAnswers).toHaveLength(5);
        expect(aAnswers.every((x: any) => x.reason === 'Safest for my goal')).toBe(true);
        const bAnswers = db.duelAnswers.filter(
          (x: any) => x.duelId === finished.duelId && x.userId === u2.userId
        );
        expect(bAnswers).toHaveLength(5);
        expect(bAnswers.every((x: any) => x.reason === null)).toBe(true);
        const history = await u1.agent.get('/api/v1/duels/history').expect(HttpStatus.OK);
        const mine = okBody<any>(history).data.items.find((x: any) => x.duelId === finished.duelId);
        expect(mine.type).toBe('CASE');
        expect(mine.ratingDelta).toBe(20);
        const ratings = await u1.agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
        expect(okBody<any>(ratings).data.learning.gamesPlayed).toBe(1);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 30000);

    it('case queue separation: a CASE waiter never matches a LIVE waiter', async () => {
      const uLive = await registerLogin(server, 'duel-case-sep-live@example.com');
      const uC1 = await registerLogin(server, 'duel-case-sep-c1@example.com');
      const uC2 = await registerLogin(server, 'duel-case-sep-c2@example.com');
      const live = await connectLive(uLive.accessToken, 'LIVE');
      const c1 = await connectLive(uC1.accessToken, 'C1');
      const c2 = await connectLive(uC2.accessToken, 'C2');
      try {
        const ackLive = await live.emit('live:join-queue', {});
        expect(ackLive.ok).toBe(true);
        expect(ackLive.variant).toBe('LIVE');
        const ackC1 = await c1.emit('live:join-queue', { variant: 'CASE' });
        expect(ackC1.ok).toBe(true);
        expect(ackC1.variant).toBe('CASE');
        await c1.waitFor('live:queued');
        const statusC1 = await uC1.agent
          .get('/api/v1/duels/live/queue/status')
          .expect(HttpStatus.OK);
        expect(okBody<any>(statusC1).data.queued).toBe(true);
        expect(okBody<any>(statusC1).data.variant).toBe('CASE');

        // A second CASE waiter matches the first CASE waiter — never the LIVE one.
        await c2.emit('live:join-queue', { variant: 'CASE' });
        const [m1, m2] = await Promise.all([
          c1.waitFor('live:matched'),
          c2.waitFor('live:matched'),
        ]);
        expect(m1.duelId).toBe(m2.duelId);
        expect(m1.variant).toBe('CASE');
        expect(m1.questionCount).toBe(5);
        expect(m1.host.name).toBe('Kabir');
        // The LIVE waiter is still queued, unmatched, in the LIVE queue.
        const still = await uLive.agent
          .get('/api/v1/duels/live/queue/status')
          .expect(HttpStatus.OK);
        expect(okBody<any>(still).data.queued).toBe(true);
        expect(okBody<any>(still).data.variant).toBe('LIVE');
        const active = await uLive.agent.get('/api/v1/duels/live/active').expect(HttpStatus.OK);
        expect(okBody<any>(active).data).toBeNull();
      } finally {
        live.disconnect();
        c1.disconnect();
        c2.disconnect();
      }
    }, 30000);

    it('case bot duel via the 30 s offer: queue alone, accept Mira, play 5 cases', async () => {
      const u1 = await registerLogin(server, 'duel-case-bot-1@example.com');
      const a = await connectLive(u1.accessToken, 'A');
      try {
        const ack = await a.emit('live:join-queue', { variant: 'CASE' });
        expect(ack.ok).toBe(true);
        expect(ack.variant).toBe('CASE');
        // No opponent arrives: after 30 s the server offers the Mira bot.
        await a.waitFor('live:bot-offer', 40_000);
        const accepted = await a.emit('live:accept-bot', {});
        expect(accepted.ok).toBe(true);
        expect(accepted.opponent).toBe('BOT');
        expect(accepted.variant).toBe('CASE');
        const matched = await a.waitFor('live:matched');
        expect(matched.variant).toBe('CASE');
        expect(matched.opponent.kind).toBe('BOT');
        expect(matched.opponent.displayName).toBe('Mira');
        expect(matched.host.name).toBe('Kabir');
        expect(matched.questionCount).toBe(5);
        // Play all 5 cases vs Mira: best action + a reason each time.
        for (let i = 0; i < 5; i++) {
          const q = await a.waitFor('live:question');
          expect(q.question.type).toBe('CASE_CHOICE');
          const ackAnswer = await a.emit('live:answer', {
            duelId: q.duelId,
            questionId: q.question.id,
            optionId: correctOptionId(q.question.id),
          });
          expect(ackAnswer.ok).toBe(true);
          // The reason window opens once Mira's simulated time lands.
          const window = await a.waitFor('live:reason-window');
          expect(window.index).toBe(i);
          const ackReason = await a.emit('live:reason', {
            duelId: q.duelId,
            questionId: q.question.id,
            reason: 'Best long-term value',
          });
          expect(ackReason.ok).toBe(true);
          const reveal = await a.waitFor('live:reveal');
          expect(reveal.rubric).toContain('Best — saving ₹22,000 a month');
          expect(reveal.myCorrect).toBe(true);
        }
        const finished = await a.waitFor('live:finished');
        expect(['WIN', 'DRAW', 'LOSS']).toContain(finished.result);
        expect(finished.type).toBe('CASE');
        expect(finished.host.name).toBe('Kabir');
        // Rated exactly once, vs the bot at the player's own Rating.
        const ratings = await u1.agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
        expect(okBody<any>(ratings).data.learning.gamesPlayed).toBe(1);
      } finally {
        a.disconnect();
      }
    }, 120000);

    /** Play a full 5-chart Chart Detective duel: A correct, B wrong, every chart. */
    const playChartDuel = async (a: LiveClient, b: LiveClient): Promise<any> => {
      let finished: any = null;
      for (let i = 0; i < 5; i++) {
        const [qa, qb] = await Promise.all([
          a.waitFor('live:question'),
          b.waitFor('live:question'),
        ]);
        expect(qa.question.id).toBe(qb.question.id);
        // CHART_CHOICE rendering payload: 4 interpretations, the chart
        // (series + labels, NO annotation), 30 s timer (3 s in TEST_ENV).
        expect(qa.question.type).toBe('CHART_CHOICE');
        expect(qa.question.options).toHaveLength(4);
        expect(qa.question.chart).toBeDefined();
        expect(qa.question.chart.instrument).toBe('Meadow Foods');
        expect(qa.question.chart.template).toBe('STEADY_RISE');
        expect(qa.question.chart.series).toEqual([100, 104, 109, 113, 118, 124]);
        expect(qa.question.chart.xLabels).toEqual(['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun']);
        expect(qa.question.chart).not.toHaveProperty('annotation');
        expect(qa.timeLimitMs).toBe(3_000);
        expect(qa.deadlineMs - qa.serverNowMs).toBe(3_000);
        expect(JSON.stringify(qa)).not.toContain('isCorrect');
        expect(JSON.stringify(qa)).not.toContain('annotation');
        expect(JSON.stringify(qa)).not.toContain('Because QB');
        const ackA = await a.emit('live:answer', {
          duelId: qa.duelId,
          questionId: qa.question.id,
          optionId: correctOptionId(qa.question.id),
        });
        expect(ackA.ok).toBe(true);
        const ackB = await b.emit('live:answer', {
          duelId: qb.duelId,
          questionId: qb.question.id,
          optionId: wrongOptionId(qb.question.id),
        });
        expect(ackB.ok).toBe(true);
        // Both answered — the chart reveals at once (no reason window for CHART).
        const [ra, rb] = await Promise.all([a.waitFor('live:reveal'), b.waitFor('live:reveal')]);
        expect(ra.correctOptionId).toBe(correctOptionId(qa.question.id));
        // The explanation is the seeded CHART explanation (every seed
        // item mirrors the Stage 1 item's shape, so this pins either way).
        expect(ra.explanation).toContain('rising line');
        // The reveal carries the chart annotation (trend + zone).
        expect(ra.annotation).toEqual({ trend: 'rising', zoneStart: 0, zoneEnd: 5 });
        expect(rb.annotation).toEqual({ trend: 'rising', zoneStart: 0, zoneEnd: 5 });
        expect(ra.myCorrect).toBe(true);
        expect(rb.myCorrect).toBe(false);
        expect(ra.myPoints).toBeGreaterThan(100);
        expect(rb.myPoints).toBe(0);
      }
      finished = await a.waitFor('live:finished');
      const finishedB = await b.waitFor('live:finished');
      expect(finishedB.duelId).toBe(finished.duelId);
      return finished;
    };

    it('chart happy path: queue → match → 5 charts → settle + rate once', async () => {
      const u1 = await registerLogin(server, 'duel-chart-1@example.com');
      const u2 = await registerLogin(server, 'duel-chart-2@example.com');
      const a = await connectLive(u1.accessToken, 'A');
      const b = await connectLive(u2.accessToken, 'B');
      try {
        const [ackA, ackB] = await Promise.all([
          a.emit('live:join-queue', { variant: 'CHART' }),
          b.emit('live:join-queue', { variant: 'CHART' }),
        ]);
        expect(ackA.ok).toBe(true);
        expect(ackA.variant).toBe('CHART');
        expect(ackB.ok).toBe(true);
        const [ma, mb] = await Promise.all([a.waitFor('live:matched'), b.waitFor('live:matched')]);
        expect(ma.duelId).toBe(mb.duelId);
        expect(ma.variant).toBe('CHART');
        expect(ma.questionCount).toBe(5);
        expect(ma.timeLimitMs).toBe(3_000); // TEST_ENV CHART_QUESTION_MS
        expect(ma.opponent.kind).toBe('HUMAN');
        expect(ma.host.name).toBe('Kabir');
        expect(ma.host.line).toContain('5 charts, 30 seconds each');
        // A reads every chart right; B reads every chart wrong.
        const finished = await playChartDuel(a, b);
        expect(finished.result).toBe('WIN');
        expect(finished.correct).toBe(5);
        expect(finished.ratingDelta).toBe(20); // provisional K=40, equal ratings
        expect(finished.ratingReason).toContain('You beat');
        expect(finished.host.name).toBe('Kabir');
        // A: 5 × (100 + ~49 speed) ≈ 745. B: 0.
        expect(finished.score).toBeGreaterThan(700);
        const result = await u1.agent
          .get(`/api/v1/duels/${finished.duelId}/result`)
          .expect(HttpStatus.OK);
        expect(okBody<any>(result).data.result).toBe('WIN');
        expect(okBody<any>(result).data.type).toBe('CHART');
        expect(okBody<any>(result).data.ratingDelta).toBe(20);
        // The stored per-question stat carries the chart + annotation (result screen).
        const perQuestion = okBody<any>(result).data.perQuestion as Array<any>;
        expect(perQuestion).toHaveLength(5);
        expect(perQuestion[0].chart.series).toEqual([100, 104, 109, 113, 118, 124]);
        expect(perQuestion[0].chart).not.toHaveProperty('annotation');
        expect(perQuestion[0].annotation).toEqual({ trend: 'rising', zoneStart: 0, zoneEnd: 5 });
        expect(perQuestion[0].points).toBeGreaterThan(100);
        // B's result: wrong every chart (0 points).
        const resultB = await u2.agent
          .get(`/api/v1/duels/${finished.duelId}/result`)
          .expect(HttpStatus.OK);
        expect(okBody<any>(resultB).data.result).toBe('LOSS');
        expect(okBody<any>(resultB).data.score).toBe(0);
        expect(okBody<any>(resultB).data.correct).toBe(0);
        const history = await u1.agent.get('/api/v1/duels/history').expect(HttpStatus.OK);
        const mine = okBody<any>(history).data.items.find((x: any) => x.duelId === finished.duelId);
        expect(mine.type).toBe('CHART');
        expect(mine.ratingDelta).toBe(20);
        const ratings = await u1.agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
        expect(okBody<any>(ratings).data.learning.gamesPlayed).toBe(1);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 30000);

    it('chart queue separation: a CHART waiter never matches a LIVE waiter', async () => {
      const uLive = await registerLogin(server, 'duel-chart-sep-live@example.com');
      const uC1 = await registerLogin(server, 'duel-chart-sep-c1@example.com');
      const uC2 = await registerLogin(server, 'duel-chart-sep-c2@example.com');
      const live = await connectLive(uLive.accessToken, 'LIVE');
      const c1 = await connectLive(uC1.accessToken, 'C1');
      const c2 = await connectLive(uC2.accessToken, 'C2');
      try {
        const ackLive = await live.emit('live:join-queue', {});
        expect(ackLive.ok).toBe(true);
        expect(ackLive.variant).toBe('LIVE');
        const ackC1 = await c1.emit('live:join-queue', { variant: 'CHART' });
        expect(ackC1.ok).toBe(true);
        expect(ackC1.variant).toBe('CHART');
        await c1.waitFor('live:queued');
        const statusC1 = await uC1.agent
          .get('/api/v1/duels/live/queue/status')
          .expect(HttpStatus.OK);
        expect(okBody<any>(statusC1).data.queued).toBe(true);
        expect(okBody<any>(statusC1).data.variant).toBe('CHART');

        // A second CHART waiter matches the first CHART waiter — never the LIVE one.
        await c2.emit('live:join-queue', { variant: 'CHART' });
        const [m1, m2] = await Promise.all([
          c1.waitFor('live:matched'),
          c2.waitFor('live:matched'),
        ]);
        expect(m1.duelId).toBe(m2.duelId);
        expect(m1.variant).toBe('CHART');
        expect(m1.questionCount).toBe(5);
        expect(m1.host.name).toBe('Kabir');
        // The LIVE waiter is still queued, unmatched, in the LIVE queue.
        const still = await uLive.agent
          .get('/api/v1/duels/live/queue/status')
          .expect(HttpStatus.OK);
        expect(okBody<any>(still).data.queued).toBe(true);
        expect(okBody<any>(still).data.variant).toBe('LIVE');
        const active = await uLive.agent.get('/api/v1/duels/live/active').expect(HttpStatus.OK);
        expect(okBody<any>(active).data).toBeNull();
      } finally {
        live.disconnect();
        c1.disconnect();
        c2.disconnect();
      }
    }, 30000);

    it('chart bot duel via the 30 s offer: queue alone, accept Mira, play 5 charts', async () => {
      const u1 = await registerLogin(server, 'duel-chart-bot-1@example.com');
      const a = await connectLive(u1.accessToken, 'A');
      try {
        const ack = await a.emit('live:join-queue', { variant: 'CHART' });
        expect(ack.ok).toBe(true);
        expect(ack.variant).toBe('CHART');
        // No opponent arrives: after 30 s the server offers the Mira bot.
        await a.waitFor('live:bot-offer', 40_000);
        const accepted = await a.emit('live:accept-bot', {});
        expect(accepted.ok).toBe(true);
        expect(accepted.opponent).toBe('BOT');
        expect(accepted.variant).toBe('CHART');
        const matched = await a.waitFor('live:matched');
        expect(matched.variant).toBe('CHART');
        expect(matched.opponent.kind).toBe('BOT');
        expect(matched.opponent.displayName).toBe('Mira');
        expect(matched.host.name).toBe('Kabir');
        expect(matched.questionCount).toBe(5);
        // Play all 5 charts vs Mira: the correct reading each time.
        for (let i = 0; i < 5; i++) {
          const q = await a.waitFor('live:question');
          expect(q.question.type).toBe('CHART_CHOICE');
          expect(q.question.chart).toBeDefined();
          expect(q.question.chart).not.toHaveProperty('annotation');
          const ackAnswer = await a.emit('live:answer', {
            duelId: q.duelId,
            questionId: q.question.id,
            optionId: correctOptionId(q.question.id),
          });
          expect(ackAnswer.ok).toBe(true);
          // The reveal lands once Mira's simulated time lands.
          const reveal = await a.waitFor('live:reveal');
          expect(reveal.annotation).toEqual({ trend: 'rising', zoneStart: 0, zoneEnd: 5 });
          expect(reveal.myCorrect).toBe(true);
        }
        const finished = await a.waitFor('live:finished');
        expect(['WIN', 'DRAW', 'LOSS']).toContain(finished.result);
        expect(finished.type).toBe('CHART');
        expect(finished.host.name).toBe('Kabir');
        // Rated exactly once, vs the bot at the player's own Rating.
        const ratings = await u1.agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
        expect(okBody<any>(ratings).data.learning.gamesPlayed).toBe(1);
      } finally {
        a.disconnect();
      }
    }, 120000);

    /** Play a full 7-question live duel: A correct, B wrong, every question. */
    const playLiveDuel = async (a: LiveClient, b: LiveClient): Promise<any> => {
      let finished: any = null;
      for (let i = 0; i < 7; i++) {
        const [qa, qb] = await Promise.all([
          a.waitFor('live:question'),
          b.waitFor('live:question'),
        ]);
        expect(qa.question.id).toBe(qb.question.id);
        expect(JSON.stringify(qa)).not.toContain('isCorrect');
        expect(JSON.stringify(qa)).not.toContain('Because QB');
        const ackA = await a.emit('live:answer', {
          duelId: qa.duelId,
          questionId: qa.question.id,
          optionId: correctOptionId(qa.question.id),
        });
        expect(ackA.ok).toBe(true);
        const ackB = await b.emit('live:answer', {
          duelId: qb.duelId,
          questionId: qb.question.id,
          optionId: wrongOptionId(qb.question.id),
        });
        expect(ackB.ok).toBe(true);
        const [ra, rb] = await Promise.all([a.waitFor('live:reveal'), b.waitFor('live:reveal')]);
        expect(ra.correctOptionId).toBe(correctOptionId(qa.question.id));
        expect(ra.explanation).toMatch(/^Because QB/);
        expect(ra.myCorrect).toBe(true);
        expect(rb.myCorrect).toBe(false);
        expect(ra.scores.playerA.score).toBeGreaterThan(ra.scores.playerB.score);
      }
      finished = await a.waitFor('live:finished');
      const finishedB = await b.waitFor('live:finished');
      expect(finishedB.duelId).toBe(finished.duelId);
      return finished;
    };

    it('live happy path: queue → match → 7 questions → settle + rate once', async () => {
      const u1 = await registerLogin(server, 'duel-live-1@example.com');
      const u2 = await registerLogin(server, 'duel-live-2@example.com');
      const a = await connectLive(u1.accessToken, 'A');
      const b = await connectLive(u2.accessToken, 'B');
      try {
        const [ackA, ackB] = await Promise.all([
          a.emit('live:join-queue', {}),
          b.emit('live:join-queue', {}),
        ]);
        expect(ackA.ok).toBe(true);
        expect(ackB.ok).toBe(true);
        const [ma, mb] = await Promise.all([a.waitFor('live:matched'), b.waitFor('live:matched')]);
        expect(ma.duelId).toBe(mb.duelId);
        expect(ma.opponent.kind).toBe('HUMAN');
        expect(ma.host.name).toBe('Mira');
        const finished = await playLiveDuel(a, b);
        expect(finished.result).toBe('WIN');
        expect(finished.correct).toBe(7);
        expect(finished.ratingDelta).toBe(20); // provisional K=40, equal ratings
        expect(finished.ratingReason).toContain('You beat');
        expect(finished.host.name).toBe('Mira');
        // Stored result + history, Rating applied exactly once each.
        const result = await u1.agent
          .get(`/api/v1/duels/${finished.duelId}/result`)
          .expect(HttpStatus.OK);
        expect(okBody<any>(result).data.result).toBe('WIN');
        expect(okBody<any>(result).data.ratingDelta).toBe(20);
        const history = await u1.agent.get('/api/v1/duels/history').expect(HttpStatus.OK);
        const mine = okBody<any>(history).data.items.find((x: any) => x.duelId === finished.duelId);
        expect(mine.type).toBe('LIVE');
        expect(mine.ratingDelta).toBe(20);
        const ratings = await u1.agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
        expect(okBody<any>(ratings).data.learning.gamesPlayed).toBe(1);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 30000);

    /** Play a full 10-question Blitz duel: A follows `ashaCorrect`, B wrong every time. */
    const playBlitzDuel = async (
      a: LiveClient,
      b: LiveClient,
      ashaCorrect: boolean[]
    ): Promise<any> => {
      let finished: any = null;
      for (let i = 0; i < 10; i++) {
        const [qa, qb] = await Promise.all([
          a.waitFor('live:question'),
          b.waitFor('live:question'),
        ]);
        expect(qa.question.id).toBe(qb.question.id);
        // TRUE_FALSE rendering payload: exactly 2 options, True/False, 10 s timer.
        expect(qa.question.type).toBe('TRUE_FALSE');
        expect(qa.question.options).toHaveLength(2);
        expect(qa.question.options.map((o: any) => o.text).sort()).toEqual(['False', 'True']);
        expect(qa.timeLimitMs).toBe(10_000);
        expect(qa.deadlineMs - qa.serverNowMs).toBe(10_000);
        expect(JSON.stringify(qa)).not.toContain('isCorrect');
        expect(JSON.stringify(qa)).not.toContain('Because QB');
        const ackA = await a.emit('live:answer', {
          duelId: qa.duelId,
          questionId: qa.question.id,
          optionId: ashaCorrect[i]
            ? correctOptionId(qa.question.id)
            : wrongOptionId(qa.question.id),
        });
        expect(ackA.ok).toBe(true);
        const ackB = await b.emit('live:answer', {
          duelId: qb.duelId,
          questionId: qb.question.id,
          optionId: wrongOptionId(qb.question.id),
        });
        expect(ackB.ok).toBe(true);
        const [ra, rb] = await Promise.all([a.waitFor('live:reveal'), b.waitFor('live:reveal')]);
        expect(ra.correctOptionId).toBe(correctOptionId(qa.question.id));
        expect(ra.explanation).toMatch(/^Because QB TF/);
        expect(ra.myCorrect).toBe(ashaCorrect[i]);
        expect(rb.myCorrect).toBe(false);
      }
      finished = await a.waitFor('live:finished');
      const finishedB = await b.waitFor('live:finished');
      expect(finishedB.duelId).toBe(finished.duelId);
      return finished;
    };

    it('blitz happy path: queue → match → 10 TRUE_FALSE questions → settle + rate once', async () => {
      const u1 = await registerLogin(server, 'duel-blitz-1@example.com');
      const u2 = await registerLogin(server, 'duel-blitz-2@example.com');
      const a = await connectLive(u1.accessToken, 'A');
      const b = await connectLive(u2.accessToken, 'B');
      try {
        const [ackA, ackB] = await Promise.all([
          a.emit('live:join-queue', { variant: 'BLITZ' }),
          b.emit('live:join-queue', { variant: 'BLITZ' }),
        ]);
        expect(ackA.ok).toBe(true);
        expect(ackA.variant).toBe('BLITZ');
        expect(ackB.ok).toBe(true);
        const [ma, mb] = await Promise.all([a.waitFor('live:matched'), b.waitFor('live:matched')]);
        expect(ma.duelId).toBe(mb.duelId);
        expect(ma.variant).toBe('BLITZ');
        expect(ma.questionCount).toBe(10);
        expect(ma.timeLimitMs).toBe(10_000);
        expect(ma.opponent.kind).toBe('HUMAN');
        expect(ma.host.name).toBe('Mira');
        expect(ma.host.line).toContain('10 rapid true-or-false');
        const finished = await playBlitzDuel(a, b, Array(10).fill(true));
        expect(finished.result).toBe('WIN');
        expect(finished.correct).toBe(10);
        expect(finished.bestStreak).toBe(10);
        // 10 correct × at most 150 without a streak bonus = 1500; the
        // streak bonus (+10/+20/+30×6 = 210) must push the score past it.
        expect(finished.score).toBeGreaterThan(1500);
        expect(finished.ratingDelta).toBe(20); // provisional K=40, equal ratings
        expect(finished.ratingReason).toContain('You beat');
        expect(finished.host.name).toBe('Mira');
        const result = await u1.agent
          .get(`/api/v1/duels/${finished.duelId}/result`)
          .expect(HttpStatus.OK);
        expect(okBody<any>(result).data.result).toBe('WIN');
        expect(okBody<any>(result).data.type).toBe('BLITZ');
        expect(okBody<any>(result).data.ratingDelta).toBe(20);
        const history = await u1.agent.get('/api/v1/duels/history').expect(HttpStatus.OK);
        const mine = okBody<any>(history).data.items.find((x: any) => x.duelId === finished.duelId);
        expect(mine.type).toBe('BLITZ');
        expect(mine.ratingDelta).toBe(20);
        const ratings = await u1.agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
        expect(okBody<any>(ratings).data.learning.gamesPlayed).toBe(1);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 30000);

    it('blitz queue separation: a LIVE waiter and a BLITZ waiter never match', async () => {
      const uLive = await registerLogin(server, 'duel-blitz-sep-live@example.com');
      const uB1 = await registerLogin(server, 'duel-blitz-sep-b1@example.com');
      const uB2 = await registerLogin(server, 'duel-blitz-sep-b2@example.com');
      const live = await connectLive(uLive.accessToken, 'LIVE');
      const b1 = await connectLive(uB1.accessToken, 'B1');
      const b2 = await connectLive(uB2.accessToken, 'B2');
      try {
        const ackLive = await live.emit('live:join-queue', {});
        expect(ackLive.ok).toBe(true);
        expect(ackLive.variant).toBe('LIVE');
        const ackB1 = await b1.emit('live:join-queue', { variant: 'BLITZ' });
        expect(ackB1.ok).toBe(true);
        expect(ackB1.variant).toBe('BLITZ');
        await b1.waitFor('live:queued');
        // The LIVE waiter and the BLITZ waiter sit at the same Rating at
        // the same moment — but in different queues, so no match forms.
        const statusLive = await uLive.agent
          .get('/api/v1/duels/live/queue/status')
          .expect(HttpStatus.OK);
        expect(okBody<any>(statusLive).data.queued).toBe(true);
        expect(okBody<any>(statusLive).data.variant).toBe('LIVE');
        const statusB1 = await uB1.agent
          .get('/api/v1/duels/live/queue/status')
          .expect(HttpStatus.OK);
        expect(okBody<any>(statusB1).data.queued).toBe(true);
        expect(okBody<any>(statusB1).data.variant).toBe('BLITZ');

        // A second BLITZ waiter matches the first BLITZ waiter — never the LIVE one.
        await b2.emit('live:join-queue', { variant: 'BLITZ' });
        const [m1, m2] = await Promise.all([
          b1.waitFor('live:matched'),
          b2.waitFor('live:matched'),
        ]);
        expect(m1.duelId).toBe(m2.duelId);
        expect(m1.variant).toBe('BLITZ');
        expect(m1.questionCount).toBe(10);
        // The LIVE waiter is still queued, unmatched, in the LIVE queue.
        const still = await uLive.agent
          .get('/api/v1/duels/live/queue/status')
          .expect(HttpStatus.OK);
        expect(okBody<any>(still).data.queued).toBe(true);
        expect(okBody<any>(still).data.variant).toBe('LIVE');
        const active = await uLive.agent.get('/api/v1/duels/live/active').expect(HttpStatus.OK);
        expect(okBody<any>(active).data).toBeNull();
      } finally {
        live.disconnect();
        b1.disconnect();
        b2.disconnect();
      }
    }, 30000);

    it('blitz streak bonus: wrong answer resets the streak, bestStreak is stored', async () => {
      const u1 = await registerLogin(server, 'duel-blitz-streak-1@example.com');
      const u2 = await registerLogin(server, 'duel-blitz-streak-2@example.com');
      const a = await connectLive(u1.accessToken, 'A');
      const b = await connectLive(u2.accessToken, 'B');
      try {
        await Promise.all([
          a.emit('live:join-queue', { variant: 'BLITZ' }),
          b.emit('live:join-queue', { variant: 'BLITZ' }),
        ]);
        await Promise.all([a.waitFor('live:matched'), b.waitFor('live:matched')]);
        // C, C, C, W, C, C, C, C, C, C — best streak 6 (questions 5–10).
        const finished = await playBlitzDuel(a, b, [
          true,
          true,
          true,
          false,
          true,
          true,
          true,
          true,
          true,
          true,
        ]);
        expect(finished.result).toBe('WIN');
        expect(finished.correct).toBe(9);
        expect(finished.bestStreak).toBe(6);
        // 9 correct × at most 150 without a streak bonus = 1350; the
        // bonus (10 + 10 + 20 + 30 + 30 = 100) must push past it.
        expect(finished.score).toBeGreaterThan(1350);
        // The wrong 4th question scores 0 and breaks the streak.
        const result = await u1.agent
          .get(`/api/v1/duels/${finished.duelId}/result`)
          .expect(HttpStatus.OK);
        const perQuestion = okBody<any>(result).data.perQuestion as Array<any>;
        expect(perQuestion[3].points).toBe(0);
        expect(perQuestion[3].correct).toBe(false);
        // The 3rd question (streak 3) pays the +10 bonus on top of its
        // speed bonus, so it out-scores the 1st question (streak 1).
        expect(perQuestion[2].points).toBeGreaterThan(perQuestion[0].points);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 30000);

    it('live queue status REST: queued, then left', async () => {
      const u = await registerLogin(server, 'duel-live-queue@example.com');
      const client = await connectLive(u.accessToken);
      try {
        const ack = await client.emit('live:join-queue', {});
        expect(ack.ok).toBe(true);
        await client.waitFor('live:queued');
        const status = await u.agent.get('/api/v1/duels/live/queue/status').expect(HttpStatus.OK);
        expect(okBody<any>(status).data.queued).toBe(true);
        expect(okBody<any>(status).data.ratingWindow).toBe(50);
        const left = await client.emit('live:leave-queue', {});
        expect(left.ok).toBe(true);
        const after = await u.agent.get('/api/v1/duels/live/queue/status').expect(HttpStatus.OK);
        expect(okBody<any>(after).data.queued).toBe(false);
      } finally {
        client.disconnect();
      }
    }, 30000);

    it('live forfeit: a player who disconnects past the grace loses', async () => {
      const u1 = await registerLogin(server, 'duel-live-forfeit-1@example.com');
      const u2 = await registerLogin(server, 'duel-live-forfeit-2@example.com');
      const a = await connectLive(u1.accessToken, 'A');
      const b = await connectLive(u2.accessToken, 'B');
      try {
        await Promise.all([a.emit('live:join-queue', {}), b.emit('live:join-queue', {})]);
        const [ma, mb] = await Promise.all([a.waitFor('live:matched'), b.waitFor('live:matched')]);
        expect(ma.duelId).toBe(mb.duelId);
        await a.waitFor('live:question');
        await b.waitFor('live:question');
        a.disconnect();
        const gone = await b.waitFor('live:opponent-disconnected');
        expect(gone.graceSeconds).toBe(1); // TEST_ENV LIVE_DISCONNECT_GRACE_MS=1000
        const finished = await b.waitFor('live:finished', 15000);
        expect(finished.result).toBe('WIN');
        expect(finished.forfeitedBy).toBe(u1.userId);
        expect(finished.ratingDelta).toBe(20);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 30000);

    it('live socket without a token is disconnected', async () => {
      const client = await connectLive();
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('socket stayed connected')), 5000);
          client.socket.on('disconnect', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      } finally {
        client.disconnect();
      }
    }, 30000);
  });

  describe('friend challenge', () => {
    /** Buffered socket client for both namespaces (live + sprint): events are queued, so nothing is missed between emits. */
    class ChallengeClient {
      socket: ClientSocket;
      private readonly seen = new Map<string, any[]>();
      private readonly waiters = new Map<string, Array<(p: any) => void>>();

      constructor(socket: ClientSocket, events: string[]) {
        this.socket = socket;
        for (const event of events) {
          socket.on(event, (payload: any) => this.push(event, payload));
        }
      }

      private push(event: string, payload: any): void {
        const waiters = this.waiters.get(event) ?? [];
        const w = waiters.shift();
        if (w) {
          w(payload);
          return;
        }
        const list = this.seen.get(event) ?? [];
        list.push(payload);
        this.seen.set(event, list);
      }

      waitFor(event: string, timeoutMs = 10000): Promise<any> {
        const buffered = this.seen.get(event);
        if (buffered && buffered.length > 0) return Promise.resolve(buffered.shift());
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`timed out waiting for ${event}`)),
            timeoutMs
          );
          const list = this.waiters.get(event) ?? [];
          list.push((payload: any) => {
            clearTimeout(timer);
            resolve(payload);
          });
          this.waiters.set(event, list);
        });
      }

      emit(event: string, payload: unknown): Promise<any> {
        return new Promise((resolve) => {
          this.socket.emit(event, payload, (ack: any) => resolve(ack));
        });
      }

      disconnect(): void {
        this.socket.disconnect();
      }
    }

    const challengePort = async (): Promise<number> => {
      const httpServer = serverOf(app);
      if (!httpServer.listening) {
        await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
      }
      return (httpServer.address() as AddressInfo).port;
    };

    const connectLiveChallenge = async (token: string): Promise<ChallengeClient> => {
      const port = await challengePort();
      const socket = io(`http://127.0.0.1:${port}/duels-live`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
      });
      return new ChallengeClient(socket, [
        'live:countdown',
        'live:question',
        'live:score',
        'live:answer-accepted',
        'live:reveal',
        'live:finished',
      ]);
    };

    const connectSprintChallenge = async (token: string): Promise<ChallengeClient> => {
      const port = await challengePort();
      const socket = io(`http://127.0.0.1:${port}/sprint`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
      });
      return new ChallengeClient(socket, [
        'sprint:countdown',
        'sprint:started',
        'sprint:tick',
        'sprint:order-accepted',
        'sprint:finished',
      ]);
    };

    const correctOptionId = (questionId: string): string => {
      for (const o of db.duelBankOptions.values()) {
        if (o.itemId === questionId && o.isCorrect) return o.id;
      }
      throw new Error(`no correct option for ${questionId}`);
    };
    const wrongOptionId = (questionId: string): string => {
      for (const o of db.duelBankOptions.values()) {
        if (o.itemId === questionId && !o.isCorrect) return o.id;
      }
      throw new Error(`no wrong option for ${questionId}`);
    };

    const learningRating = async (
      agent: Agent
    ): Promise<{ rating: number; gamesPlayed: number }> => {
      const res = await agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
      const d = okBody<any>(res).data.learning;
      return { rating: d.rating, gamesPlayed: d.gamesPlayed };
    };

    // NB: NOT async — it must return the supertest request so callers can
    // chain .expect() on it (an async fn would return a Promise, and
    // .expect would be called on the Promise, not the request).
    const createChallenge = (agent: Agent, opponentId: string, duelType: string) => {
      return agent.post('/api/v1/challenges').send({ opponentId, duelType });
    };

    it('full lifecycle: create → accept → play 7 questions → settle → rated once (LIVE)', async () => {
      const u1 = await registerLogin(server, 'challenge-live-1@example.com');
      const u2 = await registerLogin(server, 'challenge-live-2@example.com');
      const created = await createChallenge(u1.agent, u2.userId, 'LIVE').expect(HttpStatus.CREATED);
      const challenge = okBody<any>(created).data;
      expect(challenge.status).toBe('PENDING');
      expect(challenge.duelType).toBe('LIVE');
      expect(challenge.rated).toBe(true);
      expect(challenge.ratingKind).toBe('LEARNING');
      expect(challenge.creator.rating).toBe(1000);
      expect(challenge.invitee.rating).toBe(1000);
      expect(challenge.inviteCode).toMatch(/^[0-9a-f]{16}$/);
      expect(challenge.inviteLink).toBe(`/duels/challenge?code=${challenge.inviteCode}`);
      expect(challenge.expiresInMs).toBeGreaterThan(23 * 60 * 60 * 1000);
      expect(challenge.duelId).toBeNull();

      // The invitee sees it in incoming; the creator in outgoing.
      const incoming = await u2.agent.get('/api/v1/challenges/incoming').expect(HttpStatus.OK);
      expect(okBody<any>(incoming).data).toHaveLength(1);
      const outgoing = await u1.agent.get('/api/v1/challenges/outgoing').expect(HttpStatus.OK);
      expect(okBody<any>(outgoing).data).toHaveLength(1);

      // Accept starts the duel immediately — no queue, no matchmaking.
      const accepted = await u2.agent
        .post(`/api/v1/challenges/${challenge.id}/accept`)
        .expect(HttpStatus.CREATED);
      const acceptedBody = okBody<any>(accepted).data;
      expect(acceptedBody.challenge.status).toBe('PLAYED');
      expect(acceptedBody.challenge.duelId).toBeTruthy();
      expect(acceptedBody.duelId).toBe(acceptedBody.challenge.duelId);
      expect(acceptedBody.playUrl).toBe('/duels/live');

      // Both players open the play page: the socket reconnects them into the active duel.
      const a = await connectLiveChallenge(u1.accessToken);
      const b = await connectLiveChallenge(u2.accessToken);
      try {
        let finished: any = null;
        for (let i = 0; i < 7; i++) {
          const [qa, qb] = await Promise.all([
            a.waitFor('live:question'),
            b.waitFor('live:question'),
          ]);
          expect(qa.question.id).toBe(qb.question.id);
          expect(qa.duelId).toBe(acceptedBody.duelId);
          const ackA = await a.emit('live:answer', {
            duelId: qa.duelId,
            questionId: qa.question.id,
            optionId: correctOptionId(qa.question.id),
          });
          expect(ackA.ok).toBe(true);
          const ackB = await b.emit('live:answer', {
            duelId: qb.duelId,
            questionId: qb.question.id,
            optionId: wrongOptionId(qb.question.id),
          });
          expect(ackB.ok).toBe(true);
          const [ra, rb] = await Promise.all([a.waitFor('live:reveal'), b.waitFor('live:reveal')]);
          expect(ra.myCorrect).toBe(true);
          expect(rb.myCorrect).toBe(false);
        }
        finished = await a.waitFor('live:finished');
        const finishedB = await b.waitFor('live:finished');
        expect(finishedB.duelId).toBe(finished.duelId);
        expect(finished.result).toBe('WIN');
        expect(finished.correct).toBe(7);
        expect(finished.ratingDelta).toBe(20); // provisional K=40, equal ratings
        expect(finishedB.ratingDelta).toBe(-20);

        // Rated exactly once each: gamesPlayed 1, mirrored ratings.
        const afterA = await learningRating(u1.agent);
        const afterB = await learningRating(u2.agent);
        expect(afterA).toEqual({ rating: 1020, gamesPlayed: 1 });
        expect(afterB).toEqual({ rating: 980, gamesPlayed: 1 });

        // The stored result reads back, and the challenge links to the duel.
        const result = await u1.agent
          .get(`/api/v1/duels/${finished.duelId}/result`)
          .expect(HttpStatus.OK);
        expect(okBody<any>(result).data.result).toBe('WIN');
        const seen = await u1.agent.get(`/api/v1/challenges/${challenge.id}`).expect(HttpStatus.OK);
        expect(okBody<any>(seen).data.status).toBe('PLAYED');
        expect(okBody<any>(seen).data.duelId).toBe(finished.duelId);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 60000);

    it('sprint challenge: create → accept → trade → settle → Trading Rating moves', async () => {
      const u1 = await registerLogin(server, 'challenge-sprint-1@example.com');
      const u2 = await registerLogin(server, 'challenge-sprint-2@example.com');
      const created = await createChallenge(u1.agent, u2.userId, 'SPRINT').expect(
        HttpStatus.CREATED
      );
      const challenge = okBody<any>(created).data;
      expect(challenge.ratingKind).toBe('TRADING');
      const accepted = await u2.agent
        .post(`/api/v1/challenges/${challenge.id}/accept`)
        .expect(HttpStatus.CREATED);
      const acceptedBody = okBody<any>(accepted).data;
      expect(acceptedBody.playUrl).toBe('/duels/sprint');
      const a = await connectSprintChallenge(u1.accessToken);
      const b = await connectSprintChallenge(u2.accessToken);
      try {
        const startedA = await a.waitFor('sprint:started', 15000);
        expect(startedA.duelId).toBe(acceptedBody.duelId);
        expect(startedA.cash).toBe('100000.00');
        const nvlt = startedA.instruments.find((i: any) => i.symbol === 'NVLT');
        expect(nvlt).toBeDefined();
        const buy = await a.emit('sprint:order', {
          duelId: acceptedBody.duelId,
          instrumentId: nvlt.id,
          side: 'BUY',
          quantity: 10,
          clientOrderId: '22222222-2222-4222-8222-222222222222',
        });
        expect(buy.ok).toBe(true);
        const [fa, fb] = await Promise.all([
          a.waitFor('sprint:finished', 30000),
          b.waitFor('sprint:finished', 30000),
        ]);
        expect(fa.duelId).toBe(acceptedBody.duelId);
        expect(fa.ratingDelta + fb.ratingDelta).toBe(0);
        expect(fa.tradeCount).toBe(1);
        const resA = await u1.agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
        expect(okBody<any>(resA).data.trading.gamesPlayed).toBe(1);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 60000);

    it('decline closes the challenge and never counts — a fresh challenge is allowed', async () => {
      const u1 = await registerLogin(server, 'challenge-decline-1@example.com');
      const u2 = await registerLogin(server, 'challenge-decline-2@example.com');
      const created = await createChallenge(u1.agent, u2.userId, 'LIVE').expect(HttpStatus.CREATED);
      const id = okBody<any>(created).data.id;
      const declined = await u2.agent
        .post(`/api/v1/challenges/${id}/decline`)
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(declined).data.status).toBe('DECLINED');
      // A declined challenge does not block a new one for the same pair + type.
      await createChallenge(u1.agent, u2.userId, 'LIVE').expect(HttpStatus.CREATED);
      // And the declined one can no longer be accepted.
      const again = await u2.agent.post(`/api/v1/challenges/${id}/accept`);
      expect(again.status).toBe(HttpStatus.CONFLICT);
      expect(errBody(again).error.code).toBe(ErrorCode.CHALLENGE_NOT_PENDING);
    }, 30000);

    it('guards: self-challenge 400, unknown opponent 404, duplicate pending 409, wrong-player accept 403', async () => {
      const u1 = await registerLogin(server, 'challenge-guards-1@example.com');
      const u2 = await registerLogin(server, 'challenge-guards-2@example.com');
      const u3 = await registerLogin(server, 'challenge-guards-3@example.com');
      const self = await createChallenge(u1.agent, u1.userId, 'LIVE');
      expect(self.status).toBe(HttpStatus.BAD_REQUEST);
      expect(errBody(self).error.code).toBe(ErrorCode.VALIDATION_FAILED);
      const ghost = await createChallenge(u1.agent, '99999999-9999-4999-8999-999999999999', 'LIVE');
      expect(ghost.status).toBe(HttpStatus.NOT_FOUND);
      const badType = await u1.agent
        .post('/api/v1/challenges')
        .send({ opponentId: u2.userId, duelType: 'DAILY' });
      expect(badType.status).toBe(HttpStatus.BAD_REQUEST);
      const created = await createChallenge(u1.agent, u2.userId, 'LIVE').expect(HttpStatus.CREATED);
      const id = okBody<any>(created).data.id;
      const dup = await createChallenge(u1.agent, u2.userId, 'LIVE');
      expect(dup.status).toBe(HttpStatus.CONFLICT);
      expect(errBody(dup).error.code).toBe(ErrorCode.CHALLENGE_ALREADY_PENDING);
      const wrongPlayer = await u3.agent.post(`/api/v1/challenges/${id}/accept`);
      expect(wrongPlayer.status).toBe(HttpStatus.FORBIDDEN);
      const creatorAccept = await u1.agent.post(`/api/v1/challenges/${id}/accept`);
      expect(creatorAccept.status).toBe(HttpStatus.FORBIDDEN);
      // The invitee can still accept after the rejected attempts.
      await u2.agent.post(`/api/v1/challenges/${id}/accept`).expect(HttpStatus.CREATED);
      // Cleanup: forfeit so the duel does not linger for later tests.
      await u1.agent
        .post(
          `/api/v1/duels/live/${okBody<any>(await u1.agent.get(`/api/v1/challenges/${id}`)).data.duelId}/forfeit`
        )
        .expect(HttpStatus.CREATED);
    }, 30000);

    it('invite code: the invitee opens it, anyone else gets 404', async () => {
      const u1 = await registerLogin(server, 'challenge-code-1@example.com');
      const u2 = await registerLogin(server, 'challenge-code-2@example.com');
      const created = await createChallenge(u1.agent, u2.userId, 'BLITZ').expect(
        HttpStatus.CREATED
      );
      const code = okBody<any>(created).data.inviteCode;
      const opened = await u2.agent.get(`/api/v1/challenges/invite/${code}`).expect(HttpStatus.OK);
      expect(okBody<any>(opened).data.duelType).toBe('BLITZ');
      const creatorPeek = await u1.agent.get(`/api/v1/challenges/invite/${code}`);
      expect(creatorPeek.status).toBe(HttpStatus.NOT_FOUND);
      const badCode = await u2.agent.get('/api/v1/challenges/invite/0000000000000000');
      expect(badCode.status).toBe(HttpStatus.NOT_FOUND);
    }, 30000);

    it('expiry: a challenge past 24 h cannot be accepted and reads as EXPIRED', async () => {
      const u1 = await registerLogin(server, 'challenge-expiry-1@example.com');
      const u2 = await registerLogin(server, 'challenge-expiry-2@example.com');
      const created = await createChallenge(u1.agent, u2.userId, 'LIVE').expect(HttpStatus.CREATED);
      const id = okBody<any>(created).data.id;
      // Move the expiry into the past in the fake store (no 24 h wait in tests).
      const stored = db.challenges.get(id);
      stored.expiresAt = new Date(Date.now() - 1000);
      const accept = await u2.agent.post(`/api/v1/challenges/${id}/accept`);
      expect(accept.status).toBe(HttpStatus.CONFLICT);
      expect(errBody(accept).error.code).toBe(ErrorCode.CHALLENGE_EXPIRED);
      const seen = await u1.agent.get(`/api/v1/challenges/${id}`).expect(HttpStatus.OK);
      expect(okBody<any>(seen).data.status).toBe('EXPIRED');
      // An expired challenge does not block a fresh one.
      await createChallenge(u1.agent, u2.userId, 'LIVE').expect(HttpStatus.CREATED);
    }, 30000);

    it('busy guard: a player already in a live duel cannot be challenged', async () => {
      const u1 = await registerLogin(server, 'challenge-busy-1@example.com');
      const u2 = await registerLogin(server, 'challenge-busy-2@example.com');
      const u3 = await registerLogin(server, 'challenge-busy-3@example.com');
      const created = await createChallenge(u1.agent, u2.userId, 'LIVE').expect(HttpStatus.CREATED);
      const id = okBody<any>(created).data.id;
      const accepted = await u2.agent
        .post(`/api/v1/challenges/${id}/accept`)
        .expect(HttpStatus.CREATED);
      const duelId = okBody<any>(accepted).data.duelId;
      const busy = await createChallenge(u3.agent, u1.userId, 'LIVE');
      expect(busy.status).toBe(HttpStatus.CONFLICT);
      expect(errBody(busy).error.code).toBe(ErrorCode.DUEL_LIVE_ALREADY_ACTIVE);
      // Cleanup: forfeit the live duel.
      await u1.agent.post(`/api/v1/duels/live/${duelId}/forfeit`).expect(HttpStatus.CREATED);
    }, 30000);

    it('rate limit: the 11th challenge create in an hour is 429', async () => {
      const u1 = await registerLogin(server, 'challenge-rate-1@example.com');
      const u2 = await registerLogin(server, 'challenge-rate-2@example.com');
      for (let i = 0; i < 10; i++) {
        const created = await createChallenge(u1.agent, u2.userId, 'LIVE').expect(
          HttpStatus.CREATED
        );
        const id = okBody<any>(created).data.id;
        await u2.agent.post(`/api/v1/challenges/${id}/decline`).expect(HttpStatus.CREATED);
      }
      const eleventh = await createChallenge(u1.agent, u2.userId, 'LIVE');
      expect(eleventh.status).toBe(HttpStatus.TOO_MANY_REQUESTS);
      expect(errBody(eleventh).error.code).toBe(ErrorCode.RATE_LIMITED);
    }, 30000);
  });

  describe('paper trading sprint', () => {
    /** Buffered socket client: events are queued, so nothing is missed between emits. */
    class SprintClient {
      socket: ClientSocket;
      label = '?';
      private readonly seen = new Map<string, any[]>();
      private readonly waiters = new Map<string, Array<(p: any) => void>>();

      constructor(socket: ClientSocket) {
        this.socket = socket;
        for (const event of [
          'sprint:queued',
          'sprint:queue-left',
          'sprint:bot-offer',
          'sprint:matched',
          'sprint:countdown',
          'sprint:started',
          'sprint:tick',
          'sprint:order-accepted',
          'sprint:opponent-disconnected',
          'sprint:opponent-reconnected',
          'sprint:rematch-requested',
          'sprint:finished',
          'sprint:error',
        ]) {
          socket.on(event, (payload: any) => this.push(event, payload));
        }
      }

      private push(event: string, payload: any): void {
        const waiters = this.waiters.get(event) ?? [];
        const w = waiters.shift();
        if (w) {
          w(payload);
          return;
        }
        const list = this.seen.get(event) ?? [];
        list.push(payload);
        this.seen.set(event, list);
      }

      waitFor(event: string, timeoutMs = 10000): Promise<any> {
        const buffered = this.seen.get(event);
        if (buffered && buffered.length > 0) return Promise.resolve(buffered.shift());
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`timed out waiting for ${event}`)),
            timeoutMs
          );
          const list = this.waiters.get(event) ?? [];
          list.push((payload: any) => {
            clearTimeout(timer);
            resolve(payload);
          });
          this.waiters.set(event, list);
        });
      }

      emit(event: string, payload: unknown): Promise<any> {
        return new Promise((resolve) => {
          this.socket.emit(event, payload, (ack: any) => resolve(ack));
        });
      }

      disconnect(): void {
        this.socket.disconnect();
      }
    }

    const sprintPort = async (): Promise<number> => {
      const httpServer = serverOf(app);
      if (!httpServer.listening) {
        await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
      }
      return (httpServer.address() as AddressInfo).port;
    };

    const connectSprint = async (token?: string, label = '?'): Promise<SprintClient> => {
      const port = await sprintPort();
      const socket = io(`http://127.0.0.1:${port}/sprint`, {
        auth: token ? { token } : {},
        transports: ['websocket'],
        forceNew: true,
      });
      const client = new SprintClient(socket);
      client.label = label;
      return client;
    };

    const tradingRating = async (
      agent: Agent
    ): Promise<{ rating: number; gamesPlayed: number }> => {
      const res = await agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
      return okBody<any>(res).data.trading as { rating: number; gamesPlayed: number };
    };

    /** Queue two players and wait for match + countdown + start. Returns the matched payloads. */
    const queueAndMatch = async (
      a: SprintClient,
      b: SprintClient
    ): Promise<{ ma: any; mb: any; startedA: any; startedB: any }> => {
      await Promise.all([a.emit('sprint:join-queue', {}), b.emit('sprint:join-queue', {})]);
      const [ma, mb] = await Promise.all([
        a.waitFor('sprint:matched'),
        b.waitFor('sprint:matched'),
      ]);
      expect(ma.duelId).toBe(mb.duelId);
      expect(ma.host.name).toBe('Tara');
      expect(ma.startingCash).toBe('100000.00');
      expect(ma.instruments).toHaveLength(6);
      await Promise.all([a.waitFor('sprint:countdown'), b.waitFor('sprint:countdown')]);
      const [startedA, startedB] = await Promise.all([
        a.waitFor('sprint:started'),
        b.waitFor('sprint:started'),
      ]);
      expect(startedA.duelId).toBe(ma.duelId);
      return { ma, mb, startedA, startedB };
    };

    it('sprint happy path: queue → match → trade → settle → Trading Rating change', async () => {
      const u1 = await registerLogin(server, 'sprint-happy-1@example.com');
      const u2 = await registerLogin(server, 'sprint-happy-2@example.com');
      const a = await connectSprint(u1.accessToken, 'A');
      const b = await connectSprint(u2.accessToken, 'B');
      try {
        const beforeA = await tradingRating(u1.agent);
        const beforeB = await tradingRating(u2.agent);
        expect(beforeA.rating).toBe(1000);
        expect(beforeB.rating).toBe(1000);

        const { ma, startedA } = await queueAndMatch(a, b);
        // Each player gets their OWN cash + portfolio at start.
        expect(startedA.cash).toBe('100000.00');
        expect(startedA.portfolio.cash).toBe('100000.00');
        expect(startedA.instruments).toHaveLength(6);
        expect(startedA.instruments[0]?.price).toBeDefined();
        const nvlt = startedA.instruments.find((i: any) => i.symbol === 'NVLT');
        expect(nvlt).toBeDefined();

        // A buys 10 NVLT; a retried clientOrderId replays, never double-applies.
        const buy = await a.emit('sprint:order', {
          duelId: ma.duelId,
          instrumentId: nvlt.id,
          side: 'BUY',
          quantity: 10,
          clientOrderId: '11111111-1111-4111-8111-111111111111',
        });
        expect(buy.ok).toBe(true);
        expect(buy.order.symbol).toBe('NVLT');
        expect(buy.order.quantity).toBe('10.000000');
        expect(Number(buy.portfolio.cash)).toBeLessThan(100000);
        expect(buy.portfolio.holdings).toHaveLength(1);
        const replay = await a.emit('sprint:order', {
          duelId: ma.duelId,
          instrumentId: nvlt.id,
          side: 'BUY',
          quantity: 10,
          clientOrderId: '11111111-1111-4111-8111-111111111111',
        });
        expect(replay.ok).toBe(true);
        expect(replay.order).toEqual(buy.order);

        // A tick carries prices + both total equities — never holdings or orders.
        const tick = await a.waitFor('sprint:tick', 15000);
        expect(tick.prices).toHaveLength(6);
        expect(tick.equities[u1.userId]).toBeDefined();
        expect(tick.equities[u2.userId]).toBeDefined();
        expect(JSON.stringify(tick)).not.toContain('holdings');

        // The 20 s sprint settles on the server timer.
        const [fa, fb] = await Promise.all([
          a.waitFor('sprint:finished', 30000),
          b.waitFor('sprint:finished', 30000),
        ]);
        expect(fa.duelId).toBe(ma.duelId);
        expect(fb.duelId).toBe(ma.duelId);
        // Mirrored results and mirrored Rating deltas, whatever the market did.
        const mirror = fa.result === 'WIN' ? 'LOSS' : fa.result === 'LOSS' ? 'WIN' : 'DRAW';
        expect(fb.result).toBe(mirror);
        expect(fa.ratingDelta + fb.ratingDelta).toBe(0);
        expect(fa.xp.awarded).toBe(fa.result === 'WIN' ? 20 : fa.result === 'DRAW' ? 5 : 0);
        expect(fa.host.name).toBe('Tara');
        expect(fa.tradeCount).toBe(1);
        expect(fa.perInstrument).toHaveLength(1);
        expect(fa.perInstrument[0].symbol).toBe('NVLT');
        expect(typeof fa.riskAdjustedScore).toBe('number');
        expect(fa.equityCurve.length).toBeGreaterThan(0);

        // The stored result reads back over REST, and history lists the sprint.
        const result = await u1.agent
          .get(`/api/v1/sprint/${ma.duelId}/result`)
          .expect(HttpStatus.OK);
        expect(okBody<any>(result).data.result).toBe(fa.result);
        expect(okBody<any>(result).data.tradeCount).toBe(1);
        const history = await u1.agent.get('/api/v1/sprint/history').expect(HttpStatus.OK);
        expect(okBody<any>(history).data.items).toHaveLength(1);
        expect(okBody<any>(history).data.items[0].duelId).toBe(ma.duelId);

        // Trading Rating moved once for each player (gamesPlayed 1).
        const afterA = await tradingRating(u1.agent);
        const afterB = await tradingRating(u2.agent);
        expect(afterA.gamesPlayed).toBe(1);
        expect(afterB.gamesPlayed).toBe(1);
        expect(afterA.rating).toBe(1000 + fa.ratingDelta);
        expect(afterB.rating).toBe(1000 + fb.ratingDelta);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 60000);

    it('sprint queue is separate: a sprint waiter never matches a live waiter', async () => {
      const u1 = await registerLogin(server, 'sprint-sep-1@example.com');
      const u2 = await registerLogin(server, 'sprint-sep-2@example.com');
      const sprintClient = await connectSprint(u1.accessToken, 'S');
      // Minimal /duels-live client (the full LiveClient lives in the
      // 'live duels' describe): only the queue events are needed here.
      const livePort = await sprintPort();
      const liveSocket = io(`http://127.0.0.1:${livePort}/duels-live`, {
        auth: { token: u2.accessToken },
        transports: ['websocket'],
        forceNew: true,
      });
      const liveSeen = new Map<string, any[]>();
      const liveWaiters = new Map<string, Array<(p: any) => void>>();
      for (const event of ['live:queued', 'live:matched', 'live:queue-left']) {
        liveSocket.on(event, (payload: any) => {
          const w = (liveWaiters.get(event) ?? []).shift();
          if (w) return w(payload);
          const list = liveSeen.get(event) ?? [];
          list.push(payload);
          liveSeen.set(event, list);
        });
      }
      const liveWaitFor = (event: string, timeoutMs = 10000): Promise<any> => {
        const buffered = liveSeen.get(event);
        if (buffered && buffered.length > 0) return Promise.resolve(buffered.shift());
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`timed out waiting for ${event}`)),
            timeoutMs
          );
          const list = liveWaiters.get(event) ?? [];
          list.push((p: any) => {
            clearTimeout(timer);
            resolve(p);
          });
          liveWaiters.set(event, list);
        });
      };
      const liveEmit = (event: string, payload: unknown): Promise<any> =>
        new Promise((resolve) => {
          liveSocket.emit(event, payload, (ack: any) => resolve(ack));
        });
      try {
        await sprintClient.emit('sprint:join-queue', {});
        await sprintClient.waitFor('sprint:queued');
        await liveEmit('live:join-queue', {});
        await liveWaitFor('live:queued');
        // Both queues have one waiter each; the 5 s sweeps run, but the
        // queues are separate — neither side is ever matched.
        await Promise.all([
          expect(sprintClient.waitFor('sprint:matched', 6000)).rejects.toThrow('timed out'),
          expect(liveWaitFor('live:matched', 6000)).rejects.toThrow('timed out'),
        ]);
        expect((await sprintClient.emit('sprint:leave-queue', {})).ok).toBe(true);
        expect((await liveEmit('live:leave-queue', {})).ok).toBe(true);
      } finally {
        sprintClient.disconnect();
        liveSocket.disconnect();
      }
    }, 30000);

    it('sprint REST: queue status, active sprint, and another player’s result is forbidden', async () => {
      const u1 = await registerLogin(server, 'sprint-rest-1@example.com');
      const u2 = await registerLogin(server, 'sprint-rest-2@example.com');
      const a = await connectSprint(u1.accessToken, 'A');
      const b = await connectSprint(u2.accessToken, 'B');
      try {
        const before = await u1.agent.get('/api/v1/sprint/active').expect(HttpStatus.OK);
        expect(okBody<any>(before).data).toBeNull();
        await a.emit('sprint:join-queue', {});
        await a.waitFor('sprint:queued');
        const queued = await u1.agent.get('/api/v1/sprint/queue/status').expect(HttpStatus.OK);
        expect(okBody<any>(queued).data.queued).toBe(true);
        expect(okBody<any>(queued).data.ratingWindow).toBe(50);
        expect(okBody<any>(queued).data.botOfferDue).toBe(false);

        // B joins; the sweep pairs them (A is already queued — no re-join).
        await b.emit('sprint:join-queue', {});
        const [ma, mb] = await Promise.all([
          a.waitFor('sprint:matched'),
          b.waitFor('sprint:matched'),
        ]);
        expect(ma.duelId).toBe(mb.duelId);
        await Promise.all([a.waitFor('sprint:countdown'), b.waitFor('sprint:countdown')]);
        await Promise.all([a.waitFor('sprint:started'), b.waitFor('sprint:started')]);
        const active = await u1.agent.get('/api/v1/sprint/active').expect(HttpStatus.OK);
        expect(okBody<any>(active).data.duelId).toBe(ma.duelId);
        expect(okBody<any>(active).data.type).toBe('SPRINT');
        const state = await u1.agent.get(`/api/v1/sprint/${ma.duelId}/state`).expect(HttpStatus.OK);
        expect(okBody<any>(state).data.myPortfolio.cash).toBe('100000.00');
        expect(okBody<any>(state).data.myPortfolio.holdings).toHaveLength(0);
        expect(okBody<any>(state).data.opponentEquity).toBe('100000.00');
        // My own holdings are shown; the opponent's never are.
        expect(okBody<any>(state).data).not.toHaveProperty('opponentHoldings');

        // Leaving mid-sprint forfeits; the opponent's result is not mine to read.
        await a.emit('sprint:leave-sprint', { duelId: ma.duelId });
        const [fa, fb] = await Promise.all([
          a.waitFor('sprint:finished', 15000),
          b.waitFor('sprint:finished', 15000),
        ]);
        expect(fa.result).toBe('LOSS');
        expect(fb.result).toBe('WIN');
        const others = await u2.agent
          .get(`/api/v1/sprint/${ma.duelId}/result`)
          .expect(HttpStatus.OK);
        expect(okBody<any>(others).data.result).toBe('WIN');
        const u3 = await registerLogin(server, 'sprint-rest-3@example.com');
        await u3.agent.get(`/api/v1/sprint/${ma.duelId}/result`).expect(HttpStatus.FORBIDDEN);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 60000);

    it('sprint forfeit: the leaver loses −20 Trading Rating, the opponent wins +20', async () => {
      const u1 = await registerLogin(server, 'sprint-forfeit-1@example.com');
      const u2 = await registerLogin(server, 'sprint-forfeit-2@example.com');
      const a = await connectSprint(u1.accessToken, 'A');
      const b = await connectSprint(u2.accessToken, 'B');
      try {
        const { ma } = await queueAndMatch(a, b);
        const ack = await a.emit('sprint:leave-sprint', { duelId: ma.duelId });
        expect(ack.ok).toBe(true);
        const [fa, fb] = await Promise.all([
          a.waitFor('sprint:finished', 15000),
          b.waitFor('sprint:finished', 15000),
        ]);
        expect(fa.result).toBe('LOSS');
        expect(fb.result).toBe('WIN');
        expect(fa.forfeitedBy).toBe(u1.userId);
        expect(fa.ratingDelta).toBe(-20);
        expect(fb.ratingDelta).toBe(20);
        expect(fa.xp.awarded).toBe(0);
        expect(fb.xp.awarded).toBe(20);
        const afterA = await tradingRating(u1.agent);
        const afterB = await tradingRating(u2.agent);
        expect(afterA.rating).toBe(980);
        expect(afterB.rating).toBe(1020);
        expect(afterA.gamesPlayed).toBe(1);
        expect(afterB.gamesPlayed).toBe(1);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 60000);

    it('sprint order validation: bad quantity, unknown instrument, no holdings', async () => {
      const u1 = await registerLogin(server, 'sprint-order-1@example.com');
      const u2 = await registerLogin(server, 'sprint-order-2@example.com');
      const a = await connectSprint(u1.accessToken, 'A');
      const b = await connectSprint(u2.accessToken, 'B');
      try {
        const { ma, startedA } = await queueAndMatch(a, b);
        const nvlt = startedA.instruments.find((i: any) => i.symbol === 'NVLT');
        const badQty = await a.emit('sprint:order', {
          duelId: ma.duelId,
          instrumentId: nvlt.id,
          side: 'BUY',
          quantity: 0,
          clientOrderId: uuidv4(),
        });
        expect(badQty.ok).toBe(false);
        expect(badQty.code).toBe(ErrorCode.VALIDATION_FAILED);
        const ghost = await a.emit('sprint:order', {
          duelId: ma.duelId,
          instrumentId: uuidv4(),
          side: 'BUY',
          quantity: 1,
          clientOrderId: uuidv4(),
        });
        expect(ghost.ok).toBe(false);
        expect(ghost.code).toBe(ErrorCode.VALIDATION_FAILED);
        const noHolding = await a.emit('sprint:order', {
          duelId: ma.duelId,
          instrumentId: nvlt.id,
          side: 'SELL',
          quantity: 1,
          clientOrderId: uuidv4(),
        });
        expect(noHolding.ok).toBe(false);
        expect(noHolding.code).toBe(ErrorCode.INSUFFICIENT_HOLDINGS);
        // A valid order still works after the rejections.
        const buy = await a.emit('sprint:order', {
          duelId: ma.duelId,
          instrumentId: nvlt.id,
          side: 'BUY',
          quantity: 1,
          clientOrderId: uuidv4(),
        });
        expect(buy.ok).toBe(true);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 60000);

    it('sprint bot duel: the 30 s offer, Mira trades, the sprint settles rated', async () => {
      const u = await registerLogin(server, 'sprint-bot-1@example.com');
      const client = await connectSprint(u.accessToken, 'S');
      try {
        await client.emit('sprint:join-queue', {});
        await client.waitFor('sprint:queued');
        const offer = await client.waitFor('sprint:bot-offer', 40000);
        expect(offer.botName).toBe('Mira');
        const ack = await client.emit('sprint:accept-bot', {});
        expect(ack.ok).toBe(true);
        expect(ack.opponent).toBe('BOT');
        const matched = await client.waitFor('sprint:matched');
        expect(matched.opponent.kind).toBe('BOT');
        expect(matched.opponent.displayName).toBe('Mira');
        const started = await client.waitFor('sprint:started');
        const nvlt = started.instruments.find((i: any) => i.symbol === 'NVLT');
        const buy = await client.emit('sprint:order', {
          duelId: matched.duelId,
          instrumentId: nvlt.id,
          side: 'BUY',
          quantity: 5,
          clientOrderId: uuidv4(),
        });
        expect(buy.ok).toBe(true);
        const finished = await client.waitFor('sprint:finished', 30000);
        expect(finished.duelId).toBe(matched.duelId);
        expect(finished.opponent.kind).toBe('BOT');
        expect(finished.opponent.name).toBe('Mira');
        expect(finished.tradeCount).toBe(1);
        expect([-20, 0, 20]).toContain(finished.ratingDelta);
        const after = await tradingRating(u.agent);
        expect(after.gamesPlayed).toBe(1);
        expect(after.rating).toBe(1000 + finished.ratingDelta);
      } finally {
        client.disconnect();
      }
    }, 90000);

    it('sprint socket without a token is disconnected', async () => {
      const client = await connectSprint();
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('socket stayed connected')), 5000);
          client.socket.on('disconnect', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      } finally {
        client.disconnect();
      }
    }, 30000);
  });

  describe('crisis duel', () => {
    /** Buffered socket client: events are queued, so nothing is missed between emits. */
    class CrisisClient {
      socket: ClientSocket;
      label = '?';
      private readonly seen = new Map<string, any[]>();
      private readonly waiters = new Map<string, Array<(p: any) => void>>();

      constructor(socket: ClientSocket) {
        this.socket = socket;
        for (const event of [
          'crisis:queued',
          'crisis:queue-left',
          'crisis:bot-offer',
          'crisis:matched',
          'crisis:countdown',
          'crisis:started',
          'crisis:tick',
          'crisis:crash',
          'crisis:order-accepted',
          'crisis:opponent-disconnected',
          'crisis:opponent-reconnected',
          'crisis:rematch-requested',
          'crisis:finished',
          'crisis:error',
        ]) {
          socket.on(event, (payload: any) => this.push(event, payload));
        }
      }

      private push(event: string, payload: any): void {
        const waiters = this.waiters.get(event) ?? [];
        const w = waiters.shift();
        if (w) {
          w(payload);
          return;
        }
        const list = this.seen.get(event) ?? [];
        list.push(payload);
        this.seen.set(event, list);
      }

      waitFor(event: string, timeoutMs = 10000): Promise<any> {
        const buffered = this.seen.get(event);
        if (buffered && buffered.length > 0) return Promise.resolve(buffered.shift());
        return new Promise((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`timed out waiting for ${event}`)),
            timeoutMs
          );
          const list = this.waiters.get(event) ?? [];
          list.push((payload: any) => {
            clearTimeout(timer);
            resolve(payload);
          });
          this.waiters.set(event, list);
        });
      }

      emit(event: string, payload: unknown): Promise<any> {
        return new Promise((resolve) => {
          this.socket.emit(event, payload, (ack: any) => resolve(ack));
        });
      }

      disconnect(): void {
        this.socket.disconnect();
      }
    }

    const crisisPort = async (): Promise<number> => {
      const httpServer = serverOf(app);
      if (!httpServer.listening) {
        await new Promise<void>((resolve) => httpServer.listen(0, () => resolve()));
      }
      return (httpServer.address() as AddressInfo).port;
    };

    const connectCrisis = async (token?: string, label = '?'): Promise<CrisisClient> => {
      const port = await crisisPort();
      const socket = io(`http://127.0.0.1:${port}/crisis`, {
        auth: token ? { token } : {},
        transports: ['websocket'],
        forceNew: true,
      });
      const client = new CrisisClient(socket);
      client.label = label;
      return client;
    };

    /**
     * Minimal /sprint client for the queue-separation test only (the full
     * SprintClient lives in the 'paper trading sprint' describe).
     */
    const connectSprintMinimal = async (
      token: string
    ): Promise<{
      emit: (event: string, payload: unknown) => Promise<any>;
      waitFor: (event: string, timeoutMs?: number) => Promise<any>;
      disconnect: () => void;
    }> => {
      const port = await crisisPort();
      const socket = io(`http://127.0.0.1:${port}/sprint`, {
        auth: { token },
        transports: ['websocket'],
        forceNew: true,
      });
      const seen = new Map<string, any[]>();
      const waiters = new Map<string, Array<(p: any) => void>>();
      for (const event of ['sprint:queued', 'sprint:matched', 'sprint:queue-left']) {
        socket.on(event, (payload: any) => {
          const w = (waiters.get(event) ?? []).shift();
          if (w) return w(payload);
          const list = seen.get(event) ?? [];
          list.push(payload);
          seen.set(event, list);
        });
      }
      return {
        emit: (event: string, payload: unknown): Promise<any> =>
          new Promise((resolve) => {
            socket.emit(event, payload, (ack: any) => resolve(ack));
          }),
        waitFor: (event: string, timeoutMs = 10000): Promise<any> => {
          const buffered = seen.get(event);
          if (buffered && buffered.length > 0) return Promise.resolve(buffered.shift());
          return new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error(`timed out waiting for ${event}`)),
              timeoutMs
            );
            const list = waiters.get(event) ?? [];
            list.push((p: any) => {
              clearTimeout(timer);
              resolve(p);
            });
            waiters.set(event, list);
          });
        },
        disconnect: (): void => {
          socket.disconnect();
        },
      };
    };

    const crisisTradingRating = async (
      agent: Agent
    ): Promise<{ rating: number; gamesPlayed: number }> => {
      const res = await agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
      return okBody<any>(res).data.trading as { rating: number; gamesPlayed: number };
    };

    /** Queue two players and wait for match + countdown + start. Returns the matched payloads. */
    const queueAndMatchCrisis = async (
      a: CrisisClient,
      b: CrisisClient
    ): Promise<{ ma: any; mb: any; startedA: any; startedB: any }> => {
      await Promise.all([a.emit('crisis:join-queue', {}), b.emit('crisis:join-queue', {})]);
      const [ma, mb] = await Promise.all([
        a.waitFor('crisis:matched'),
        b.waitFor('crisis:matched'),
      ]);
      expect(ma.duelId).toBe(mb.duelId);
      expect(ma.host.name).toBe('Tara');
      expect(ma.host.line).toMatch(/crash/i);
      expect(ma.host.line).not.toMatch(/minute [0-9]/); // never disclosed in advance
      expect(ma.startingCash).toBe('100000.00');
      expect(ma.instruments).toHaveLength(6);
      await Promise.all([a.waitFor('crisis:countdown'), b.waitFor('crisis:countdown')]);
      const [startedA, startedB] = await Promise.all([
        a.waitFor('crisis:started'),
        b.waitFor('crisis:started'),
      ]);
      expect(startedA.duelId).toBe(ma.duelId);
      return { ma, mb, startedA, startedB };
    };

    /** Whole units for a near-all-in buy (leave a little cash for rounding). */
    const allInQty = (price: string): number => Math.floor(99000 / Number(price));

    const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

    it('crisis happy path: queue → match → trade → crash fires → settle → Trading Rating change', async () => {
      const u1 = await registerLogin(server, 'crisis-happy-1@example.com');
      const u2 = await registerLogin(server, 'crisis-happy-2@example.com');
      const a = await connectCrisis(u1.accessToken, 'A');
      const b = await connectCrisis(u2.accessToken, 'B');
      try {
        const beforeA = await crisisTradingRating(u1.agent);
        const beforeB = await crisisTradingRating(u2.agent);
        expect(beforeA.rating).toBe(1000);
        expect(beforeB.rating).toBe(1000);

        const { ma, startedA } = await queueAndMatchCrisis(a, b);
        const nvlt = startedA.instruments.find((i: any) => i.symbol === 'NVLT');
        expect(nvlt).toBeDefined();
        const qty = allInQty(nvlt.price);

        // A goes (near) all-in at the start; B stays in cash.
        const buy = await a.emit('crisis:order', {
          duelId: ma.duelId,
          instrumentId: nvlt.id,
          side: 'BUY',
          quantity: qty,
          clientOrderId: '22222222-2222-4222-8222-222222222222',
        });
        expect(buy.ok).toBe(true);
        expect(buy.order.symbol).toBe('NVLT');

        // The crash fires mid-duel in test time (20 s duel, ~1.33 s per
        // crisis minute): the banner event arrives with the seeded minute.
        const crash = await a.waitFor('crisis:crash', 20000);
        expect(crash.duelId).toBe(ma.duelId);
        expect(crash.crashMinute).toBeGreaterThanOrEqual(7);
        expect(crash.crashMinute).toBeLessThanOrEqual(10);
        expect(crash.dropPct).toBe(12);
        expect(crash.dropMinutes).toBe(3);
        expect(crash.recoveryPct).toBe(5);
        // A later tick carries the crash flag — the banner state survives a reconnect.
        let crashTick: any = null;
        for (let i = 0; i < 4 && !crashTick; i++) {
          const tick = await a.waitFor('crisis:tick', 10000);
          if (tick.crashFired) crashTick = tick;
        }
        expect(crashTick).not.toBeNull();
        expect(crashTick.prices).toHaveLength(6);

        // The 20 s crisis duel settles on the server timer.
        const [fa, fb] = await Promise.all([
          a.waitFor('crisis:finished', 30000),
          b.waitFor('crisis:finished', 30000),
        ]);
        expect(fa.duelId).toBe(ma.duelId);
        expect(fa.type).toBe('CRISIS');
        // Cash-early beats the holder: B stayed in cash through the crash.
        expect(fb.result).toBe('WIN');
        expect(fa.result).toBe('LOSS');
        expect(fb.ratingDelta).toBe(20);
        expect(fa.ratingDelta).toBe(-20);
        expect(fb.xp.awarded).toBe(20);
        expect(fa.xp.awarded).toBe(0);
        expect(fa.host.name).toBe('Tara');
        // The stored result carries the crash: minute, drawdown, plain-words line.
        expect(fa.crisis).toBeDefined();
        expect(fa.crisis.crashMinute).toBe(crash.crashMinute);
        expect(fa.crisis.crashDrawdownPct).toBeGreaterThan(0);
        expect(fa.crisis.tradesDuringCrash).toBe(0); // A's buy was before the crash
        expect(fa.crisis.panicSold).toBe(false);
        expect(fa.crisis.crashLine).toMatch(/crash/i);
        expect(fb.crisis).toBeDefined();
        expect(fb.crisis.panicSold).toBe(false);

        // The stored result reads back over REST, and history lists the crisis.
        const result = await u1.agent
          .get(`/api/v1/crisis/${ma.duelId}/result`)
          .expect(HttpStatus.OK);
        expect(okBody<any>(result).data.result).toBe('LOSS');
        expect(okBody<any>(result).data.type).toBe('CRISIS');
        expect(okBody<any>(result).data.crisis.crashMinute).toBe(crash.crashMinute);
        const history = await u1.agent.get('/api/v1/crisis/history').expect(HttpStatus.OK);
        expect(okBody<any>(history).data.items).toHaveLength(1);
        expect(okBody<any>(history).data.items[0].duelId).toBe(ma.duelId);
        expect(okBody<any>(history).data.items[0].type).toBe('CRISIS');

        // Trading Rating moved once for each player (gamesPlayed 1).
        const afterA = await crisisTradingRating(u1.agent);
        const afterB = await crisisTradingRating(u2.agent);
        expect(afterA.gamesPlayed).toBe(1);
        expect(afterB.gamesPlayed).toBe(1);
        expect(afterA.rating).toBe(980);
        expect(afterB.rating).toBe(1020);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 90000);

    it('crisis panic seller loses to the calm holder, and is flagged panicSold', async () => {
      const u1 = await registerLogin(server, 'crisis-panic-1@example.com');
      const u2 = await registerLogin(server, 'crisis-panic-2@example.com');
      const a = await connectCrisis(u1.accessToken, 'A');
      const b = await connectCrisis(u2.accessToken, 'B');
      try {
        const { ma, startedA } = await queueAndMatchCrisis(a, b);
        const nvlt = startedA.instruments.find((i: any) => i.symbol === 'NVLT');
        const qty = allInQty(nvlt.price);
        const startedAtMs: number = startedA.startedAtMs;

        // Both go (near) all-in at the start.
        for (const client of [a, b]) {
          const buy = await client.emit('crisis:order', {
            duelId: ma.duelId,
            instrumentId: nvlt.id,
            side: 'BUY',
            quantity: qty,
            clientOrderId: uuidv4(),
          });
          expect(buy.ok).toBe(true);
        }

        const crash = await a.waitFor('crisis:crash', 20000);
        // Sell at the bottom: the last fall minute (crashMinute + 2,
        // factor 0.88) — the crash minute is public once it has fired,
        // and the test duel is 20 s, so one crisis minute is 20/15 s.
        // Selling here locks the full −12% and misses the +5% recovery.
        // The sale is centred in the bottom minute (+650 ms of its
        // 1,333 ms), but centring alone is NOT the hardening: under
        // full-suite load the sleep + socket + server round-trip can
        // still execute past the fall window, and a strict window
        // would then miss the sale (proven: full e2e 127/128 twice,
        // same test, only panicSold false). The hardening is the
        // server-side panic window (docs/15 §6): one crisis minute
        // of execution grace, so a sale executing in the first
        // recovery minute (factor 0.89) still flags panicSold.
        const sellAtMs = startedAtMs + (crash.crashMinute + 2) * (20000 / 15) + 650;
        await sleep(Math.max(0, sellAtMs - Date.now()));
        const sell = await a.emit('crisis:order', {
          duelId: ma.duelId,
          instrumentId: nvlt.id,
          side: 'SELL',
          quantity: qty,
          clientOrderId: uuidv4(),
        });
        expect(sell.ok).toBe(true);

        const [fa, fb] = await Promise.all([
          a.waitFor('crisis:finished', 30000),
          b.waitFor('crisis:finished', 30000),
        ]);
        // The calm holder recovers part of the fall; the panic seller does not.
        expect(fb.result).toBe('WIN');
        expect(fa.result).toBe('LOSS');
        expect(fb.ratingDelta).toBe(20);
        expect(fa.ratingDelta).toBe(-20);
        expect(fa.crisis.panicSold).toBe(true);
        expect(fa.crisis.tradesDuringCrash).toBe(1);
        expect(fb.crisis.panicSold).toBe(false);
        expect(fb.crisis.tradesDuringCrash).toBe(0);
        // Both players' crash drawdowns are > 0: each rode the fall.
        // No ordering between them is asserted on purpose: in
        // continuous time both equities touch the bottom — the holder
        // rides through it, the seller locks it — so peak-to-trough
        // crash drawdown is EQUAL for both by construction, and any
        // observed gap is an artifact of the minute-bucketed equity
        // curve (a shared mid-duel sample is the trough for both).
        // A strict fa > fb here failed under full-suite load with
        // both at 11.8835. The ordering guarantee is the win/loss
        // and Rating above, not the drawdown.
        expect(fa.crisis.crashDrawdownPct).toBeGreaterThan(0);
        expect(fb.crisis.crashDrawdownPct).toBeGreaterThan(0);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 90000);

    it('crisis queue is separate: a crisis waiter never matches a sprint waiter', async () => {
      const u1 = await registerLogin(server, 'crisis-sep-1@example.com');
      const u2 = await registerLogin(server, 'crisis-sep-2@example.com');
      const crisisClient = await connectCrisis(u1.accessToken, 'C');
      const sprintClient = await connectSprintMinimal(u2.accessToken);
      try {
        await crisisClient.emit('crisis:join-queue', {});
        await crisisClient.waitFor('crisis:queued');
        await sprintClient.emit('sprint:join-queue', {});
        await sprintClient.waitFor('sprint:queued');
        // Both queues have one waiter each; the 5 s sweeps run, but the
        // queues are separate — neither side is ever matched.
        await Promise.all([
          expect(crisisClient.waitFor('crisis:matched', 6000)).rejects.toThrow('timed out'),
          expect(sprintClient.waitFor('sprint:matched', 6000)).rejects.toThrow('timed out'),
        ]);
        expect((await crisisClient.emit('crisis:leave-queue', {})).ok).toBe(true);
        expect((await sprintClient.emit('sprint:leave-queue', {})).ok).toBe(true);
      } finally {
        crisisClient.disconnect();
        sprintClient.disconnect();
      }
    }, 30000);

    it('crisis REST: queue status, active crisis, and another player’s result is forbidden', async () => {
      const u1 = await registerLogin(server, 'crisis-rest-1@example.com');
      const u2 = await registerLogin(server, 'crisis-rest-2@example.com');
      const a = await connectCrisis(u1.accessToken, 'A');
      const b = await connectCrisis(u2.accessToken, 'B');
      try {
        const before = await u1.agent.get('/api/v1/crisis/active').expect(HttpStatus.OK);
        expect(okBody<any>(before).data).toBeNull();
        await a.emit('crisis:join-queue', {});
        await a.waitFor('crisis:queued');
        const queued = await u1.agent.get('/api/v1/crisis/queue/status').expect(HttpStatus.OK);
        expect(okBody<any>(queued).data.queued).toBe(true);
        expect(okBody<any>(queued).data.ratingWindow).toBe(50);
        expect(okBody<any>(queued).data.botOfferDue).toBe(false);

        await b.emit('crisis:join-queue', {});
        const [ma, mb] = await Promise.all([
          a.waitFor('crisis:matched'),
          b.waitFor('crisis:matched'),
        ]);
        expect(ma.duelId).toBe(mb.duelId);
        await Promise.all([a.waitFor('crisis:countdown'), b.waitFor('crisis:countdown')]);
        await Promise.all([a.waitFor('crisis:started'), b.waitFor('crisis:started')]);
        const active = await u1.agent.get('/api/v1/crisis/active').expect(HttpStatus.OK);
        expect(okBody<any>(active).data.duelId).toBe(ma.duelId);
        expect(okBody<any>(active).data.type).toBe('CRISIS');
        expect(okBody<any>(active).data.crashFired).toBe(false);
        const state = await u1.agent.get(`/api/v1/crisis/${ma.duelId}/state`).expect(HttpStatus.OK);
        expect(okBody<any>(state).data.myPortfolio.cash).toBe('100000.00');
        expect(okBody<any>(state).data.myPortfolio.holdings).toHaveLength(0);
        expect(okBody<any>(state).data.opponentEquity).toBe('100000.00');
        expect(okBody<any>(state).data).not.toHaveProperty('opponentHoldings');

        // Leaving mid-crisis forfeits; the opponent's result is not mine to read.
        await a.emit('crisis:leave-duel', { duelId: ma.duelId });
        const [fa, fb] = await Promise.all([
          a.waitFor('crisis:finished', 15000),
          b.waitFor('crisis:finished', 15000),
        ]);
        expect(fa.result).toBe('LOSS');
        expect(fb.result).toBe('WIN');
        expect(fa.forfeitedBy).toBe(u1.userId);
        const others = await u2.agent
          .get(`/api/v1/crisis/${ma.duelId}/result`)
          .expect(HttpStatus.OK);
        expect(okBody<any>(others).data.result).toBe('WIN');
        const u3 = await registerLogin(server, 'crisis-rest-3@example.com');
        await u3.agent.get(`/api/v1/crisis/${ma.duelId}/result`).expect(HttpStatus.FORBIDDEN);
      } finally {
        a.disconnect();
        b.disconnect();
      }
    }, 60000);

    it('crisis socket without a token is disconnected', async () => {
      const client = await connectCrisis();
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('socket stayed connected')), 5000);
          client.socket.on('disconnect', () => {
            clearTimeout(timer);
            resolve();
          });
        });
      } finally {
        client.disconnect();
      }
    }, 30000);
  });

  // --- Weekly Portfolio Battle (T3) + Leagues (docs/16, Phase 11) --------------

  describe('weekly portfolio battle', () => {
    const tradingRating = async (
      agent: Agent
    ): Promise<{ rating: number; gamesPlayed: number }> => {
      const res = await agent.get('/api/v1/ratings/me').expect(HttpStatus.OK);
      return okBody<any>(res).data.trading as { rating: number; gamesPlayed: number };
    };

    const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

    it('full cycle: create → join → trade → end → settle → Rating moves + promotion/relegation, re-settle replays', async () => {
      const admin = await registerLogin(server, 'weekly-admin@example.com', {
        roles: ['ADMIN'],
      });
      const u1 = await registerLogin(server, 'weekly-1@example.com');
      const u2 = await registerLogin(server, 'weekly-2@example.com');
      const u3 = await registerLogin(server, 'weekly-3@example.com');
      const u4 = await registerLogin(server, 'weekly-4@example.com');

      // Only ADMIN can create a season.
      await u1.agent
        .post('/api/v1/weekly/seasons')
        .send({ weekStart: '2026-11-09' })
        .expect(HttpStatus.FORBIDDEN);

      const created = await admin.agent
        .post('/api/v1/weekly/seasons')
        .send({ weekStart: '2026-11-09' })
        .expect(HttpStatus.CREATED);
      const seasonId = okBody<any>(created).data.id as string;
      expect(okBody<any>(created).data.status).toBe('OPEN');
      expect(okBody<any>(created).data.host.name).toBe('Anaya');

      // Joining twice is a duplicate; trading before the start is not started.
      await u1.agent.post(`/api/v1/weekly/seasons/${seasonId}/join`).expect(HttpStatus.CREATED);
      await u1.agent.post(`/api/v1/weekly/seasons/${seasonId}/join`).expect(HttpStatus.CONFLICT);
      await u2.agent.post(`/api/v1/weekly/seasons/${seasonId}/join`).expect(HttpStatus.CREATED);
      await u3.agent.post(`/api/v1/weekly/seasons/${seasonId}/join`).expect(HttpStatus.CREATED);
      await u4.agent.post(`/api/v1/weekly/seasons/${seasonId}/join`).expect(HttpStatus.CREATED);
      await u1.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/trade`)
        .send({ instrumentId: uuidv4(), side: 'BUY', quantity: 1, clientOrderId: uuidv4() })
        .expect(HttpStatus.CONFLICT);

      const started = await admin.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/start`)
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(started).data.season.status).toBe('ACTIVE');
      expect(okBody<any>(started).data.leagues).toHaveLength(1);
      expect(okBody<any>(started).data.carriedUserIds).toEqual([]);

      // Joining after the start is closed.
      const late = await registerLogin(server, 'weekly-late@example.com');
      await late.agent.post(`/api/v1/weekly/seasons/${seasonId}/join`).expect(HttpStatus.CONFLICT);

      // Instruments come from the simulator seed (NVLT first).
      const portfolio0 = await u1.agent
        .get(`/api/v1/weekly/seasons/${seasonId}/portfolio`)
        .expect(HttpStatus.OK);
      const nvlt = okBody<any>(portfolio0).data.prices.find((p: any) => p.symbol === 'NVLT');
      const kvrf = okBody<any>(portfolio0).data.prices.find((p: any) => p.symbol === 'KVRF');
      expect(nvlt).toBeDefined();
      expect(kvrf).toBeDefined();
      expect(okBody<any>(portfolio0).data.cash).toBe('100000.00');

      // U1–U3 trade 3 times each; U4 never trades. A retried
      // clientOrderId replays, never double-applies.
      const traders = [u1, u2, u3];
      for (const u of traders) {
        const buy = await u.agent
          .post(`/api/v1/weekly/seasons/${seasonId}/trade`)
          .send({
            instrumentId: nvlt.instrumentId,
            side: 'BUY',
            quantity: 10,
            clientOrderId: uuidv4(),
          })
          .expect(HttpStatus.CREATED);
        expect(Number(okBody<any>(buy).data.portfolio.cash)).toBeLessThan(100000);
        await u.agent
          .post(`/api/v1/weekly/seasons/${seasonId}/trade`)
          .send({
            instrumentId: kvrf.instrumentId,
            side: 'BUY',
            quantity: 10,
            clientOrderId: uuidv4(),
          })
          .expect(HttpStatus.CREATED);
        await u.agent
          .post(`/api/v1/weekly/seasons/${seasonId}/trade`)
          .send({
            instrumentId: nvlt.instrumentId,
            side: 'SELL',
            quantity: 5,
            clientOrderId: uuidv4(),
          })
          .expect(HttpStatus.CREATED);
      }
      const replayId = uuidv4();
      const first = await u1.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/trade`)
        .send({
          instrumentId: kvrf.instrumentId,
          side: 'BUY',
          quantity: 1,
          clientOrderId: replayId,
        })
        .expect(HttpStatus.CREATED);
      const replay = await u1.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/trade`)
        .send({
          instrumentId: kvrf.instrumentId,
          side: 'BUY',
          quantity: 1,
          clientOrderId: replayId,
        })
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(replay).data.id).toBe(okBody<any>(first).data.id);

      // Order validation: unknown instrument, no holdings, no funds.
      await u1.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/trade`)
        .send({ instrumentId: uuidv4(), side: 'BUY', quantity: 1, clientOrderId: uuidv4() })
        .expect(HttpStatus.BAD_REQUEST);
      await u4.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/trade`)
        .send({
          instrumentId: nvlt.instrumentId,
          side: 'SELL',
          quantity: 1,
          clientOrderId: uuidv4(),
        })
        .expect(HttpStatus.CONFLICT);
      await u1.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/trade`)
        .send({
          instrumentId: nvlt.instrumentId,
          side: 'BUY',
          quantity: 100000,
          clientOrderId: uuidv4(),
        })
        .expect(HttpStatus.CONFLICT);

      // Live standings: totals only, promotion/relegation zones flagged.
      const standings = await u1.agent
        .get(`/api/v1/weekly/seasons/${seasonId}/standings`)
        .expect(HttpStatus.OK);
      const entries = okBody<any>(standings).data.leagues[0].entries as any[];
      expect(entries).toHaveLength(4);
      expect(entries[0].promotionZone).toBe(true);
      expect(entries[3].relegationZone).toBe(true);
      expect(entries[3].userId).toBe(u4.userId); // never-traded ranks last
      expect(JSON.stringify(standings.body)).not.toContain('holdings');
      expect(JSON.stringify(standings.body)).not.toContain('clientOrderId');

      // My portfolio shows my holdings only.
      const mine = await u1.agent
        .get(`/api/v1/weekly/seasons/${seasonId}/portfolio`)
        .expect(HttpStatus.OK);
      expect(okBody<any>(mine).data.holdings).toHaveLength(2);

      // Settling before the season ends is refused.
      await admin.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/settle`)
        .expect(HttpStatus.CONFLICT);

      // The 15 s test season ends; settle.
      await sleep(16000);
      const settled = await admin.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/settle`)
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(settled).data.status).toBe('SETTLED');
      expect(okBody<any>(settled).data.leaguesSettled).toBe(1);
      expect(okBody<any>(settled).data.playersSettled).toBe(4);
      expect(typeof okBody<any>(settled).data.indexReturnPct).toBe('number');

      // Traders: rated (3+ trades, draw vs the index — prices barely
      // move in 15 s, so returns stay within ±2%). 1000 vs 1200,
      // provisional K=40: 40 × (0.5 − 0.24) = +10.4. U1 made one extra
      // trade in the replay check above, so their count is 4.
      const expectedTrades = new Map([
        [u1.userId, 4],
        [u2.userId, 3],
        [u3.userId, 3],
      ]);
      for (const u of traders) {
        const res = await u.agent
          .get(`/api/v1/weekly/seasons/${seasonId}/result`)
          .expect(HttpStatus.OK);
        const data = okBody<any>(res).data;
        expect(data.tradeCount).toBe(expectedTrades.get(u.userId));
        expect(data.ratingDelta).toBe(10.4);
        expect(data.ratingBefore).toBe(1000);
        expect(data.ratingAfter).toBe(1010.4);
        expect(data.ratingResult).toBe('DRAW');
        expect(data.ratingReason).toContain('within 2% of the simulated index');
        const after = await tradingRating(u.agent);
        expect(after.gamesPlayed).toBe(1);
        expect(after.rating).toBe(1010.4);
      }
      // Ranks follow join order on identical trades: u1 #1 (20 XP),
      // u2 #2 (5 XP), u3 #3 (5 XP) in this 4-player league.
      const r1 = okBody<any>(
        await u1.agent.get(`/api/v1/weekly/seasons/${seasonId}/result`).expect(HttpStatus.OK)
      ).data;
      const r2 = okBody<any>(
        await u2.agent.get(`/api/v1/weekly/seasons/${seasonId}/result`).expect(HttpStatus.OK)
      ).data;
      const r3 = okBody<any>(
        await u3.agent.get(`/api/v1/weekly/seasons/${seasonId}/result`).expect(HttpStatus.OK)
      ).data;
      expect(r1.rank).toBe(1);
      expect(r1.xp.awarded).toBe(20);
      expect(r2.rank).toBe(2);
      expect(r2.xp.awarded).toBe(5);
      expect(r3.rank).toBe(3);
      expect(r3.xp.awarded).toBe(5);

      // Never-traded: rank last, unrated, 0 XP, demoted to tier 2.
      const r4 = okBody<any>(
        await u4.agent.get(`/api/v1/weekly/seasons/${seasonId}/result`).expect(HttpStatus.OK)
      ).data;
      expect(r4.rank).toBe(4);
      expect(r4.tradeCount).toBe(0);
      expect(r4.ratingBefore).toBeNull();
      expect(r4.ratingDelta).toBeNull();
      expect(r4.ratingResult).toBeNull();
      expect(r4.ratingReason).toContain('fewer than 3');
      expect(r4.xp.awarded).toBe(0);
      expect(r4.nextTier).toBe(2);
      const after4 = await tradingRating(u4.agent);
      expect(after4.gamesPlayed).toBe(0);
      expect(after4.rating).toBe(1000);

      // Re-settle replays the stored results: no second Rating call.
      const replayed = await admin.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/settle`)
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(replayed).data.status).toBe('SETTLED');
      expect(okBody<any>(replayed).data.playersSettled).toBe(4);
      expect((await tradingRating(u1.agent)).gamesPlayed).toBe(1);

      // History lists the season; standings now return stored results.
      const history = await u1.agent.get('/api/v1/weekly/history').expect(HttpStatus.OK);
      expect(okBody<any>(history).data.items).toHaveLength(1);
      expect(okBody<any>(history).data.items[0].seasonId).toBe(seasonId);
      const standingsAfter = await u1.agent
        .get(`/api/v1/weekly/seasons/${seasonId}/standings`)
        .expect(HttpStatus.OK);
      expect(okBody<any>(standingsAfter).data.leagues[0].entries).toHaveLength(4);
      expect(okBody<any>(standingsAfter).data.leagues[0].entries[0].rank).toBe(1);
    }, 90000);

    it('weekly validation: non-Monday, duplicate week, non-admin settle, open-season settle', async () => {
      const admin = await registerLogin(server, 'weekly-val-admin@example.com', {
        roles: ['ADMIN'],
      });
      const learner = await registerLogin(server, 'weekly-val-learner@example.com');

      await admin.agent
        .post('/api/v1/weekly/seasons')
        .send({ weekStart: '2026-11-10' })
        .expect(HttpStatus.BAD_REQUEST);
      const created = await admin.agent
        .post('/api/v1/weekly/seasons')
        .send({ weekStart: '2026-11-16' })
        .expect(HttpStatus.CREATED);
      const seasonId = okBody<any>(created).data.id as string;
      await admin.agent
        .post('/api/v1/weekly/seasons')
        .send({ weekStart: '2026-11-16' })
        .expect(HttpStatus.CONFLICT);

      // Non-admin cannot settle; settling an OPEN season is not started.
      await learner.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/settle`)
        .expect(HttpStatus.FORBIDDEN);
      await admin.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/settle`)
        .expect(HttpStatus.CONFLICT);
      // Unknown season / standings before start.
      await learner.agent
        .post('/api/v1/weekly/seasons/00000000-0000-4000-8000-000000000000/join')
        .expect(HttpStatus.NOT_FOUND);
      await learner.agent
        .get(`/api/v1/weekly/seasons/${seasonId}/standings`)
        .expect(HttpStatus.CONFLICT);
    }, 30000);

    it('a lone joiner is carried and auto-enrolled in the next season', async () => {
      const admin = await registerLogin(server, 'weekly-carry-admin@example.com', {
        roles: ['ADMIN'],
      });
      const solo = await registerLogin(server, 'weekly-solo@example.com');
      const created = await admin.agent
        .post('/api/v1/weekly/seasons')
        .send({ weekStart: '2026-11-23' })
        .expect(HttpStatus.CREATED);
      const seasonId = okBody<any>(created).data.id as string;
      await solo.agent.post(`/api/v1/weekly/seasons/${seasonId}/join`).expect(HttpStatus.CREATED);
      const started = await admin.agent
        .post(`/api/v1/weekly/seasons/${seasonId}/start`)
        .expect(HttpStatus.CREATED);
      expect(okBody<any>(started).data.leagues).toEqual([]);
      expect(okBody<any>(started).data.carriedUserIds).toEqual([solo.userId]);

      // The next season enrols the carried joiner automatically.
      const next = await admin.agent
        .post('/api/v1/weekly/seasons')
        .send({ weekStart: '2026-11-30' })
        .expect(HttpStatus.CREATED);
      const nextId = okBody<any>(next).data.id as string;
      const view = await admin.agent.get(`/api/v1/weekly/seasons/${nextId}`).expect(HttpStatus.OK);
      expect(okBody<any>(view).data.memberCount).toBe(1);
      // …and they cannot join twice.
      await solo.agent.post(`/api/v1/weekly/seasons/${nextId}/join`).expect(HttpStatus.CONFLICT);
    }, 30000);
  });

  // --- pipeline ------------------------------------------------------------------

  describe('pipeline', () => {
    it('every response carries the envelope + request id', async () => {
      const res = await request(server).get('/api/v1/users/me').expect(HttpStatus.UNAUTHORIZED);
      const body = errBody(res);
      expect(body.success).toBe(false);
      expect(body.error.code).toBeDefined();
      expect(body.requestId).toBeDefined();
      expect(res.headers['x-request-id']).toBe(body.requestId);
    });

    it('unknown routes return the 404 envelope', async () => {
      const res = await request(server).get('/api/v1/nope').expect(HttpStatus.NOT_FOUND);
      expect(errBody(res).error.code).toBe(ErrorCode.NOT_FOUND);
    });
  });
});
