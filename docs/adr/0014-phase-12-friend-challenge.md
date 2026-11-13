# ADR 0014 — Phase 12 Friend Challenge (P2, the last duel)

**Date:** 2026-11-13
**Status:** Accepted (built and verified; see §11)
**Context:** docs/05-duels-system-design.md §1/§7 (build order Step 10 —
"Friend Challenge: Any rated format, direct invite link, friend or
random, rematch button"; §3.3: "Friend Challenge bypasses the queue:
direct invite, both must accept, Rating range is shown before
accepting so a 1000 player is not tricked into a 1900 match";
anti-farming: same pair max 3 rated duels/day, rematch 5-minute
cooldown, rated duels per user per day capped at 10), docs/04
(doc 04 §5 anti-gaming caps; §3 the Rating formula), docs/08 §1/§2
(the duel inventory — 9 of 10 built before this phase — and the
character rule: hosts speak before/after only, never during a rated
question), docs/06 §4 (the friends system — friend requests, lists,
1-to-1 chat — which this phase explicitly does NOT build; it waits
for Profiles + Settings), ADR 0007/0008/0009/0010/0011/0012 (the
live/trading engines this phase reuses). All nine other duel types
are built and verified (Phases 4–11); Friend Challenge is the last one.

## 1. What was built

An invite-only **start-mode** for the existing duel engines — not a
separate engine, not the friends system:

- Backend: `src/modules/friend-challenge/` — `challenge-rules.ts`
  (pure helpers), `friend-challenge.service.ts` (all rules),
  `friend-challenge.repository.ts` (the only Prisma touchpoint),
  `friend-challenge.controller.ts` (thin REST under `/challenges`,
  §7), `dto/challenge.dto.ts`, `friend-challenge.module.ts`
  (imports `DuelsModule`, `TradingSprintModule`, `RatingsModule`),
  `README.md`.
- Reused, unchanged: `LiveDuelEngine.createLiveDuel` (LIVE / BLITZ /
  CASE / CHART), `SprintEngine.createSprint` / `createCrisis`
  (SPRINT / CRISIS), `RatingsService.getUserRatings` (Ratings shown
  on the invite) and the engines' existing settlement Rating calls
  (`recordDuel` / `recordTradingDuel`, idempotency key
  `duel:{duelId}`), `DuelsRepository` / `SprintRepository` reads.
  `DuelsModule` now also exports `DuelsRepository` (one line, §9) so
  the challenge service can read users, active duels, and last duels
  through it — it never writes a Duel row except through the engines.
- Prisma: new enum `ChallengeStatus` (PENDING / ACCEPTED / DECLINED /
  EXPIRED / PLAYED) + one new table `Challenge`, migration
  `0014_phase12_friend_challenge` (hand-reviewed, via
  `prisma migrate diff`, §10). No new `DuelType`: the duel a
  challenge creates is a normal Duel row of the challenged type.
- Shared: `DUELS.CHALLENGE_EXPIRY_HOURS/MS` (24 h),
  `CHALLENGE_CREATE_PER_HOUR` (10), `CHALLENGE_STALE_ACCEPTED_MINUTES`
  (5), `CHALLENGE_DUEL_TYPES`; error codes
  `CHALLENGE_ALREADY_PENDING`, `CHALLENGE_EXPIRED`,
  `CHALLENGE_NOT_PENDING`.
- Web: `apps/web/app/duels/challenge/page.tsx` (create by userId,
  pending lists with expiry countdown, accept/decline, invite link +
  copy, `?code=` invite opening) + a Friend Challenge card on the
  duels hub + a "Challenge a friend" entry on the result view +
  active-duel resume on the four live play pages
  (`GET /duels/live/active`; sprint/crisis pages already resumed).
  `LiveDuelEngine.activeDuelSummary` now also returns the opponent's
  Rating, so a resumed page shows it (§8).

## 2. What was NOT built (scope guard)

- **No friends system.** No friend requests, no friend list, no
  follow, no 1-to-1 chat, no presence, no block/report. Those are
  doc 06 §4, and they wait for Profiles + Settings (doc 06 §8 build
  order: Profiles + Settings first). The opponent in this phase is
  named by userId — from a past duel, or from a shared invite link.
  There is no user search and no friend picker in v1.
