# Friend Challenge module

Friend Challenge (P2, the last duel) — docs/05-duels-system-design.md §1/§7 Step 10,
docs/17-phase-12-friend-challenge.md, ADR 0014. **An invite-only start-mode for the
existing duel engines, not a separate engine and not the friends system (doc 06).**
No friend requests, friend lists, chat, profiles, or settings are built here — those
wait for Profiles + Settings.

## What it is

A player challenges one specific opponent, by userId, to one of the six 1v1 duel types
(LIVE / BLITZ / CASE / CHART / SPRINT / CRISIS). The invitee accepts and the duel
starts immediately via the existing engine — bypassing matchmaking, because the pair
is already chosen — or declines and the challenge closes. Invites expire after 24 hours.

## Endpoints (`/api/v1/challenges`)

| Method | Path                       | Auth | Notes                                                                                      |
| ------ | -------------------------- | ---- | ------------------------------------------------------------------------------------------ |
| POST   | `/challenges`              | user | Create an invite: `{ opponentId, duelType }`. 201. One pending per pair per type; 10/hour. |
| GET    | `/challenges/incoming`     | user | My pending incoming challenges (I am the invitee), newest first.                           |
| GET    | `/challenges/outgoing`     | user | My pending outgoing challenges (I am the creator), newest first.                           |
| GET    | `/challenges/invite/:code` | user | Open an invite link by its code. Invitee only — anyone else gets 404.                      |
| GET    | `/challenges/:id`          | user | One challenge (creator or invitee only).                                                   |
| POST   | `/challenges/:id/accept`   | user | Invitee only: starts the duel at once (rated), challenge → PLAYED with the duel id.        |
| POST   | `/challenges/:id/decline`  | user | Invitee only: closes the challenge. Never counts toward any cap.                           |

Every endpoint carries the educational disclaimer (blueprint §16). All responses use
the standard envelope (blueprint §7).

**OpenAPI:** every endpoint above has an `@ApiOperation` (summary +
description, including the disclaimer) on the controller, and both
DTOs (`CreateChallengeDto`, `InviteCodeParamDto`) carry `@ApiProperty`
on every field — so the full contract (request/response shapes,
status codes, error codes) is generated into the Swagger document
served at `/api/docs` (`main.ts`), the same way every other module
documents its endpoints. No endpoint is decorator-free.

## The invite lifecycle

```
PENDING ──accept──▶ ACCEPTED ──duel created──▶ PLAYED (duelId set)
   │                  │  (transient, one request — never a resting state)
   │                  └──duel creation failed──▶ PENDING (claim reverted)
   ├──decline──▶ DECLINED
   └──24 h pass──▶ EXPIRED (lazy, on read — no scheduler yet)
```

- **ACCEPTED is transient.** It is written only when an accept claims the challenge, and
  the same request moves it to PLAYED or reverts it to PENDING. A crash between the claim
  and the duel is recovered lazily: an ACCEPTED row with no duelId older than 5 minutes is
  reverted to PENDING on the next read (`settleStale`). No challenge is ever stuck in ACCEPTED.
- **Expiry is lazy.** There is no scheduler yet (same pattern as the Daily
  settle-unpaired ADMIN endpoint): a PENDING challenge past its `expiresAt` flips to
  EXPIRED on the next read/accept/decline.
- **One pending per pair per duel type**, in either direction (A→B blocks B→A too).
  Enforced in the service (`findBlockingBetween`) AND by the partial unique index in
  migration 0014 (`LEAST/GREATEST` over the pair, status PENDING or ACCEPTED) — the
  index is the race guard.
- **Invite link:** `/duels/challenge?code={inviteCode}`. The code (16 hex chars,
  unguessable) alone identifies the challenge. Possession of the link is NOT identity:
  only the invitee can open it or accept it; anyone else gets 404 / 403.

## Rated rules (ADR 0014 §3)

