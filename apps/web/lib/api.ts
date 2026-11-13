'use client';

/**
 * Typed API client for the Candle API (blueprint §6/§7).
 *
 * - Base URL from NEXT_PUBLIC_API_URL (public, non-secret).
 * - Sends the Bearer access token when provided.
 * - `credentials: 'include'` so the httpOnly refresh cookie flows.
 * - Idempotency-Key header for payments-like endpoints (complete/submit).
 * - Unwraps the standard envelope; throws ApiClientError on failure.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Base URL of the Candle API (public, non-secret) — also the Socket.IO origin. */
export { API_URL };

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message || `Request failed (${status})`);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = body.code;
    this.details = body.details;
    this.requestId = body.requestId;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string | null;
  idempotencyKey?: string;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    credentials: 'include',
  });

  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiClientError(res.status, {
      code: 'UNKNOWN',
      message: `Request failed with status ${res.status}`,
      requestId: 'unknown',
    });
  }

  const body = json as { success: boolean; data?: T; error?: ApiErrorBody; requestId: string };
  if (!res.ok || !body.success) {
    throw new ApiClientError(
      res.status,
      body.error ?? {
        code: 'UNKNOWN',
        message: 'Request failed',
        requestId: body.requestId ?? 'unknown',
      }
    );
  }
  return body.data as T;
}

