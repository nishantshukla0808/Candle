# Candle — Ratings (not ELO) and Cloudflare Deployment

**Date:** 2026-11-11
**Status:** DESIGN PROPOSAL — not built yet, needs Nishu's approval
**Naming rule from 2026-11-11:** Never call it ELO in the product, docs,
or UI. The public name is **Ratings**. Internally the update math is
ELO-inspired, but users only ever see "Candle Rating", "Learning Rating",
"Trading Rating", tiers, rank, and percentile.

---

## Part A — Cloudflare: yes, free for part of Candle, not for all of it

### Short answer

Yes for the frontend, DNS, CDN, and security. No for the NestJS API,
PostgreSQL, and Redis as they are built today. Cloudflare cannot run
that backend for free without a rewrite, so the honest free plan is a
split deployment.

### What Cloudflare Free actually gives

Checked against Cloudflare's published limits in Nov 2026 (verify again
before launch, limits change):

- **Pages / Workers static hosting:** static asset requests and bandwidth
  are free and unlimited. Pages Free includes 500 builds/month, 1 build
  at a time, 20-minute build timeout, 20,000 files per site, 25 MiB per
  file, 100 custom domains per project.
- **Dynamic requests (Workers / Pages Functions):** 100,000 requests/day,
  10 ms CPU time per invocation, 128 MB memory per isolate, 50 subrequests
  per invocation. Past that, dynamic requests fail.
- **Workers Paid (the first paid step):** $5/month minimum, 10,000,000
  requests/month included, then $0.30 per extra million; CPU rises to
  30 seconds per invocation by default.
- **Cloudflare now recommends Workers, not Pages, for new full-stack
  projects.** Next.js on Cloudflare runs through an adapter (vinext by
  default, OpenNext for existing apps). A static Next.js export can stay
  on Pages; server-rendered Next.js runs on Workers and counts against
  the Workers limits above.

### Why the NestJS backend cannot move to Cloudflare Free as-is

1. NestJS is a long-lived Node.js server. Workers are short-lived,
   stateless isolates with a 10 ms CPU budget on Free.
2. Prisma + PostgreSQL needs persistent TCP connections and
   transactions. Cloudflare's own database (D1) is SQLite, not
   PostgreSQL — moving to it would mean rewriting the data layer
   and breaking the blueprint's "own PostgreSQL" decision.
3. Redis (rate limits, queues, leaderboards) has no direct equivalent
   in the free Cloudflare stack that matches the current design.
4. File uploads, auth refresh rotation, and long jobs do not fit the
   10 ms / 128 MB Worker limits.

Rewriting the backend for Workers would be a different product and
would break the production architecture already built and tested in
Phases 0–2. Do not do that for a free tier.

### Recommended deployment (free where it is safe, cheap where it matters)

| Part                                     | Where                                                                                                           | Cost                                                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| DNS, CDN, WAF, free SSL, DDoS protection | Cloudflare (free plan)                                                                                          | $0                                                                                                                                  |
| Web frontend (Next.js)                   | Cloudflare Workers / Pages, static + SSR where it fits                                                          | $0 on Free, $5/mo Workers Paid when SSR traffic grows                                                                               |
| API (NestJS), PostgreSQL, Redis          | One small VPS / container host running the existing `docker compose` stack, unchanged                           | ~$5/mo VPS, or a container host free tier if verified at deploy time (free tiers sleep / expire, so do not rely on them for launch) |
| File storage                             | Cloudflare R2 (S3-compatible, 10 GB free tier) via the existing `StorageService` abstraction, later — not in v1 | $0 to start                                                                                                                         |
| Domain                                   | Cloudflare Registrar or any registrar, pointed at Cloudflare DNS                                                | Domain cost only                                                                                                                    |

This keeps the exact system that already runs on Nishu's PC
(`docker compose up --build`) and puts Cloudflare in front of it
for speed and protection. The API is not rewritten, the database is
not changed, and the free part stays free.

**Not recommended:** Cloudflare Tunnel from a home PC as production,
Vercel Hobby for a commercial product (non-commercial only), or a
"free" container host that sleeps the API after inactivity.

---

## Part B — Ratings: the algorithm

### 1. One name, three ratings

A single blended score would lie: a great quiz player is not
automatically a great trader. So Candle keeps separate ratings:

- **Learning Rating** — quizzes, lessons, and learning duels.
- **Trading Rating** — simulator performance over a fixed season.
- **Candle Rating** — the headline number, a weighted mix, shown
  only with its two parts beside it.

Weights (proposal, Phase 3): Candle Rating = 0.5 × Learning +
0.5 × Trading. Weights live in config, not in code, so they can be
tuned without a redeploy of the formula.

### 2. Starting point, tiers, and ranks

- Every new user starts at **1000** in each rating.
- Ratings are integers in the product (stored with 1 decimal internally,
  displayed rounded).
- **Provisional:** the first 10 rated events in a rating. The rating
  is shown with a "Provisional" badge and moves faster (see K below).
  Provisional users appear on leaderboards, but cannot hold a season
  title.
- **Tiers (same bands for Learning and Trading):**
  Bronze < 1100 · Silver 1100–1299 · Gold 1300–1499 ·
  Platinum 1500–1699 · Diamond 1700–1899 · Master 1900+
  Tier names are display only; the number is the truth.
- **Floor:** no rating goes below 100. No rating is ever reset to 1000
  in one jump (see seasons).

### 3. The update formula (one formula for every rated event)

For a rated event between user A (rating Ra) and opponent B (rating Rb):

```
Expected score for A:
  Ea = 1 / (1 + 10 ^ ((Rb - Ra) / 400))

Actual score for A:
  Sa = 1 for a win, 0.5 for a draw, 0 for a loss

New rating for A:
  Ra' = Ra + K × (Sa - Ea)
```