- **Rated by default, no unrated toggle.** The invite shows both players' Ratings
  (Learning or Trading, by duel type), so accepting with the stakes visible IS the
  opt-in. This supersedes doc 05 §1 P2 ("Rating changes only if both opt into rated
  mode") — the opt-in is the accept itself, and unrated practice already exists
  (Bot Duel). A separate toggle would leave the stakes ambiguous at accept time.
- **Same Rating path as the underlying duel.** LIVE/BLITZ/CASE/CHART move the Learning
  Rating; SPRINT/CRISIS move the Trading Rating, via the engines' existing settlement
  calls (`recordDuel` / `recordTradingDuel`, idempotency key `duel:{duelId}`).
- **Same caps, enforced at settlement by Ratings** (docs/04 §5): same pair max 3 rated
  duels/day, max 10 rated events/user/day (UTC). A cap hit settles the played duel
  unrated with the reason in plain words — the duel is never wasted (ADR 0007 §8).
- **5-minute rematch cooldown** (docs/04 §5) is enforced at ACCEPT, not at settlement,
  via the last finished duel of the same type between the pair.
- **Rematch:** the standard rematch offer at the end of the duel applies unchanged
  (same variant, both players must ask, 5-minute cooldown).

## Anti-abuse (docs/17 §8)

- No challenge while either player is already in a live duel (live question duels
  or trading duels) — checked at create AND at accept (state may change while the
  invite waits).
- Same-pair/day caps + rematch cooldown (above). A declined/expired challenge never
  counts toward any cap — it creates no Duel row and no rating event.
- Rate limit: max 10 challenge creates per user per UTC hour (Redis counter,
  `challenge:create:{userId}:{YYYY-MM-DDTHH}`, 1 h expiry). Doc 06 §4.6 allows
  10 duel challenges per hour.
- No real money, no wagering, no stakes of any kind. All trading is simulated with
  virtual money; all tickers are fictional.

## What is reused vs what is new

Reused, unchanged:

- `LiveDuelEngine.createLiveDuel` (LIVE / BLITZ / CASE / CHART) — set selection,
  countdown, timers, grading, reveal, disconnect grace, settlement, rematch.
- `SprintEngine.createSprint` / `createCrisis` (SPRINT / CRISIS) — market, orders,
  crash, settlement.
- `RatingsService.getUserRatings` (Ratings shown on the invite) and the engines'
  settlement Rating calls (caps enforced there).
- `DuelsRepository` / `SprintRepository` reads (user lookup, active-duel and
  last-duel checks). `DuelsRepository` is exported by `DuelsModule` for this module.
- The existing play pages resume the active duel on load (live pages via
  `GET /duels/live/active` + socket reconnect, sprint/crisis pages via their
  `/active` endpoints) — so accept returns `playUrl` and needs no new socket event.

New in this module:

- `Challenge` model + `ChallengeStatus` enum (PENDING / ACCEPTED / DECLINED /
  EXPIRED / PLAYED), migration `0014_phase12_friend_challenge`.
- `challenge-rules.ts` (pure: allowed types, live/trading split, Rating kind,
  play path, invite link, expiry math), `friend-challenge.repository.ts` (the
  only Prisma touchpoint), `friend-challenge.service.ts` (all rules),
  `friend-challenge.controller.ts` (thin REST), `dto/challenge.dto.ts`.
- Error codes `CHALLENGE_ALREADY_PENDING`, `CHALLENGE_EXPIRED`,
  `CHALLENGE_NOT_PENDING` (shared catalogue + status map + `AppError` factories).
- Shared tunables `DUELS.CHALLENGE_EXPIRY_HOURS/MS` (24 h),
  `CHALLENGE_CREATE_PER_HOUR` (10), `CHALLENGE_STALE_ACCEPTED_MINUTES` (5),
  `CHALLENGE_DUEL_TYPES`.

## Web

- `apps/web/app/duels/challenge/page.tsx` — create by userId + duel type, pending
  incoming/outgoing lists with an expiry countdown, accept/decline buttons, invite
  link + copy, `?code=` invite opening, "Duel started" → play link.
- Duels hub (`apps/web/app/duels/page.tsx`) — Friend Challenge card.
- Result view (`apps/web/app/duels/result-view.tsx`) — "Challenge a friend to a new
  duel" link (a challenge is a NEW duel type choice; rematch replays this one).
- Live play pages (`live` / `blitz` / `case` / `chart`) — resume an active duel of
  their variant on load via `GET /duels/live/active` (the gateway rejoins the room
  and resends the countdown / current question). Sprint/crisis pages already resumed
  via their `/active` endpoints. `LiveDuelEngine.activeDuelSummary` now also returns
  the opponent's Rating, so the resumed page shows it.

## Testing

- Unit: `challenge-rules.spec.ts` (pure helpers) +
  `friend-challenge.service.spec.ts` (in-memory fakes: create/duplicate/self/unknown/
  busy/rate-limit, accept live + sprint + crisis, wrong-player, expiry, decline,
  engine-failure revert, cooldown, stale-ACCEPTED revert).
- E2E (`apps/api/test/app.e2e-spec.ts`, "friend challenge"): full lifecycle create →
  accept → play 7 questions → settle → rated once (LIVE, +20/−20, gamesPlayed 1);
  sprint challenge → trade → settle → Trading Rating moves; decline; guards
  (self 400, unknown 404, DAILY 400, duplicate 409, wrong-player 403); invite code
  (invitee 200, others 404); expiry (past-expiry accept 409 + EXPIRED read);
  busy guard (409 while in a live duel); rate limit (11th create 429).

## Known limits

- Migration not applied to a live Postgres; seed not executed against a live DB;
  Docker not booted; single-server tested config (timers live on one process — a
  crash mid-duel voids it, same as every live duel).
- Expiry and stale-ACCEPTED recovery are lazy (on read), not a scheduler — a
  PENDING challenge flips to EXPIRED only when someone reads it.
- No push notification on accept/decline: the creator sees the result by opening
  the challenge page (REST-visible status is enough in this phase, doc 06 §2.3
  notification types arrive with Profiles + Settings).
- The opponent is named by userId (from a past duel or a shared link) — there is
  no friends list or user search yet; that is the friends system (doc 06), which
  waits for Profiles + Settings.
- A challenge cannot be cancelled by its creator while PENDING — it simply expires
  after 24 h (no CANCELLED status; the enum is exactly the five states in ADR 0014 §5).