- **No new engine, no new queue, no new socket namespace.** The duel
  a challenge starts is a matchmade duel with the matchmaking
  skipped: same set selection, same timers, same scoring, same
  settlement, same rematch offer. A second engine would have been a
  second place for every future scoring/Rating fix to land.
- **No push notification** on create/accept/decline. The creator
  sees the outcome by opening the challenge page (REST-visible status
  is enough in this phase; doc 06 §2.3 notification types arrive with
  Profiles + Settings).
- **No creator cancel** while PENDING. A pending challenge simply
  expires after 24 h. There is no CANCELLED status: the enum is
  exactly the five states in §5, and a sixth state would have needed
  a reason no user asked for.
- **No Daily, no Weekly, no Bot challenges.** §4.

## 3. Rated by default — the one rule this ADR locks

**Decision: a Friend Challenge is RATED, always. There is no unrated
toggle, and the challenged player cannot opt for unrated.**

This supersedes doc 05 §1 P2 ("Rating changes only if both opt into
rated mode"). The reasons, in order:

1. **Accepting with the stakes visible IS the opt-in.** Doc 05 §3.3
   already requires the Rating range to be shown before accepting.
   The invite carries both players' Ratings (Learning or Trading, by
   duel type), so no 1000 player is tricked into a 1900 match. A
   separate "rated?" toggle at accept time would re-ask a question
   the invite already answered, and would leave the stakes ambiguous
   in the one place they must be unambiguous.
2. **Consistency with every other rated duel.** A matchmade Speed
   Quiz, Blitz, Case, Chart, Sprint, or Crisis duel has no unrated
   toggle either — queueing is the opt-in there. A challenge is the
   same duel with the opponent chosen instead of matched; it should
   not have a different stakes rule.
3. **Unrated practice already exists.** The Bot Duel (P1) is the
   unrated way to learn a format, with no Rating risk. A challenge
   does not need to duplicate it.
4. **No farming vector is opened.** The same caps that guard
   matchmade duels guard challenges (§6): same pair max 3 rated
   duels/day, max 10 rated events/user/day, 5-minute rematch
   cooldown — all enforced at settlement by the Ratings service, the
   same code path as a matchmade duel.

## 4. Which duel types can be challenged — and which cannot

Challengeable (the six 1v1 live duels): LIVE (Speed Quiz), BLITZ
(Myth vs Fact), CASE (Case Duel), CHART (Chart Detective), SPRINT
(Paper Trading Sprint), CRISIS (Crisis Duel).

Not challengeable:

- **DAILY** — the Async Daily Duel is season-based: one fixed
  5-question set per IST day, shared by every player, paired in
  order of finishing. A direct invite would break the shared set and
  the pairing order. The DTO rejects it (400).
- **WEEKLY** — the Weekly Portfolio Battle is a season of leagues,
  not a 1v1 duel (ADR 0013 §3). There is no opponent pair to invite.
  The DTO rejects it (400).
- **BOT** — the Bot Duel is practice against Mira, never a challenge
  against a person. The DTO rejects it (400).

The allowed list lives in one place (`DUELS.CHALLENGE_DUEL_TYPES`,
shared by the DTO and the service), so the API and the rule can
never drift apart.

## 5. The invite lifecycle — and why ACCEPTED can never stick

```
PENDING ──accept──▶ ACCEPTED ──duel created──▶ PLAYED (duelId set)
   │                  │  (transient, inside one request)
   │                  └──duel creation failed──▶ PENDING (claim reverted)
   ├──decline──▶ DECLINED
   └──24 h pass──▶ EXPIRED (lazy, on read — no scheduler yet)
```

- **Expiry: 24 hours from creation** (`CHALLENGE_EXPIRY_MS`). Long
  enough for an opponent in another timezone to see it, short enough
  that a stale invite never lingers. An expired invite cannot be
  accepted (409 `CHALLENGE_EXPIRED`).
