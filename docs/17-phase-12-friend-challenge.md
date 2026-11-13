# Candle — Phase 12 Friend Challenge (P2, the last duel)

**Date:** 2026-11-13
**Status:** BUILT and verified (see §12). ADR: `docs/adr/0014-phase-12-friend-challenge.md`.
**Depends on:** Blueprint 01, Ratings doc 04, Duels doc 05 (§1 P2,
§3.3, §7 Step 10), doc 06 §4 (friends — READ ONLY context, not
built here), Phase 4 doc 07 (Bot/Daily), Phase 5 doc 09 (live
engine), Phase 6 doc 10 (Blitz), Phase 7 doc 12 (Case), Phase 8 doc
13 (Chart), Phase 9 doc 14 (Sprint), Phase 10 doc 15 (Crisis),
Phase 11 doc 16 (Weekly), doc 08 §1 (the duel inventory).

With this phase, **all 10 duel types in the catalogue are built**
(doc 08 §1). Friend Challenge is the last one — and it is a
start-mode, not a tenth engine.

---

## 1. What Friend Challenge is (and is not)

A Friend Challenge is an **invite-only way to start one of the six
1v1 live duels with a chosen opponent instead of a matched one**.
One player creates a challenge (duel type + a specific opponent);
the opponent accepts or declines; accepting starts the duel at
once, through the existing engine, bypassing matchmaking.

It is NOT:

- **The friends system.** No friend requests, no friend list, no
  follow, no 1-to-1 chat, no presence, no block/report. Those are
  doc 06 §4 and wait for Profiles + Settings (doc 06 §8 build
  order: Profiles + Settings first). The opponent in this phase is
  named by userId — from a past duel, or from a shared invite link.
  There is no user search and no friend picker in v1.
- **A new engine.** The duel a challenge starts is a matchmade
  duel with the matchmaking skipped: same set selection, same
  timers, same scoring, same settlement, same rematch offer. A
  second engine would have been a second place for every future
  scoring/Rating fix to land.
- **A new queue or a new socket namespace.** Accept returns the
  duel id + playUrl; the existing play pages resume the active duel
  on load (§8). No new socket event was added.
- **A push-notification system.** The creator sees the outcome by
  opening the challenge page (REST-visible status is enough in
  this phase; doc 06 §2.3 notification types arrive with Profiles
  - Settings).
- **A cancel flow.** There is no creator cancel while PENDING and
  no CANCELLED status: a pending challenge simply expires after
  24 h (§5).

## 2. Technical architecture

### 2.1 What was reused from earlier phases, and what is new

**Reused, unchanged:**

| Piece                                                                                                                                                              | Used for                                                                                                      | Where it lives                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `LiveDuelEngine.createLiveDuel`                                                                                                                                    | Creates the duel for LIVE / BLITZ / CASE / CHART challenges (set selection, timers, Redis state, socket room) | `modules/duels/live-duel-engine.service.ts`                                                    |
| `SprintEngine.createSprint` / `createCrisis`                                                                                                                       | Creates the duel for SPRINT / CRISIS challenges                                                               | `modules/trading-sprint/sprint-engine.service.ts`                                              |
| `RatingsService.getUserRatings`                                                                                                                                    | The Ratings shown on the invite (both players)                                                                | `modules/ratings/ratings.service.ts`                                                           |
| The engines' settlement Rating calls (`recordDuel` / `recordTradingDuel`, idempotency key `duel:{duelId}`)                                                         | Rating changes exactly once, by the same code path as a matchmade duel                                        | `modules/duels/live-duel-engine.service.ts`, `modules/trading-sprint/sprint-engine.service.ts` |
| The Ratings caps (same-pair 3/day, 10 rated events/user/day, 5-minute rematch cooldown)                                                                            | Anti-farming at settlement (and cooldown at accept)                                                           | `modules/ratings/ratings.service.ts`                                                           |
| `DuelsRepository` reads (`findUserById`, `findActiveLiveDuelForUser`, `findActiveSprintDuelForUser`, `findActiveCrisisDuelForUser`, `findLastFinishedDuelBetween`) | Opponent validation, busy checks, cooldown check                                                              | `modules/duels/duels.repository.ts`                                                            |
| `GET /duels/live/active` + gateway reconnect                                                                                                                       | Play pages resume a challenge duel on load                                                                    | `modules/duels/*`, `apps/web/app/duels/*/page.tsx`                                             |
| Standard envelope, error catalogue, JwtAuthGuard, DTO validation                                                                                                   | Every endpoint in §4                                                                                          | `common/*`                                                                                     |