The same formula, mirrored, updates B. Points gained by one side are
exactly the points lost by the other, so ratings cannot inflate by
farming alone.

**Why 400:** a 400-point gap means the stronger side is expected to
score about 91% (10:1 odds). A 200-point gap means about 76%.

**K factor — how fast a rating moves:**

| Situation                           | K   |
| ----------------------------------- | --- |
| Provisional (first 10 rated events) | 40  |
| Established, rating < 1400          | 32  |
| Established, rating 1400–1799       | 24  |
| Established, rating 1800+           | 16  |

A high K for beginners lets a good new user climb quickly; a low K
for experts stops one lucky result from moving a Master rating by 30
points.

### 4. Worked example (verified)

A is 1200, B is 1400, K = 32 for both.

- Expected score for A: Ea = 1 / (1 + 10^((1400-1200)/400)) = **0.24**
- If A wins: A gains 32 × (1 − 0.24) = **+24.3 → 1224**,
  B loses the same 24.3 → **1376**.
- If B wins, as expected: B gains 32 × (1 − 0.76) = **+7.7**,
  A loses 7.7 → **1192**.
- Beating a stronger opponent pays more than beating a weaker one.
  Losing to a stronger opponent costs almost nothing.

### 5. What counts as a rated event (and what does not)

**Learning Rating — rated events are duels only:**

- A learning duel: two users, same set of questions, same time limit.
  Winner/loser/draw from correct answers, then speed as tie-break.
- Practice quizzes, lesson quizzes, and daily challenges give XP and
  streaks, but **never** change a rating. Otherwise users could grind
  easy questions to inflate a rating.

**Trading Rating — rated events are weekly seasons only:**

- One season = one calendar week (Mon 00:00 IST to Sun 23:59 IST).
- At season end, each active user's portfolio return is compared with
  the simulated market index return for that week.
- Score: return > index + 2% → win (1), within ±2% → draw (0.5),
  return < index − 2% → loss (0).
- The "opponent" is the index, fixed at rating 1200, so a win against
  the market always pays, and a loss always costs — no opponent
  picking, no farming a weak friend.
- A user must make at least 3 trades in the week to be rated that
  week. Fewer trades = unrated week, rating unchanged.
- Only one rating update per user per week from trading, no matter
  how many trades they made. This stops trade-spamming.

**Anti-gaming rules (all enforced in code, not in the UI):**

- Rated duels have a cooldown and a daily cap; the same pair cannot
  farm each other repeatedly.
- Trading rating ignores trade size below a minimum and ignores
  wash trades in the same instrument within the same minute.
- Inactivity decay: after 30 days with no rated event in a rating,
  that rating drifts 10 points per week toward 1000, maximum 50 points
  total, and never below the floor. Decay keeps leaderboards honest
  without punishing a short break.
- All rating updates run in one DB transaction with the event that
  caused them, with an idempotency key per event, so a retry can
  never apply the same result twice.

### 6. Seasons (so new users always have a chance)

- A season is one quarter (3 months). Ratings never hard-reset.
- At season start, each rating is soft-reset halfway toward 1000:
  `R_new = 1000 + (R_old − 1000) × 0.5`.
  Example: 1600 → 1300, 800 → 900. Order is preserved, gaps shrink,
  newcomers can catch up, and history is kept per season.
- Season titles and badges are awarded from the final season rating.

### 7. National and global comparison

This is a leaderboard and percentile problem, not a different formula.
The rating number is the same everywhere; only the group it is ranked
in changes.

- **Country:** stored once on the user profile as an ISO country code
  (e.g. `IN`), chosen at signup and changeable only with a reason and
  a cooldown, so users cannot hop countries to top a small leaderboard.
- **Tables kept per rating, per scope:**
  `global` (all users) and `country:<code>` (e.g. `country:IN`).
  Both are Redis sorted sets, rebuilt from PostgreSQL as the source
  of truth, updated on every rating change.
- **What a user sees:**
  - Rating number, tier, and change since last week (+24 / −8).
  - Global rank (e.g. #1,204) and global percentile (e.g. top 12%).
  - National rank (e.g. #87 in India) and national percentile.
  - Percentile = (users below you ÷ total users in that scope) × 100.
    Example: rank 120 of 1,000 users → 88th percentile, top 12%.
- **Leaderboard rules:** provisional users are listed but marked;
  only users with at least 10 rated events in that rating are eligible
  for a season title; the top 100 per scope is cached, full ranks are
  computed on demand.
- **Privacy:** leaderboards show display name and tier only, never
  email, phone, or exact portfolio holdings.

### 8. What the database stores (per rating, per user)

`user_ratings`: userId, kind (LEARNING / TRADING), rating,
gamesPlayed, wins, draws, losses, provisional (bool), lastRatedAt,
season, countryCode (denormalised for leaderboard rebuilds).

`rating_history`: one row per rated event — eventId (idempotency key),
opponent, expected score, actual score, K, delta, ratingBefore,
ratingAfter, season, createdAt. This is the audit trail: any rating
can be replayed and explained to the user.

### 9. What is NOT in Phase 3 v1

- No live head-to-head trading duels (weekly seasons only).
- No Glicko-style rating deviation display (K already handles
  confidence; deviation can be added later without changing the
  public number).
- No paid rating boosts, no rating purchases — buying a rating would
  destroy trust in the leaderboard.
- No real-money or real-ticker ratings. Simulator only, fictional
  tickers only, until legal and market-data review.

---

## Approval needed

Approve this document and Phase 3 can be built as a new `ratings`
module, following the blueprint: no core changes except additive
registration, one transaction per rating update, tests for the worked
example above, and leaderboards for Global + India first.