- **ACCEPTED is transient, never terminal.** It is written only when
  an accept claims the challenge — so a second accept racing the
  first sees ACCEPTED, not PENDING — and the same request moves it
  to PLAYED (duel created, `duelId` stored) or reverts it to PENDING
  (duel creation failed, error propagates). The challenge is never
  left in ACCEPTED by a failed accept.
- **Crash recovery is lazy, not a scheduler.** If the process dies
  between the claim and the duel creation, the row sits in ACCEPTED
  with no `duelId`. Every read path runs `settleStale` first: an
  ACCEPTED row with no `duelId` older than 5 minutes
  (`CHALLENGE_STALE_ACCEPTED_MINUTES`) is reverted to PENDING, and
  can then be accepted again. There is no scheduler yet — the same
  pattern as the Daily settle-unpaired ADMIN endpoint, and the same
  reason: a cron is a second system to operate, and lazy recovery
  covers every path a user can actually take.
- **Expiry is lazy too.** A PENDING challenge past its `expiresAt`
  flips to EXPIRED on the next read/accept/decline. A challenge that
  nobody ever reads stays PENDING in the table past its expiry — it
  is harmless (it can never be accepted: accept re-checks the clock),
  and the next list read cleans it up.
- **One pending per pair per duel type, either direction.** A→B
  blocks B→A for the same type (the pair is the unit, not the
  direction). Enforced in the service (`findBlockingBetween`) AND by
  the partial unique index in migration 0014
  (`LEAST/GREATEST` over the two user ids, status PENDING or
  ACCEPTED) — the index is the race guard for two simultaneous
  creates, the same pattern as the Daily set's unique date.
- **Declined/expired challenges never count toward any cap.** They
  create no Duel row and no rating event, so a fresh challenge after
  a decline is always allowed (subject only to the 10/hour rate
  limit).
- **Rematch is different from challenge.** The standard rematch
  offer at the end of the duel applies unchanged (same variant, both
  players must ask, 5-minute cooldown). A challenge is a NEW duel —
  a new type choice — and the result view says so in plain words.

## 6. Anti-abuse

- **No farming.** Same-pair max 3 rated duels/day + max 10 rated
  events/user/day (UTC), enforced at SETTLEMENT by the Ratings
  service — the same code path as a matchmade duel. A cap hit at
  settle time settles the played duel unrated with the reason in
  plain words (ADR 0007 §8): losing a played duel's result would be
  worse than a missed Rating update. The 5-minute rematch cooldown
  is enforced earlier, at ACCEPT, via the last finished duel of the
  same type between the pair — so a challenge is never accepted into
  a duel that cannot be rated for cooldown reasons.
- **No double-booking.** A challenge cannot be created while either
  player is already in a live duel (live question duels or trading
  duels), and accept re-checks both players — state may have changed
  while the invite waited. A player in a duel gets 409
  (`DUEL_LIVE_ALREADY_ACTIVE` / `SPRINT_ALREADY_ACTIVE` /
  `CRISIS_ALREADY_ACTIVE`).
- **Rate limit: 10 creates per user per UTC hour** (Redis counter
  `challenge:create:{userId}:{YYYY-MM-DDTHH}`, 1 h expiry). Doc 06
  §4.6 allows 10 duel challenges per hour; this phase enforces
  exactly that, with no cleanup job (the key expires).
- **No stakes.** No real money, no wagering, no stakes of any kind.
  All trading is simulated with virtual money; all tickers are
  fictional (blueprint §16).
- **No user enumeration.** The invite code is unguessable (16 hex
  chars from `randomBytes`), and opening a link is restricted to the
  invitee: anyone else gets the same 404 as a bad code. Accepting
  requires being the invitee (403 otherwise). A forwarded link
  proves possession of the link, not identity.

## 7. API

Base: `/api/v1/challenges`. All endpoints authenticated
(JwtAuthGuard, global). Thin controllers, DTO validation at the
boundary, standard envelope, disclaimer on every endpoint.