**New:**

| Piece                                                                               | What it does                                                                                                                                                      |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `modules/friend-challenge/challenge-rules.ts`                                       | Pure helpers: the allowed duel-type list, live-vs-trading split, rating kind per type, play path per type, invite link, expiry math. No I/O, fully unit-testable. |
| `modules/friend-challenge/friend-challenge.service.ts`                              | All business rules: create/accept/decline/get/list, rate limit, busy checks, cooldown check, stale-ACCEPTED recovery, lazy expiry, the view shape.                |
| `modules/friend-challenge/friend-challenge.repository.ts`                           | The only Prisma touchpoint for challenges.                                                                                                                        |
| `modules/friend-challenge/friend-challenge.controller.ts`                           | Thin REST under `/challenges` (§4).                                                                                                                               |
| `modules/friend-challenge/dto/challenge.dto.ts`                                     | `CreateChallengeDto`, `InviteCodeParamDto`.                                                                                                                       |
| `modules/friend-challenge/friend-challenge.module.ts`                               | Imports `DuelsModule`, `TradingSprintModule`, `RatingsModule`; exports the service.                                                                               |
| `modules/friend-challenge/README.md`                                                | Module doc (endpoints, lifecycle, rated rules, anti-abuse, reused vs new, web, testing, limits).                                                                  |
| `Challenge` model + `ChallengeStatus` enum, migration 0014                          | §3.                                                                                                                                                               |
| `apps/web/app/duels/challenge/page.tsx`                                             | The challenge page (§8).                                                                                                                                          |
| Resume effects on the four live play pages + opponent Rating in `activeDuelSummary` | §8.                                                                                                                                                               |

**One-line changes to existing modules (additive only):**

- `app.module.ts`: `FriendChallengeModule` registered.
- `duels.module.ts`: `DuelsRepository` added to `exports` — the
  challenge service reads through it. The repository is still the
  only Prisma touchpoint for duels; the challenge module never
  writes a Duel row except through the engines.