/** Client-generated idempotency keys for complete/submit (blueprint §6). */
export function newIdempotencyKey(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// --- DTO shapes (mirror the API responses) ---------------------------------------

export interface PublicUser {
  id: string;
  email: string;
  displayName: string | null;
  roles: string[];
}

export interface TrackSummary {
  id: string;
  slug: string;
  title: string;
  description: string;
}

export interface LessonNode {
  id: string;
  title: string;
  order: number;
  published: { id: string; version: number; title: string; questionCount: number } | null;
  completed?: boolean;
  locked?: boolean;
}

export interface TrackDetail extends TrackSummary {
  modules: Array<{
    id: string;
    title: string;
    description: string | null;
    order: number;
    lessons: LessonNode[];
  }>;
  totalLessons: number;
  completedLessons: number;
}

export interface LessonDetail {
  id: string;
  title: string;
  order: number;
  moduleId: string;
  moduleTitle: string;
  trackId: string;
  trackSlug: string;
  version: number;
  contentMarkdown: string;
  disclaimer: string;
  questionCount: number;
  completed: boolean;
  locked: boolean;
}

export interface QuizQuestionView {
  id: string;
  text: string;
  kind: 'SINGLE' | 'MULTI';
  order: number;
  points: number;
  options: Array<{ id: string; text: string; order: number }>;
}

export interface AttemptView {
  attemptId: string;
  lessonId: string;
  questions: QuizQuestionView[];
}

export interface QuestionFeedback {
  questionId: string;
  correct: boolean;
  selectedOptionIds: string[];
  correctOptionIds: string[];
  explanation: string;
  pointsAwarded: number;
}

export interface RewardSummary {
  xpAwarded: number;
  totalXp: number;
  level: number;
  levelUp: boolean;
  currentStreak: number;
  longestStreak: number;
  newBadges: Array<{ id: string; slug: string; name: string; description: string }>;
  applied: boolean;
}

export interface SubmitResponse {
  attemptId: string;
  score: number;
  totalPoints: number;
  passed: boolean;
  feedback: QuestionFeedback[];
  rewards: RewardSummary;
}

export interface CompletionResponse {
  completion: { id: string; lessonId: string; completedAt: string };
  rewards: RewardSummary;
}

export interface Dashboard {
  stats: {
    totalXp: number;
    level: number;
    currentStreak: number;
    longestStreak: number;
    xpToNextLevel: number | null;
  };
  badges: Array<{ id: string; slug: string; name: string; description: string; awardedAt: string }>;
  tracks: Array<TrackSummary & { totalLessons: number; completedLessons: number }>;
}

/** Simulator — virtual-money trading (blueprint §17, ADR 0003). */

export interface InstrumentQuote {
  id: string;
  symbol: string;
  name: string;
  description: string;
  price: string;
}

export interface HoldingView {
  instrumentId: string;
  symbol: string;
  name: string;
  quantity: string;
  avgCost: string;
  currentPrice: string;
  marketValue: string;
  unrealizedPnl: string;
}

export interface PortfolioView {
  cash: string;
  totalEquity: string;
  holdings: HoldingView[];
}

export interface OrderView {
  id: string;
  instrumentId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  totalValue: string;
  executedAt: string;
}

export interface PlaceOrderResponse {
  order: OrderView;
  rewards: RewardSummary;
}

export interface OrderHistory {
  items: OrderView[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

// --- Onboarding assessment (docs/03-onboarding-assessment-design.md) ---------------

export interface AssessmentQuestionView {
  id: string;
  text: string;
  kind: 'SINGLE' | 'MULTI';
  order: number;
  options: Array<{ id: string; text: string; order: number }>;
}

export interface AssessmentAttemptView {
  attemptId: string;
  version: number;
  questions: AssessmentQuestionView[];
}

export interface TopicLevelView {
  topicKey: string;
  level: number;
  label: string;
}

export interface AssessmentResultView {
  attemptId: string;
  topics: TopicLevelView[];
  overallLevel: number;
  placement: { kind: 'START_HERE' | 'FAST_TRACK'; recommendedStartModuleOrder: number };
  submittedAt: string;
}

export interface KnowledgeProfile {
  versionId: string;
  attemptId: string;
  topicLevels: unknown;
  overallLevel: number;
  computedAt: string;
}

export interface AcceptPlacementResponse {
  placementChoice: 'RECOMMENDED' | 'FROM_BEGINNING';
  waivedUpToModuleOrder: number | null;
  rewards: RewardSummary;
}

// --- Duels Step 2 (docs/07-phase-4-duels-step-2.md) -------------------------------

export interface DuelQuestionView {
  id: string;
  stem: string;
  options: Array<{ id: string; text: string; order: number; consequence?: string | null }>;
  type: string;
  topic: string;
  skill: string;
  difficulty: number;
  /** CASE_CHOICE only: labelled case numbers, shown as a small table. */
  context?: Record<string, string | number> | null;
  /** CHART_CHOICE only: chart data WITHOUT the reveal-only annotation. */
  chart?: {
    title: string;
    instrument: string;
    template: string;
    xLabel: string;
    yLabel: string;
    xLabels: string[];
    series: number[];
  } | null;
}

export interface DuelStartResponse {
  duelId: string;
  type: 'BOT' | 'DAILY';
  date: string | null;
  questions: DuelQuestionView[];
  opponent: { name: string; kind: 'BOT' | 'HUMAN'; baseAccuracy?: number };
  startedAt: string;
}

export interface DuelAnswerResponse {
  duelId: string;
  questionId: string;
  answeredCount: number;
  totalQuestions: number;
  nextQuestionId: string | null;
}

export interface DuelWaitingResponse {
  duelId: string;
  type: 'DAILY';
  status: 'WAITING_OPPONENT';
  myScore: number;
  myCorrect: number;
  myTotalTimeMs: number;
  totalQuestions: number;
  message: string;
}

export interface DuelPerTopic {
  topic: string;
  correct: number;
  total: number;
  accuracy: number;
}

export interface DuelPerQuestion {
  questionId: string;
  stem: string;
  topic: string;
  skill: string;
  difficulty: number;
  selectedOptionId: string | null;
  selectedOptionText: string | null;
  correctOptionId: string;
  correctOptionText: string;
  correct: boolean;
  skipped: boolean;
  timeMs: number | null;
  points: number;
  explanation: string;
  /** CASE_CHOICE only: the rubric that graded this case, line by line. */
  rubric?: string | null;
  /** CHART_CHOICE only: the chart (public part, no annotation) so the
   * result screen can draw it. */
  chart?: {
    title: string;
    instrument: string;
    template: string;
    xLabel: string;
    yLabel: string;
    xLabels: string[];
    series: number[];
  } | null;
  /** CHART_CHOICE only: the reveal annotation (trend + highlighted zone). */
  annotation?: {
    trend: 'rising' | 'falling' | 'flat' | 'volatile';
    zoneStart: number;
    zoneEnd: number;
  } | null;
}

export interface DuelResultResponse {
  duelId: string;
  type: 'BOT' | 'DAILY' | 'LIVE' | 'BLITZ' | 'CASE' | 'CHART';
  status: 'SETTLED';
  result: 'WIN' | 'DRAW' | 'LOSS';
  score: number;
  opponent: { name: string; kind: 'BOT' | 'HUMAN'; score: number | null; correct: number | null };
  correct: number;
  wrong: number;
  skipped: number;
  accuracy: number;
  avgTimeMs: number | null;
  fastestTimeMs: number | null;
  slowestTimeMs: number | null;
  bestStreak: number;
  perTopic: DuelPerTopic[];
  perQuestion: DuelPerQuestion[];
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingReason: string;
  xp: {
    awarded: number;
    totalXp: number;
    level: number;
    levelUp: boolean;
    currentStreak: number;
    newBadges: Array<{ slug: string; name: string }>;
  };
  finishedAt: string | null;
}

export interface DailyTodayResponse {
  date: string;
  questionCount: number;
  setReady: boolean;
  myDuel: { duelId: string; status: string } | null;
}

export interface DuelHistoryItem {
  duelId: string;
  type: 'BOT' | 'DAILY' | 'LIVE' | 'BLITZ' | 'CASE' | 'CHART';
  status: string;
  date: string | null;
  startedAt: string;
  finishedAt: string | null;
  result: 'WIN' | 'DRAW' | 'LOSS' | null;
  myScore: number | null;
  opponentScore: number | null;
  opponentName: string | null;
  ratingDelta: number | null;
}

// --- Paper Trading Sprint (docs/14-phase-9-paper-trading-sprint.md) -----------------

export interface SprintInstrumentView {
  id: string;
  symbol: string;
  name: string;
  price: string;
}

export interface SprintHoldingView {
  instrumentId: string;
  symbol: string;
  name: string;
  quantity: string;
  avgCost: string;
  currentPrice: string;
  marketValue: string;
  unrealizedPnl: string;
}

export interface SprintPortfolioView {
  cash: string;
  totalEquity: string;
  holdings: SprintHoldingView[];
}

export interface SprintMatchedPayload {
  duelId: string;
  opponent: { userId: string; displayName: string; rating: number; kind: 'HUMAN' | 'BOT' };
  host: { name: string; line: string };
  startingCash: string;
  instruments: Array<{ id: string; symbol: string; name: string }>;
  countdownEndsAtMs: number;
  serverNowMs: number;
}

export interface SprintStartedPayload {
  duelId: string;
  instruments: SprintInstrumentView[];
  cash: string;
  portfolio: SprintPortfolioView;
  startedAtMs: number | null;
  endsAtMs: number | null;
  serverNowMs: number;
}

export interface SprintTickPayload {
  duelId: string;
  serverNowMs: number;
  endsAtMs: number | null;
  prices: Array<{ instrumentId: string; symbol: string; price: string }>;
  equities: Record<string, { userId: string; equity: string }>;
  /** Crisis Duel only (docs/15): true once the seeded crash has fired. */
  crashFired?: boolean;
  /** Crisis Duel only: when the crash fired (server ms), or null. */
  crashFiredAtMs?: number | null;
}

export interface SprintPerInstrumentView {
  instrumentId: string;
  symbol: string;
  trades: number;
  buyQty: number;
  sellQty: number;
  realisedPnl: number;
  finalQty: number;
  finalValue: number;
}

export interface SprintResultResponse {
  duelId: string;
  type: 'SPRINT' | 'CRISIS';
  status: 'SETTLED';
  result: 'WIN' | 'DRAW' | 'LOSS';
  finalEquity: string;
  returnPct: number;
  realisedVolPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
  tradeCount: number;
  perInstrument: SprintPerInstrumentView[];
  equityCurve: Array<{ t: number; equity: string }>;
  opponent: {
    name: string;
    kind: 'HUMAN' | 'BOT';
    riskAdjustedScore: number;
    finalEquity: string | null;
    tradeCount: number;
  };
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingReason: string;
  xp: {
    awarded: number;
    totalXp: number;
    level: number;
    levelUp: boolean;
    currentStreak: number;
    newBadges: Array<{ slug: string; name: string }>;
  };
  finishedAt: string | null;
  host?: { name: string; line: string };
  forfeitedBy?: string | null;
  /** Crisis Duel only (docs/15 §5/§8): the crash that hit this duel, in plain words. */
  crisis?: {
    crashMinute: number;
    crashDrawdownPct: number;
    tradesDuringCrash: number;
    panicSold: boolean;
    crashLine: string;
  };
}

export interface SprintHistoryItem {
  duelId: string;
  type: 'SPRINT' | 'CRISIS';
  status: 'SETTLED';
  startedAt: string;
  finishedAt: string | null;
  result: 'WIN' | 'DRAW' | 'LOSS';
  finalEquity: string;
  returnPct: number;
  riskAdjustedScore: number;
  opponentName: string | null;
  opponentRiskScore: number;
  ratingDelta: number | null;
}

export interface SprintQueueStatus {
  queued: boolean;
  userId: string | null;
  rating: number | null;
  joinedAtMs: number | null;
  waitedMs: number;
  ratingWindow: number;
  botOfferDue: boolean;
}

export interface SprintActiveSummary {
  duelId: string;
  type: 'SPRINT' | 'CRISIS';
  phase: string;
  startedAtMs: number | null;
  endsAtMs: number | null;
  serverNowMs: number;
  myEquity: string;
  opponentEquity: string | null;
  opponent: { userId: string; displayName: string; kind: 'HUMAN' | 'BOT' } | null;
  /** Crisis Duel only (docs/15): true once the seeded crash has fired. */
  crashFired?: boolean;
}

// --- Weekly Portfolio Battle (docs/16-phase-11-weekly-portfolio-battle.md) --------

export interface WeeklySeasonView {
  id: string;
  weekStart: string;
  status: 'OPEN' | 'ACTIVE' | 'SETTLED';
  scheduledStartsAt: string;
  scheduledEndsAt: string;
  startedAt: string | null;
  endsAt: string | null;
  indexReturnPct: number | null;
  leagueCount: number;
  memberCount: number;
  host: { name: string; role: string };
}

export interface WeeklyStandingEntry {
  rank: number;
  userId: string;
  displayName: string | null;
  returnPct: number;
  riskAdjustedScore: number;
  tradeCount: number;
  promotionZone: boolean;
  relegationZone: boolean;
}

export interface WeeklyStandingsResponse {
  seasonId: string;
  weekStart: string;
  status: 'OPEN' | 'ACTIVE' | 'SETTLED';
  endsAt: string | null;
  leagues: Array<{
    leagueId: string;
    tier: number;
    leagueNumber: number;
    entries: WeeklyStandingEntry[];
  }>;
}

export interface WeeklyHoldingView {
  instrumentId: string;
  symbol: string;
  name: string;
  quantity: number;
  avgCost: string;
  currentPrice: string;
  marketValue: string;
  unrealizedPnl: string;
}

export interface WeeklyPortfolioView {
  seasonId: string;
  cash: string;
  totalEquity: string;
  holdings: WeeklyHoldingView[];
  prices: Array<{ instrumentId: string; symbol: string; price: string }>;
}

export interface WeeklyTradeResponse {
  id: string;
  seasonId: string;
  leagueId: string;
  instrumentId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: string;
  price: string;
  totalValue: string;
  clientOrderId: string;
  executedAt: string;
  portfolio: WeeklyPortfolioView;
}

export interface WeeklyResultResponse {
  seasonId: string;
  weekStart: string;
  leagueId: string;
  tier: number;
  leagueNumber: number;
  rank: number;
  leagueSize: number;
  nextTier: number;
  result: 'WIN' | 'DRAW' | 'LOSS';
  finalEquity: string;
  returnPct: number;
  realisedVolPct: number;
  maxDrawdownPct: number;
  riskAdjustedScore: number;
  tradeCount: number;
  perInstrument: SprintPerInstrumentView[];
  equityCurve: Array<{ t: number; equity: string }>;
  ratingBefore: number | null;
  ratingAfter: number | null;
  ratingDelta: number | null;
  ratingResult: 'WIN' | 'DRAW' | 'LOSS' | null;
  ratingReason: string;
  xp: {
    awarded: number;
    totalXp: number;
    level: number;
    levelUp: boolean;
    currentStreak: number;
    newBadges: Array<{ slug: string; name: string }>;
  };
  settledAt: string;
}

export interface WeeklySettlementResponse {
  seasonId: string;
  weekStart: string;
  status: 'SETTLED';
  indexReturnPct: number;
  leaguesSettled: number;
  playersSettled: number;
  host: { name: string; line: string };
}

export interface WeeklyHistoryItem {
  seasonId: string;
  weekStart: string;
  leagueId: string;
  tier: number;
  leagueNumber: number;
  rank: number;
  leagueSize: number;
  nextTier: number;
  result: 'WIN' | 'DRAW' | 'LOSS';
  finalEquity: string;
  returnPct: number;
  riskAdjustedScore: number;
  ratingDelta: number | null;
  xpAwarded: number;
  settledAt: string;
}