| Method | Path                       | Notes                                                                                                                                                                                                 |
| ------ | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/challenges`              | `{ opponentId, duelType }` → 201 ChallengeView. Self → 400, unknown opponent → 404, duplicate pending → 409 `CHALLENGE_ALREADY_PENDING`, busy → 409, 11th/hour → 429 `RATE_LIMITED`.                  |
| GET    | `/challenges/incoming`     | My pending incoming, newest first.                                                                                                                                                                    |
| GET    | `/challenges/outgoing`     | My pending outgoing, newest first.                                                                                                                                                                    |
| GET    | `/challenges/invite/:code` | Open an invite link. Invitee only, else 404.                                                                                                                                                          |
| GET    | `/challenges/:id`          | Creator or invitee only, else 403.                                                                                                                                                                    |
| POST   | `/challenges/:id/accept`   | Invitee only. Starts the duel at once; returns `{ challenge, duelId, playUrl }`. Expired → 409 `CHALLENGE_EXPIRED`, not pending → 409 `CHALLENGE_NOT_PENDING`, cooldown → 409 `RATING_DUEL_COOLDOWN`. |
| POST   | `/challenges/:id/decline`  | Invitee only. → DECLINED.                                                                                                                                                                             |

The `ChallengeView` carries: id, duelType, `rated: true`,
ratingKind (LEARNING/TRADING), creator + invitee (userId,
displayName, Rating), status, inviteCode, inviteLink
(`/duels/challenge?code={inviteCode}`), duelId (null until PLAYED),
playUrl (null until PLAYED), createdAt, expiresAt, expiresInMs
(the countdown the UI shows), updatedAt.

**No new socket event.** Accept returns the duel id + playUrl; the
existing play pages resume the active duel on load (§8). The
countdown starts at duel creation (3 s, `LIVE_COUNTDOWN_MS`), so a
player who dawdles on the challenge page after accepting may join
mid-question-1 — the reconnect path resends the current question,
so they lose only time, not the duel.

## 8. Web — how the duel actually starts on screen

- The challenge page (`/duels/challenge`) creates by userId, lists
  pending incoming/outgoing with a live expiry countdown, and on
  accept shows "Duel started" with a Play link to the variant's
  play page. It also opens `?code=` invite links.
- The four live play pages (`live` / `blitz` / `case` / `chart`)
  now resume an active duel of their variant on load via
  `GET /duels/live/active`: the gateway rejoins the socket to the
  duel room and resends the countdown / current question, so the
  duel starts without joining the queue again. Sprint/crisis pages
  already resumed via their `/active` endpoints. To make the resume
  show the opponent properly, `LiveDuelEngine.activeDuelSummary`
  now also returns the opponent's Rating (additive field, from the
  Redis state — no new query).
- The duels hub has a Friend Challenge card; the result view has a
  "Challenge a friend to a new duel" link that says plainly that a
  challenge is a new duel type choice, while rematch replays this one.

## 9. Module wiring (one-line changes, additive only)

- `app.module.ts`: `FriendChallengeModule` registered (one line).
- `duels.module.ts`: `DuelsRepository` added to `exports` (one
  line) — the challenge service reads users, active duels, and last
  duels through it. The repository is still the only Prisma
  touchpoint for duels; the challenge module never writes a Duel row
  except through the engines.
- No core file, no engine, no gateway, no Rating code was edited
  except `activeDuelSummary`'s additive `rating` field (§8) and the
  shared constants / error catalogue additions (§1).

## 10. Data model + migration

```prisma
enum ChallengeStatus { PENDING ACCEPTED DECLINED EXPIRED PLAYED }