- `live-duel-engine.service.ts`: `activeDuelSummary`'s opponent now
  also returns `rating` (from the Redis state; a bot opponent
  returns the creator's Rating) — so a resumed play page shows it.
  No other engine, gateway, or Rating code was edited.

### 2.2 Data model (migration 0014)

```prisma
enum ChallengeStatus { PENDING ACCEPTED DECLINED EXPIRED PLAYED }

model Challenge {
  id         String          @id @default(uuid()) @db.Uuid
  creatorId  String          @db.Uuid
  creator    User            @relation("ChallengeCreator", fields: [creatorId], references: [id], onDelete: Cascade)
  inviteeId  String          @db.Uuid
  invitee    User            @relation("ChallengeInvitee", fields: [inviteeId], references: [id], onDelete: Cascade)
  duelType   DuelType        // six 1v1 types only — DTO-enforced
  status     ChallengeStatus @default(PENDING)
  inviteCode String          @unique   // 16 lowercase hex chars
  duelId     String?         @db.Uuid  // null until PLAYED
  duel       Duel?           @relation(fields: [duelId], references: [id])
  expiresAt  DateTime        // createdAt + 24 h
  createdAt  DateTime        @default(now())
  updatedAt  DateTime        @updatedAt

  @@index([creatorId, status, createdAt])
  @@index([inviteeId, status, createdAt])
  @@index([duelId])
  @@map("challenges")
}
```

`User` gains `challengesCreated` / `challengesReceived`;
`Duel` gains `challenges` (at most one challenge links to a given
duel — a challenge links to its duel once, at accept).

Migration `0014_phase12_friend_challenge` was generated via
`prisma migrate diff` (schema-before reconstructed from the
pre-change schema; no live DB) and hand-reviewed. Hand-added, not
from the diff: the partial unique index
`challenges_one_pending_per_pair_type_idx` on
`(LEAST("creatorId","inviteeId"), GREATEST("creatorId","inviteeId"),
"duelType") WHERE "status" IN ('PENDING','ACCEPTED')` — one pending
or accepted challenge per unordered pair per duel type, in either
direction. The service checks the same rule before inserting; the
index is the race guard for two simultaneous creates (the same
pattern as the Daily set's unique date). No backfill: the table is
new. **Not applied to a live Postgres.**

## 3. Which duel types can be challenged

| Duel type                     | Challengeable? | Why                                                                                                                                                                                             |
| ----------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| LIVE (Speed Quiz)             | Yes            | 1v1 live question duel                                                                                                                                                                          |
| BLITZ (Myth vs Fact)          | Yes            | 1v1 live question duel                                                                                                                                                                          |
| CASE (Case Duel)              | Yes            | 1v1 live question duel                                                                                                                                                                          |
| CHART (Chart Detective)       | Yes            | 1v1 live question duel                                                                                                                                                                          |
| SPRINT (Paper Trading Sprint) | Yes            | 1v1 live trading duel                                                                                                                                                                           |
| CRISIS (Crisis Duel)          | Yes            | 1v1 live trading duel                                                                                                                                                                           |
| DAILY                         | **No**         | Season-based: one fixed 5-question set per IST day, shared by every player, paired in finish order. A direct invite would break the shared set and the pairing order. The DTO rejects it (400). |
| WEEKLY                        | **No**         | A season of leagues, not a 1v1 duel (ADR 0013 §3). There is no opponent pair to invite. The DTO rejects it (400).                                                                               |
| BOT                           | **No**         | Practice against Mira, never a challenge against a person. The DTO rejects it (400).                                                                                                            |

The allowed list lives in one place (`DUELS.CHALLENGE_DUEL_TYPES`
in `packages/shared`, shared by the DTO and the service), so the API
and the rule can never drift apart.

## 4. API

Base: `/api/v1/challenges`. All endpoints authenticated
(JwtAuthGuard, global). Thin controllers, DTO validation at the
boundary, standard envelope, disclaimer on every endpoint.
OpenAPI: see the module README (`modules/friend-challenge/README.md`
§"OpenAPI") — every endpoint below is documented there with
request/response shapes.

| Method | Path                       | Request                          | Success                                                                      | Errors                                                                                                                                                                                                                                                                                      |
| ------ | -------------------------- | -------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/challenges`              | `{ opponentId, duelType }`       | 201 ChallengeView                                                            | Self → 400 `VALIDATION_FAILED`; unknown opponent → 404; DAILY/WEEKLY/BOT → 400; duplicate pending → 409 `CHALLENGE_ALREADY_PENDING`; either player busy → 409 (`DUEL_LIVE_ALREADY_ACTIVE` / `SPRINT_ALREADY_ACTIVE` / `CRISIS_ALREADY_ACTIVE`); 11th create in an hour → 429 `RATE_LIMITED` |
| GET    | `/challenges/incoming`     | —                                | 200 ChallengeView[] (my pending incoming, newest first)                      | —                                                                                                                                                                                                                                                                                           |
| GET    | `/challenges/outgoing`     | —                                | 200 ChallengeView[] (my pending outgoing, newest first)                      | —                                                                                                                                                                                                                                                                                           |
| GET    | `/challenges/invite/:code` | `:code` = 16 lowercase hex chars | 200 ChallengeView (invitee only)                                             | Anyone else, or a bad code → 404 (same answer either way — no user enumeration)                                                                                                                                                                                                             |
| GET    | `/challenges/:id`          | —                                | 200 ChallengeView (creator or invitee only)                                  | Anyone else → 403; unknown id → 404                                                                                                                                                                                                                                                         |
| POST   | `/challenges/:id/accept`   | —                                | 200 `{ challenge, duelId, playUrl }` (invitee only; the duel starts at once) | Not the invitee → 403; not pending → 409 `CHALLENGE_NOT_PENDING`; expired → 409 `CHALLENGE_EXPIRED`; either player busy → 409; 5-minute rematch cooldown → 409 `RATING_DUEL_COOLDOWN`                                                                                                       |
| POST   | `/challenges/:id/decline`  | —                                | 200 ChallengeView (status DECLINED; invitee only)                            | Not the invitee → 403; not pending → 409 `CHALLENGE_NOT_PENDING`; expired → 409 `CHALLENGE_EXPIRED`                                                                                                                                                                                         |

**The `ChallengeView` shape** (what every read returns):

```ts
{
  id: string;
  duelType: 'LIVE' | 'BLITZ' | 'CASE' | 'CHART' | 'SPRINT' | 'CRISIS';
  rated: true; // always — ADR 0014 §3
  ratingKind: 'LEARNING' | 'TRADING';
  creator: {
    (userId, displayName, rating);
  }
  invitee: {
    (userId, displayName, rating);
  }
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'PLAYED';
  inviteCode: string; // 16 hex chars
  inviteLink: string; // /duels/challenge?code={inviteCode}
  duelId: string | null; // null until PLAYED
  playUrl: string | null; // /duels/live, /duels/blitz, /duels/case,
  // /duels/chart, /duels/sprint, /duels/crisis
  createdAt: string;
  expiresAt: string;
  expiresInMs: number; // countdown
  updatedAt: string;
}
```

**No new socket event.** Accept returns the duel id + playUrl; the
existing play pages resume the active duel on load (§8).

## 5. Invite lifecycle — the state diagram

```
PENDING ──accept──▶ ACCEPTED ──duel created──▶ PLAYED (duelId set)
   │                  │  (transient, inside one request)
   │                  └──duel creation failed──▶ PENDING (claim reverted)
   ├──decline──▶ DECLINED
   └──24 h pass──▶ EXPIRED (lazy, on read — no scheduler yet)
```

### 5.1 Expiry: 24 hours

`CHALLENGE_EXPIRY_MS` = 24 h from creation. Long enough for an
opponent in another timezone to see it, short enough that a stale
invite never lingers. An expired invite cannot be accepted (409
`CHALLENGE_EXPIRED`).

### 5.2 ACCEPTED is transient — the rule that keeps nothing stuck

ACCEPTED is written only when an accept claims the challenge — so a
second accept racing the first sees ACCEPTED, not PENDING — and the
**same request** moves it to PLAYED (duel created, `duelId` stored)
or reverts it to PENDING (duel creation failed, error propagates).
The challenge is never left in ACCEPTED by a failed accept.

**Crash recovery is lazy, not a scheduler.** If the process dies
between the claim and the duel creation, the row sits in ACCEPTED
with no `duelId`. Every read path runs `settleStale` first: an
ACCEPTED row with no `duelId` older than 5 minutes
(`CHALLENGE_STALE_ACCEPTED_MINUTES`) is reverted to PENDING, and
can then be accepted again. There is no scheduler yet — the same
pattern as the Daily settle-unpaired ADMIN endpoint, and the same
reason: a cron is a second system to operate, and lazy recovery
covers every path a user can actually take.

**Expiry is lazy too.** A PENDING challenge past its `expiresAt`
flips to EXPIRED on the next read/accept/decline. A challenge that
nobody ever reads stays PENDING in the table past its expiry — it
is harmless (it can never be accepted: accept re-checks the clock),
and the next list read cleans it up.

### 5.3 One pending per pair per duel type, either direction

A→B blocks B→A for the same type (the pair is the unit, not the
direction). Enforced in the service (`findBlockingBetween`) AND by
the partial unique index in migration 0014 (§2.2) — the index is
the race guard for two simultaneous creates.

### 5.4 Declined / expired challenges never count toward any cap

They create no Duel row and no rating event, so a fresh challenge
after a decline is always allowed (subject only to the 10/hour rate
limit, §7).

### 5.5 Rematch is different from challenge

The standard rematch offer at the end of the duel applies
unchanged (same variant, both players must ask, 5-minute
cooldown). A challenge is a NEW duel — a new type choice — and the
result view says so in plain words (§8).

## 6. Rated rules — rated by default, no opt-out

**Decision (ADR 0014 §3): a Friend Challenge is RATED, always.
There is no unrated toggle, and the challenged player cannot opt
for unrated.** This supersedes doc 05 §1 P2 ("Rating changes only
if both opt into rated mode").

The reasons, in order:

1. **Accepting with the stakes visible IS the opt-in.** Doc 05
   §3.3 already requires the Rating range to be shown before
   accepting. The invite carries both players' Ratings (Learning
   or Trading, by duel type), so no 1000 player is tricked into a
   1900 match. A separate "rated?" toggle at accept time would
   re-ask a question the invite already answered.
2. **Consistency with every other rated duel.** A matchmade Speed
   Quiz, Blitz, Case, Chart, Sprint, or Crisis duel has no unrated
   toggle either — queueing is the opt-in there. A challenge is
   the same duel with the opponent chosen instead of matched; it
   should not have a different stakes rule.
3. **Unrated practice already exists.** The Bot Duel (P1) is the
   unrated way to learn a format, with no Rating risk.
4. **No farming vector is opened.** The same caps that guard
   matchmade duels guard challenges (§7).

The Rating that changes is the one the underlying duel type
changes: Learning Rating for LIVE / BLITZ / CASE / CHART, Trading
Rating for SPRINT / CRISIS. The settlement call is the engine's
own (`recordDuel` / `recordTradingDuel`), so a challenge duel
settles rated exactly once, by the same code path as a matchmade
duel.

## 7. Anti-abuse

- **No farming.** Same-pair max 3 rated duels/day + max 10 rated
  events/user/day (UTC), enforced at SETTLEMENT by the Ratings
  service — the same code path as a matchmade duel. A cap hit at
  settle time settles the played duel unrated with the reason in
  plain words (ADR 0007 §8): losing a played duel's result would
  be worse than a missed Rating update. The 5-minute rematch
  cooldown is enforced earlier, at ACCEPT, via the last finished
  duel of the same type between the pair — so a challenge is never
  accepted into a duel that cannot be rated for cooldown reasons.
- **No double-booking.** A challenge cannot be created while
  either player is already in a live duel (live question duels or
  trading duels), and accept re-checks both players — state may
  have changed while the invite waited. A player in a duel gets 409.
- **Rate limit: 10 creates per user per UTC hour** (Redis counter
  `challenge:create:{userId}:{YYYY-MM-DDTHH}`, 1 h expiry). Doc 06
  §4.6 allows 10 duel challenges per hour; this phase enforces
  exactly that, with no cleanup job (the key expires).
- **No stakes.** No real money, no wagering, no stakes of any
  kind. All trading is simulated with virtual money; all tickers
  are fictional (blueprint §16).
- **No user enumeration.** The invite code is unguessable (16 hex
  chars from `randomBytes`), and opening a link is restricted to
  the invitee: anyone else gets the same 404 as a bad code.
  Accepting requires being the invitee (403 otherwise). A forwarded
  link proves possession of the link, not identity.

## 8. Web UI

- **Challenge page** — `apps/web/app/duels/challenge/page.tsx`
  (client component, Suspense-wrapped for `useSearchParams`,
  following the `verify-email` pattern). Create by opponent userId
  - duel-type select (all six types, each with a one-line blurb);
    pending incoming/outgoing lists with a live expiry countdown
    (1-second tick, `expiresInMs` from the view); Accept/Decline
    buttons on incoming; invite link + copy button on outgoing;
    `?code=` invite opening (fetches `GET /challenges/invite/:code`
    and shows the invite with Accept/Decline); on accept, a "Duel
    started!" panel linking to `playUrl`. Unauthenticated users are
    redirected to `/login`.
- **Invite link format:** `/duels/challenge?code={inviteCode}`
  (16 lowercase hex chars). Possession of the link is NOT identity:
  only the invitee can open it (others get 404) or accept it
  (others get 403).
- **Duels hub** — `apps/web/app/duels/page.tsx` has a Friend
  Challenge card at the top of the list, linking to
  `/duels/challenge`.
- **Result view** — `apps/web/app/duels/result-view.tsx` has a
  "Challenge a friend" card linking to `/duels/challenge`, noting
  that rematch replays this duel type while a challenge is a new
  duel-type choice.
- **Play pages resume the duel.** The four live play pages (`live`
  / `blitz` / `case` / `chart`) now resume an active duel of their
  variant on load via `GET /duels/live/active`: the gateway
  rejoins the socket to the duel room and resends the countdown /
  current question, so the duel starts without joining the queue
  again. Sprint/crisis pages already resumed via their `/active`
  endpoints. To make the resume show the opponent properly,
  `LiveDuelEngine.activeDuelSummary` now also returns the
  opponent's Rating (§2.1).

**A timing note the UI must live with:** the 3-second countdown
starts at duel creation (at accept), not at page open. A player
who dawdles on the challenge page after accepting may join
mid-question-1 — the reconnect path resends the current question,
so they lose only time, not the duel. A "waiting for opponent to
open the duel" hold would be kinder, and is a follow-up if Nishu
wants it (§13).

## 9. Characters in Friend Challenge duels

The host is the host of the underlying duel type (Mira for LIVE /
BLITZ / SPRINT, Kabir for CASE / CHART, Tara for CRISIS) — the
challenge adds no new character and no new host line. The
character rule from doc 08 §2.2 still holds: hosts speak before
and after the duel, never during a rated question.

## 10. Module README + OpenAPI

The module README (`apps/api/src/modules/friend-challenge/README.md`)
documents the endpoints, lifecycle diagram, rated rules, anti-abuse,
reused-vs-new split, web resume behaviour, testing, and known
limits — and carries the OpenAPI for every new REST endpoint
(request/response shapes, status codes, error codes).

## 11. Manual QA

(To be run against a live deployment; the e2e suite in §12 covers
the same flows against in-memory fakes.)

1. Log in as A. Open `/duels/challenge`, create a LIVE challenge
   to B (paste B's userId). The outgoing list shows it PENDING
   with a countdown, and the invite link copies.
2. Log in as B (another browser/incognito). Open the invite link:
   the invite shows both Ratings and Accept/Decline. Accept →
   "Duel started!" → Play → the live page resumes into the duel
   (countdown, then question 1). Play all 7 questions; the result
   shows, and both Ratings move once.
3. Create a second challenge A→B for the same type while the first
   is pending: 409 `CHALLENGE_ALREADY_PENDING`. Create B→A: also
   409 (either direction blocks).
4. Create a challenge, decline it as B: status DECLINED, and a
   fresh challenge to B is allowed immediately.
5. Create a challenge to a userId that does not exist: 404.
   Create a challenge to yourself: 400.
6. Create a challenge, wait 24 h (or move `expiresAt` in the DB):
   accept → 409 `CHALLENGE_EXPIRED`, and the list shows EXPIRED.
7. Create 11 challenges in an hour: the 11th → 429.
8. Create a challenge while B is in a live duel: 409.
9. Open B's invite link as A (the creator) or as C: 404. Accept
   as C: 403.
10. After a duel finishes, the result view offers "Challenge a
    friend" (new duel type) next to the rematch offer (same type).

## 12. Testing

- **Unit** (`challenge-rules.spec.ts` + `friend-challenge.service.spec.ts`,
  in-memory fakes) — 29 tests: create (happy, trading kind, self,
  unknown, duplicate either direction, declined-does-not-block,
  busy creator/invitee, busy sprint, 10/hour rate limit), accept
  (live CASE, SPRINT, CRISIS, wrong-player/creator forbidden,
  expired, declined, double-accept, engine-failure revert to
  PENDING, busy-at-accept, 5-minute cooldown + pass at 6 minutes),
  decline (invitee-only, expired), invite code (invitee 200,
  others 404), get (non-participant 403), lists (expired flips +
  drops out), stale ACCEPTED revert (6-minute-old claim → PENDING,
  then accept succeeds).
- **E2E** (`apps/api/test/app.e2e-spec.ts`, "friend challenge" —
  in-memory fakes, real HTTP pipeline + real sockets) — 8 tests:
  full lifecycle create → accept → play 7 questions → settle →
  rated once (LIVE: winner +20 / loser −20, gamesPlayed 1 each,
  stored result reads back); sprint challenge → trade → settle →
  Trading Rating moves; decline (fresh challenge allowed after,
  declined accept 409); guards (self 400, unknown 404, DAILY 400,
  duplicate 409, wrong-player 403, creator accept 403); invite
  code (invitee 200, creator 404, bad code 404); expiry
  (past-expiry accept 409 `CHALLENGE_EXPIRED`, reads EXPIRED,
  fresh challenge allowed); busy guard (409 while in a live duel,
  forfeit cleans up); rate limit (11th create 429 `RATE_LIMITED`).
- **Full gates** (run 2026-11-13, after the phase, all green):
  unit **626/626, 49 suites**; e2e **139/139, 1 suite**; typecheck
  exit 0; lint exit 0; format clean for every file this phase
  touched (6 pre-existing files this phase did not touch —
  `docs/04`, `docs/06`, `docs/11`, `docs/13`, `docs/14`,
  `docs/adr/0010` — are still flagged by repo-wide
  `format:check`; left alone deliberately).

## 13. Limits and follow-ups (not in this phase)

- Migration not applied to a live Postgres; seed not executed
  against a live DB; Docker not booted; single-server tested
  config (timers live on one process — a crash mid-duel voids it,
  same as every live duel; Redis state is the resume path).
- Expiry and stale-ACCEPTED recovery are lazy (on read), not a
  scheduler. A cron that sweeps expired/stale challenges would
  make the lists exact without a read; it is a follow-up, not a
  correctness gap (accept re-checks the clock, lists filter by
  status after `settleStale`).
- No push notification on create/accept/decline (§1). The creator
  learns the outcome by opening the challenge page.
- The opponent is named by userId, not picked from a friends list
  or search (§1). That arrives with the friends system (doc 06).
- The 3-second countdown starts at accept, not at page open (§8):
  a slow acceptor joins mid-question-1. A "waiting for opponent
  to open the duel" hold is a follow-up if Nishu wants it.
- The rated caps are enforced at settlement, not pre-checked at
  accept (§7): a pair at their 3/day cap can still accept and play,
  and the duel settles unrated with the reason in plain words. A
  pre-accept cap read would need a Ratings pre-check method that
  does not exist; the settlement fallback is the documented
  behaviour for matchmade duels too (ADR 0007 §8), so challenges
  match it rather than inventing a second rule.