model Challenge {
  id         String          @id @default(uuid()) @db.Uuid
  creatorId  String          @db.Uuid
  creator    User            @relation("ChallengeCreator", ...)
  inviteeId  String          @db.Uuid
  invitee    User            @relation("ChallengeInvitee", ...)
  duelType   DuelType        // six 1v1 types only (DTO-enforced)
  status     ChallengeStatus @default(PENDING)
  inviteCode String          @unique   // 16 hex chars
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

Migration `0014_phase12_friend_challenge`, via
`prisma migrate diff` (schema-before reconstructed from the
pre-change schema; no live DB) and hand-reviewed. Hand-added, not
from the diff: the partial unique index
`challenges_one_pending_per_pair_type_idx` on
`(LEAST(creatorId, inviteeId), GREATEST(creatorId, inviteeId),
duelType) WHERE status IN ('PENDING', 'ACCEPTED')` — the race guard
for §5. No backfill: the table is new. **Not applied to a live
Postgres.**

## 11. Verification

- Unit: `challenge-rules.spec.ts` + `friend-challenge.service.spec.ts`
  (in-memory fakes) — 29 tests: create (happy, trading kind, self,
  unknown, duplicate either direction, declined-does-not-block,
  busy creator/invitee, busy sprint, 10/hour rate limit), accept
  (live CASE, SPRINT, CRISIS, wrong-player/creator forbidden,
  expired, declined, double-accept, engine-failure revert to
  PENDING, busy-at-accept, 5-minute cooldown + pass at 6 minutes),
  decline (invitee-only, expired), invite code (invitee 200,
  others 404), get (non-participant 403), lists (expired flips +
  drops out), stale ACCEPTED revert (6-minute-old claim → PENDING,
  then accept succeeds).
- E2E (`apps/api/test/app.e2e-spec.ts`, "friend challenge" — in-memory
  fakes, real HTTP pipeline + real sockets): 8 tests — full lifecycle
  create → accept → play 7 questions → settle → rated once (LIVE:
  winner +20 / loser −20, gamesPlayed 1 each, stored result reads
  back); sprint challenge → trade → settle → Trading Rating moves;
  decline (fresh challenge allowed after, declined accept 409);
  guards (self 400, unknown 404, DAILY 400, duplicate 409,
  wrong-player 403, creator accept 403); invite code (invitee 200,
  creator 404, bad code 404); expiry (past-expiry accept 409
  `CHALLENGE_EXPIRED`, reads EXPIRED, fresh challenge allowed);
  busy guard (409 while in a live duel, forfeit cleans up); rate
  limit (11th create 429 `RATE_LIMITED`).
- Full gates (run 2026-11-13, after the phase, all green):
  - unit suite: **626 passed, 626 total, 49 suites** (597 baseline + 29 new);
  - e2e suite: **139 passed, 139 total, 1 suite** (131 pre-existing + 8 new);
  - typecheck (all workspaces): exit 0;
  - lint (`eslint . --max-warnings=0`): exit 0;
  - format: all files touched by this phase pass `prettier --check`.
    Note: `format:check` repo-wide still flags 6 files this phase did
    NOT touch (`docs/04`, `docs/06`, `docs/11`, `docs/13`, `docs/14`,
    `docs/adr/0010`) — pre-existing style drift, deliberately left
    alone rather than reformatting unrelated docs.

## 12. Limits and follow-ups (not in this phase)

- Migration not applied to a live Postgres; seed not executed
  against a live DB; Docker not booted; single-server tested
  config (timers live on one process — a crash mid-duel voids it,
  same as every live duel; Redis state is the resume path).
- Expiry and stale-ACCEPTED recovery are lazy (on read), not a
  scheduler. A cron that sweeps expired/stale challenges would make
  the lists exact without a read; it is a follow-up, not a
  correctness gap (accept re-checks the clock, lists filter by
  status after `settleStale`).
- No push notification on create/accept/decline (see §2). The
  creator learns the outcome by opening the challenge page.
- The opponent is named by userId, not picked from a friends list
  or search (§2). That arrives with the friends system (doc 06).
- The 3-second countdown starts at accept, not at page open (§7):
  a slow acceptor joins mid-question-1. Acceptable in v1 — the
  reconnect path resends the current question — but a "waiting for
  opponent to open the duel" hold would be kinder, and is a
  follow-up if Nishu wants it.
- The rated caps are enforced at settlement, not pre-checked at
  accept (§6): a pair at their 3/day cap can still accept and play,
  and the duel settles unrated with the reason in plain words. A
  pre-accept cap read would need a Ratings pre-check method that
  does not exist; the settlement fallback is the documented
  behaviour for matchmade duels too (ADR 0007 §8), so challenges
  match it rather than inventing a second rule.
