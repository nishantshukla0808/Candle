# Candle — Profiles, Settings, Post-Game Stats, Chat, Friends, and Community

**Date:** 2026-11-11
**Status:** PARTIALLY BUILT — Profiles (§1) + Settings (§2) were built
in Phase 13 (2026-11-13, ADR 0015, docs/18-phase-13-profiles-settings.md).
Post-game stats (§3) already exists in `DuelGameResult` (not rebuilt).
Friends/chat (§4), communities (§5), and the remaining deferred items
(change-email, login history, 2FA, blocked users, hard-delete scheduler,
age enforcement) are still LATER — see docs/18 §8 for the reasons.
**Depends on:** Blueprint 01, Ratings design 04, Duels design 05.
**Phase 3 is running in parallel:** Ratings module + Duels Step 1
Question Bank. This doc plans the social side so it can plug into
Phase 3 when it is ready. It does not change Phase 3.

**Deviations from this design doc, locked in ADR 0015:** (1) FRIENDS
visibility behaves as PRIVATE until the friends phase lands (§1.5);
(2) country is locked with no change endpoint at all — the §1.6
90-day cooldown is gone, and signup collects no country yet, so
`countryCode` is null for everyone in v1; (3) simulator showcase is
ON by default, overturning the §1.8 draft; (4) language + timezone
live only in `UserSettings`, not on the profile (§1.10); (5) export
is synchronous inline JSON, no stored file / 7-day link yet (§2.6);
(6) the refresh cookie cannot identify the current session (it is
path-scoped to `/api/v1/auth`), so the access token carries the
refresh family as a `fam` claim (§2.2).

**Rule for this whole doc:** the public name is **Ratings**, never ELO.
All money is virtual. All tickers are fictional. Nothing here is
investment advice.

**Language note:** this doc uses simple English on purpose, so every
rule is clear to build from.

---

## 0. What exists today, and what is new

What already exists in the code (checked 2026-11-11):

- `User`: id, email, password hash, displayName, avatarKey, roles
  (USER / ADMIN), emailVerifiedAt. No bio, no country, no timezone,
  no settings, no privacy controls.
- `UserStats`: totalXp, level, currentStreak, longestStreak,
  lastActivityDate (Asia/Kolkata date, `YYYY-MM-DD`).
- XP values: lesson 50, quiz pass 20, trade 5, onboarding bonus 50.
  Level thresholds: 0, 100, 250, 500, 900, 1400, 2100, 3000, 4200, 6000.
- Badges today: First Steps, On a Roll (3-day streak), Unstoppable
  (7-day streak), Sharp Shooter (100% quiz), Foundation Graduate.
- Learning: lesson progress, lesson completions, quiz attempts.
- Simulator: one virtual portfolio per user, starting cash ₹100,000
  virtual, fictional instruments only, holdings, orders.
- Auth: JWT access (15 min) + rotating refresh tokens, email verify,
  password reset. No 2FA yet. No session list yet. No login history yet.

What is new in this doc: profile fields + privacy, settings, post-game
stats, friends + chat, communities + posts. Each one is a new module
that plugs into the existing modules. Core files are not edited to
make room for them (Blueprint §4/§5).

New modules (names are proposals):

- `profiles` — extends the existing `users` module, does not replace it.
- `settings` — new module for account, security, notifications,
  appearance, language, timezone, data and privacy.
- `game-results` — part of the `duels` module, for post-game stats.
- `social` — friends, follows, 1-to-1 chat, presence.
- `community` — communities, posts, comments, votes, feed, moderation.

---

## 1. User profiles

### 1.1 What a profile is

A profile is the public face of a learner. It answers three questions
in 5 seconds: who is this person, how good are they at learning and
trading, and what are they working on now.

### 1.2 Public vs private profile

There are two views of the same profile. The server decides what to
show, never the frontend.

**My profile (`GET /users/me`):** everything. Email, settings link,
private stats, duel history, blocked list. Only the owner can see it.

**Public profile (`GET /users/:id`):** only what the owner allows.
Today this endpoint returns only id, displayName, avatarKey,
createdAt. This doc extends it (see 1.4). Email, password hash,
refresh tokens, and exact portfolio holdings are never in a public
response, in any setting.

**Profile visibility (one main switch):**

| Setting          | Who can see the public profile?                       |
| ---------------- | ----------------------------------------------------- |
| Public (default) | Anyone, including logged-out visitors                 |
| Friends only     | Only accepted friends (see §4)                        |
| Private          | Only the owner. Others see "This profile is private." |

A private profile still appears on leaderboards by display name and
tier only (doc 04 §7), unless the user also hides Ratings (see 1.5).
Leaderboard visibility and profile visibility are separate switches,
so a user can be on a leaderboard without opening their full profile.

### 1.3 Profile fields

| Field           | Type / rule                                                                                                                                                                | Public?                                             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Display name    | Text, 2–30 chars, letters/numbers/spaces only. Must be unique? No — display names can repeat; the id is the unique key. Bad words blocked. Change: max 1 time per 30 days. | Yes                                                 |
| Avatar          | Image only, via existing StorageService (Blueprint §10). Max 2 MB. No external URL.                                                                                        | Yes                                                 |
| Bio             | Text, max 160 chars. No links, no phone number, no email. Links are stripped on save.                                                                                      | Yes, if set                                         |
| Country         | ISO code, e.g. `IN`, `US`. Chosen at signup. See 1.6.                                                                                                                      | Yes (country name + flag, never full address)       |
| Career title    | Derived, not typed by the user. See 1.7.                                                                                                                                   | Yes                                                 |
| Joined date     | Month + year only, e.g. "Nov 2026". Never the exact time.                                                                                                                  | Yes                                                 |
| Learning track  | Current track + progress %, e.g. Foundations 7/12.                                                                                                                         | Yes, if the user allows learning progress (see 1.5) |
| Duel record     | Wins / losses / draws per duel type, from the duels module.                                                                                                                | Yes, if the user allows duel history                |
| Favourite topic | The topic the user plays best, computed from stats.                                                                                                                        | Yes                                                 |
| Achievements    | Badge list, with date earned.                                                                                                                                              | Yes                                                 |
| Online status   | Online / offline only. Never "last seen at 14:32".                                                                                                                         | Friends only, if enabled                            |

What is **never** on a profile: email, phone, real name (unless the
user types it as a display name), password, exact portfolio holdings,
exact order history, exact quiz answers, home address, school name,
date of birth.

### 1.4 UI screens

**Screen 1 — My profile (`/profile`):**
Top card: avatar, display name, career title, country, joined month,
bio, Edit button. Below it, in tabs: Overview | Ratings | Learning |
Duels | Simulator | Badges | Friends.

**Screen 2 — Public profile (`/u/:id`):**
Same top card, but with Add Friend / Follow / Challenge / Block
buttons instead of Edit. Tabs show only the sections the owner
allows. Hidden sections show a short line: "This user hides their
duel history."

**Screen 3 — Edit profile (`/profile/edit`):**
Display name, bio, avatar upload, country (with the cooldown warning,
see 1.6), visibility switch, and the granular toggles in 1.5.
One Save button. All changes are validated by DTOs (Blueprint §8).
Invalid bio (link, phone number) returns a clear per-field error.

### 1.5 Privacy controls (granular toggles)

The main visibility switch is not enough. Each section has its own
toggle, all default ON for public profiles, OFF for private profiles:

- Show Learning Rating / Trading Rating / Candle Rating
- Show global + national rank and percentile
- Show learning progress (track, lessons done)
- Show duel history (list of past duels, opponent, result)
- Show simulator showcase (see 1.8)
- Show badges
- Show friends list
- Allow friend requests (off = no one can send a request)
- Allow duel challenges from non-friends (off = friends only)
- Show online status

Rule: if a toggle is OFF, the API returns `null` for that section,
not an empty list. The frontend cannot guess the real value.

### 1.6 Country (ISO code, change cooldown)

- Stored as an ISO 3166-1 alpha-2 code, e.g. `IN`. The user picks
  from a list at signup. No free text, so no fake country.
- Country is used for the national leaderboard and national rank
  (doc 04 §7). It is also shown on the profile.
- Change rule: max 1 change per 90 days. The change needs a reason
  (dropdown: moved country / wrong country at signup / other).
  The change is written to the audit log. The old country stays in
  rating history, so a user cannot change country, top a small
  leaderboard, and change back in the same season.
- A country change does not change the Rating number. It only
  changes which national leaderboard the user appears on, from the
  next season.

### 1.7 Career ladder (Intern to Market Expert)

Career title is derived from the **Candle Rating** (doc 04), not
typed by the user. It uses the same bands as the Rating tiers, so
the title and the tier always agree:

| Candle Rating  | Career title      | Tier     |
| -------------- | ----------------- | -------- |
| Below 1100     | Intern            | Bronze   |
| 1100–1299      | Analyst           | Silver   |
| 1300–1499      | Strategist        | Gold     |
| 1500–1699      | Risk Manager      | Platinum |
| 1700–1899      | Portfolio Manager | Diamond  |
| 1900 and above | Market Expert     | Master   |

XP level (1–10, from total XP) is a separate number. It is shown as
"Level 4" next to the career title, not instead of it. A user can
be Level 7 and still be an Intern if their Rating is low. That is
correct: XP measures effort, Rating measures skill.

### 1.8 Simulator portfolio showcase (virtual money only)

A profile may show a **showcase**, not a live portfolio:

- Virtual total equity (2-decimal string, e.g. "₹1,04,320.50").
- Virtual return this week / this season, as a percent.
- Top 3 fictional holdings by market value, by symbol only
  (e.g. NVLT, KVRF, ASTL). No quantities, no exact cash, no order
  history, no real holdings.
- A clear label on the showcase: "Virtual money only. Not real
  investing. Not investment advice."
- The showcase is OFF by default for new users. The user turns it
  on in privacy settings. If it is ON, it updates once per day,
  not live, so no one can copy-trade a user in real time.
- If the user has never opened the simulator, the showcase shows
  "No simulator activity yet", not ₹0.

### 1.9 Duel history on the profile

- List, newest first, paginated (20 per page, Blueprint §6).
- Each row: date, duel type, opponent display name, result
  (Won / Lost / Draw), score (e.g. 5–3), Rating change (+24 / −8),
  and a link to the post-game stats page for that duel (§3).
- Only rated duels appear here. Practice / bot duels do not.
- If the user hides duel history, the list is `null` for others.

### 1.10 Data model (new / changed, additive only)

```
User (existing, extended):
  bio             String?   max 160, no links/phone/email
  countryCode     String    ISO alpha-2, e.g. "IN"
  countryChangedAt DateTime?
  timezone        String    default "Asia/Kolkata", IANA name only
  language        String    default "en"
  profileVisibility ProfileVisibility  PUBLIC | FRIENDS | PRIVATE

UserPrivacySettings (new, one row per user):
  userId, showRatings, showRank, showLearningProgress,
  showDuelHistory, showSimulatorShowcase, showBadges,
  showFriendsList, allowFriendRequests, allowChallengesFromStrangers,
  showOnlineStatus

UserRating (from doc 04, not yet built — profile reads it, does not own it):
  userId, kind (LEARNING | TRADING), rating, gamesPlayed,
  wins, draws, losses, provisional, lastRatedAt, season, countryCode
```

No new table stores email or password. Privacy settings are read
on every public profile request, in the repository, not in the
frontend.

### 1.11 API sketch (profiles)

```
GET  /api/v1/users/me                 — my full profile (owner only)
PATCH /api/v1/users/me                — displayName, bio, country, timezone, language
GET  /api/v1/users/:id                — public profile, privacy-filtered
GET  /api/v1/users/:id/duels          — duel history, if allowed (paginated)
GET  /api/v1/users/:id/ratings        — ratings + rank + percentile, if allowed
PATCH /api/v1/users/me/privacy        — the toggles in 1.5
POST /api/v1/users/me/avatar          — existing, unchanged (Blueprint §10)
```

All responses use the standard envelope (Blueprint §7). All
mutations need auth. All reads of another user go through the
privacy filter.

---

## 2. Settings

Settings live in one place: `/settings`, with tabs. The user should
never have to hunt for a setting in three different screens.

### 2.1 Account

- Email: show current email, change email needs verification link
  to the new address. The old email stays active until the new one
  is verified. One change per 7 days.
- Password: change needs current password + new password (min 8
  chars, at least one letter and one number). After a password
  change, all other sessions are logged out, and the user gets an
  email: "Your password was changed."
- Display name: same rule as §1.3 (max 1 change per 30 days).
- Delete account: see 2.6. It is in Settings, not hidden in a help page.

### 2.2 Security

- **Sessions:** list of active sessions (device type, browser,
  city/country from IP, last active time). Each session has a
  Revoke button. "Revoke all other sessions" is one button.
  This is built on the existing refresh-token families
  (Blueprint §11): revoking a family logs that device out.
- **Login history:** last 20 logins (time, device, city/country,
  success / failed). Failed logins are shown so the user can see
  if someone tried their account. History is kept 90 days, then deleted.
- **Two-factor authentication (2FA): LATER, not v1.** v1 ships
  without 2FA. The design reserves the fields now (`twoFactorEnabled`,
  `twoFactorSecret` encrypted, backup codes hashed) so adding TOTP
  later does not need a redesign. Do not promise 2FA in v1 marketing.
- **Password reset:** existing flow (single-use, hashed, expiring
  token). No change in v1.

### 2.3 Notifications (granular, no spam)

Default: important notifications ON, marketing OFF. Every type has
its own switch. There is no single "all notifications" switch that
turns on marketing.

| Notification                          | Default | Channel                    |
| ------------------------------------- | ------- | -------------------------- |
| Duel invite from a friend             | ON      | In-app + push (if allowed) |
| Duel result / Rating change           | ON      | In-app                     |
| Rematch request                       | ON      | In-app                     |
| Friend request                        | ON      | In-app                     |
| New message from a friend             | ON      | In-app + push              |
| Community reply to my post            | ON      | In-app                     |
| Community mention                     | ON      | In-app                     |
| Streak reminder (once a day, evening) | ON      | Push only                  |
| Weekly league result (Monday)         | ON      | In-app                     |
| Season start / season result          | ON      | In-app                     |
| New lesson / new duel type            | OFF     | In-app                     |
| Product news / offers                 | OFF     | Email only, never push     |

Rules:

- Max 1 streak reminder per day, at a time the user picks
  (default 7 pm in their timezone). No reminder after 10 pm.
- No notification is sent for a blocked user, a muted community,
  or a duel the user did not join.
- Every email has an unsubscribe link that turns off that type only.
- Quiet hours: a setting (default 10 pm – 8 am). No push in quiet hours.
  In-app notifications still appear when the user opens the app.

### 2.4 Appearance / theme

- Theme: Light / Dark / System (default). Dark mode is a real theme,
  not an inverted filter. It is stored in settings, so it follows
  the user across devices.
- Font size: Normal / Large (accessibility, see 2.7).
- Reduce motion: ON/OFF. When ON, no confetti, no large animations.
  Lottie mentor animations (later) respect this setting.

### 2.5 Language and timezone

- Language: English only in v1. The field exists now (`en`), so
  adding Hindi later is a translation job, not a redesign.
  All user-facing strings go through one translation file, never
  hard-coded in two places.
- Timezone: IANA name, default `Asia/Kolkata`. The user can change
  it. Streaks are still computed in Asia/Kolkata in v1 (existing
  StreakService, do not change it in this phase). Timezone is used
  for display times and for the streak-reminder time. If timezone
  display and streak timezone ever differ, the UI says so clearly:
  "Streaks are counted in India time."

### 2.6 Data and privacy (DPDP, India)

India's DPDP Act applies. These are product features, not legal text:

- **Consent:** at signup, the user accepts Terms + Privacy Policy
  separately from marketing consent. Marketing consent is OFF by
  default and can be withdrawn any time in Settings.
- **Export my data:** one button. The user gets a file (JSON + CSV)
  with profile, progress, XP ledger, badges, duel history, simulator
  orders, posts, and messages. Generated as a background job, link
  valid 7 days, then deleted. Max 1 export per day.
- **Delete my account:** two steps. Step 1: "Delete account" asks
  for the password and shows what is deleted. Step 2: 30-day grace
  period. The account is deactivated at once (profile hidden,
  no login). After 30 days it is hard-deleted. If the user logs in
  during the grace period, deletion is cancelled. Posts are kept
  anonymised ("Deleted user") so community threads still make sense.
  Ratings history is kept anonymised for leaderboard integrity.
- **Children / minors:** v1 rule is 16+ to register (decision needed,
  see §9). If a younger user is found, the account is suspended
  until age is verified or a parent/guardian consents, as per DPDP.
  No targeted ads to minors, ever.
- **What we store, and for how long:** stated in the Privacy Policy.
  Login history 90 days, messages 1 year after the last message
  in a chat (unless reported — then kept until the report is closed),
  deleted posts kept 30 days for appeal, then hard-deleted.

### 2.7 Blocked users and accessibility

- **Blocked users:** in Settings → Privacy → Blocked users. Blocked
  users cannot see the profile, cannot send friend requests, cannot
  message, cannot challenge, and do not appear in the feed. Blocking
  is silent: the blocked user is not told. Unblock is one tap.
  Blocked list is private, never shown to others.
- **Accessibility:** keyboard navigation on all settings screens,
  focus visible, colour contrast checked, font-size setting (§2.4),
  reduce-motion setting (§2.4), screen-reader labels on all toggles.
  No feature is usable only by colour (e.g. win/loss is text + icon,
  not green/red only).

### 2.8 Data model (settings)

```
UserSettings (new, one row per user):
  userId, theme (LIGHT | DARK | SYSTEM), fontSize (NORMAL | LARGE),
  reduceMotion, language, timezone, quietHoursStart, quietHoursEnd,
  streakReminderTime, marketingConsent, createdAt, updatedAt

NotificationPreference (new, one row per user per type):
  userId, type (enum, see table in 2.3), inApp, push, email

UserSession (view over existing RefreshToken, no new table in v1):
  familyId, device, browser, ipCountry, lastActiveAt, createdAt

LoginEvent (new):
  userId, success, ip, country, device, createdAt (kept 90 days)

BlockedUser (new):
  blockerId, blockedId, createdAt
  @@unique([blockerId, blockedId])
```

### 2.9 API sketch (settings)

```
GET   /api/v1/settings/me
PATCH /api/v1/settings/me              — theme, language, timezone, quiet hours
GET   /api/v1/settings/notifications
PATCH /api/v1/settings/notifications   — per-type on/off
GET   /api/v1/settings/sessions
DELETE /api/v1/settings/sessions/:id  — revoke one session
DELETE /api/v1/settings/sessions      — revoke all other sessions
GET   /api/v1/settings/logins         — last 20 logins
POST  /api/v1/settings/export         — start data export (1 per day)
POST  /api/v1/settings/delete-account — start 30-day deletion
POST  /api/v1/settings/delete-account/cancel
GET   /api/v1/settings/blocked
POST  /api/v1/settings/blocked/:id
DELETE /api/v1/settings/blocked/:id
```

---

## 3. Post-game stats — after every duel and game, Matiks-style

After every duel, quiz, and simulator sprint, the user sees a
result screen. This is not a "You won!" popup. It is a short
report that teaches the user what happened and what to do next.
It is the same screen for a win and a loss.

### 3.1 When it appears

- After every rated duel, every practice duel, every daily challenge,
  and every quiz. One screen, same layout, different numbers.
- The screen is generated from stored answers, not from the
  frontend. If the user refreshes, the same stats appear.
- The screen is available for 30 days from the duel history
  (`/duels/:id/result`). After that, the summary stays, the
  per-question detail is archived.

### 3.2 Exact stats fields and how each is computed

**Header:**

- `result`: WON / LOST / DRAW. For a solo quiz: PASSED / FAILED.
- `score`: my points vs opponent points, e.g. 5–3. Points per
  question = base 100 + speed bonus (max 50, less the longer you
  take). A wrong answer = 0 points for that question.
- `durationSeconds`: time from first question shown to last answer.
- `ratingChange`: e.g. +24 or −8, with the new Rating next to it.
  Computed by the Ratings formula (doc 04 §3). The screen also
  shows one line explaining it: "You beat a stronger player
  (1400), so you gained more." No formula is shown to the user,
  only the reason in plain words.

**Accuracy:**

- `accuracyPct` = correct / total × 100. Example: 5 correct of 7 = 71%.
- `correctCount`, `wrongCount`, `skippedCount` (no answer in time
  counts as skipped, not wrong).
- `avgTimePerQuestionMs` = sum of answer times / total questions.
- `fastestAnswerMs`, `slowestAnswerMs`.
- `bestStreakInGame`: longest run of correct answers in a row
  inside this duel (not the daily streak).

**Breakdown by topic (the most useful part):**
For each topic in the duel (e.g. compounding, risk, budgeting):

- `topic`, `total`, `correct`, `accuracyPct`, `avgTimeMs`.
- Topics are sorted worst first, so the user sees the weakness first.

**Breakdown by question (tap to expand):**
For each question: question text, my answer, correct answer,
time taken, points, and the 1–3 sentence explanation from the
question bank. The opponent's answer is shown as correct / wrong
only, never their exact answer text if it would reveal a question
the opponent has not finished in an async duel.

**XP and streak:**

- `xpGained`: total XP from this game, with a breakdown:
  e.g. "Win +20 XP, 5 correct +10 XP, streak day +5 XP = 35 XP".
  XP is read from the XpLedger, never computed in the frontend.
- `totalXp`, `level`, `levelUp` (true/false), `xpToNextLevel`.
- `currentStreak`, `longestStreak`, `streakContinued` (true if
  today counted as a new streak day).

**Strengths and weaknesses:**

- Strength: any topic with accuracy ≥ 80% and at least 2 questions.
  Shown as "You are strong in Compounding (100%)."
- Weakness: any topic with accuracy < 50% and at least 2 questions.
  Shown as "Work on Risk (33%)."
- If a topic has only 1 question, it is not called a strength or
  a weakness. One question is not enough proof.

**What to practise next (the retention hook):**

- One link, not a list of ten: "Practise Risk — Lesson 3, Risk
  Basics (5 min)". The link is the lesson for the weakest topic.
  If there is no weakness, the link is "Try a harder duel" or
  "Next lesson in your track".
- The link is computed from the topic → lesson map in the
  curriculum. If no lesson exists for that topic, the link is
  hidden, never a broken link.

**Trading duel stats (for Paper Trading Sprint / Crisis Duel):**

- `returnPct`: (final equity − starting equity) / starting equity × 100.
- `indexReturnPct`: the simulated index return for the same period.
- `outperformancePct`: my return − index return.
- `maxDrawdownPct`: largest fall from a peak during the duel.
- `tradesCount`, `winningTrades`, `losingTrades`.
- `riskScore`: a simple 0–100 score from drawdown and trade count.
  High return with a huge drawdown scores lower than a smaller
  return with a small drawdown. This is why reckless all-in bets
  do not win (doc 05 §1, T1).
- Same Rating change, XP, and "what to practise next" as above,
  but the practice link points to a Risk lesson.

### 3.3 Shareable result card

- Button: "Share result". It creates a card image (server-generated,
  not a screenshot): "I won a Speed Quiz Duel 5–3! Candle Rating
  1224 (+24). Accuracy 71%." Plus the Candle logo.
- The card never shows: email, exact portfolio, opponent's full
  name (only first name + last initial, if the opponent allows
  sharing), or any question text. Questions are never shared, or
  they leak into the next duel.
- Sharing is a link + image. The link opens the public result page,
  which shows only the summary, not the per-question answers.

### 3.4 Rematch button

- One button: "Rematch". It sends a rematch request to the same
  opponent. The opponent has 60 seconds to accept in a live duel,
  or the request stays in their inbox for an async duel.
- Rematch respects the anti-farming rule (doc 05 §3.3): max 3 rated
  duels per day against the same pair, 5-minute cooldown between
  rematches. If the cap is reached, the button says "Play a new
  opponent" instead, and offers a bot duel.
- Rematch is one tap, no re-queue, no new search screen.

### 3.5 UI screen (`/duels/:id/result`)

Top: result (Won/Lost/Draw) + score + Rating change.
Second row: accuracy ring, avg time, best streak in game.
Third: XP gained + level progress bar + streak.
Fourth: topic breakdown bars (worst first).
Fifth: per-question list (expandable).
Sixth: strengths / weaknesses + "Practise next" card.
Bottom: Share, Rematch, New Duel, Back to Dashboard.
The whole screen fits on a phone without horizontal scrolling.
Numbers are large, labels are short, and no jargon is used.

### 3.6 Data model (post-game stats)

No new table stores the stats. Stats are **computed** from tables
that already exist (doc 05 §6 + doc 04 §8):

```
duel (existing design): id, type, status, players, winnerId, season
duel_answer: duelId, userId, questionId, answerId, correct, timeMs, points
user_ratings + rating_history: ratingBefore, ratingAfter, delta, K
xp_ledger: XP for this duel, by idempotency key
user_stats: totalXp, level, currentStreak, longestStreak
```

One new table is needed, for the share card and the 30-day archive:

```
GameResult (new):
  duelId (unique), userId, summaryJson (the computed stats above),
  shareToken (random, unguessable), createdAt
```

The summary is computed once, at duel end, in the same transaction
as the Rating update and XP grant, and stored. It is never
recomputed from raw answers on every page view.

### 3.7 API sketch (post-game stats)

```
GET /api/v1/duels/:id/result        — my result screen (owner or opponent only)
GET /api/v1/duels/:id/result/share  — public summary by share token (no answers)
POST /api/v1/duels/:id/rematch      — send a rematch request
POST /api/v1/duels/:id/share        — create / refresh a share card
```

---

## 4. Chat and friends

### 4.1 Friends vs follows (two different things)

- **Follow:** one-way. I follow you, I see your public posts and
  your public duel results in my feed. You do not have to follow
  me back. No approval needed. Unfollow any time.
- **Friend:** two-way, needs approval. Friends can 1-to-1 chat,
  send duel challenges, and see friends-only profile sections.
  A friend request must be accepted. No auto-accept.

A user can follow someone without being friends. A user cannot
chat with someone who is not a friend, except in a duel chat
(see 4.3) and in a community (see §5).

### 4.2 Friend requests (flow)

1. User A taps "Add Friend" on User B's profile.
2. If B has "Allow friend requests" OFF, A sees "This user does
   not accept friend requests." No request is created.
3. If B has blocked A, A sees the same generic message. B is never
   revealed as the blocker.
4. Request is stored as PENDING. B sees it in Friends → Requests.
5. B accepts → both become friends. B declines → request is deleted.
   A is not told "declined", only that the request is no longer pending.
6. One pending request per pair. Sending again does nothing.
7. Limits: max 20 pending sent requests, max 500 friends.
   These limits stop spam and stop one account farming friends.
8. Unfriend: one tap, silent. The other user is not told. Chat
   history is kept for both users (see 4.4), but no new messages
   can be sent.

### 4.3 Chat (1-to-1 first, groups later)

**v1: 1-to-1 chat between friends only. Group chat is LATER, not v1.**

- Chat list (`/chat`): friends with a chat, sorted by last message
  time. Each row: avatar, display name, last message preview
  (first 40 chars), time, unread count.
- Chat screen (`/chat/:friendId`): messages, newest at the bottom.
  Text only in v1. No images, no voice, no files in v1.
  Max message length 1,000 chars. Max 30 messages per minute per
  user (rate limit, stops spam).
- **Duel chat:** a temporary chat inside a duel, for the two players
  only. It opens when the duel starts and closes when the duel ends
  - 10 minutes. Messages are short (max 200 chars) and are shown
    on the duel screen. No duel chat in an async duel.
- **Online status:** Online / Offline only, from the WebSocket
  presence (see 4.6). Shown in the chat list and on a friend's
  profile, only if that friend allows it (§1.5).
- **Read receipts:** "Seen" only, no "typing…" in v1. Typing
  indicator is a later feature.
- **Invite links:** a friend can send a duel challenge from chat
  with one button: "Challenge to a Speed Quiz Duel". The challenge
  is a message with Accept / Decline buttons. Accept starts
  matchmaking for that duel type.

### 4.4 Message rules (safety first)

- No phone numbers, no email addresses, no links to external
  social media, no home address. If a message contains one, it is
  blocked before sending, with a message: "Do not share personal
  contact info on Candle. Keep chatting here."
- No personalised buy/sell recommendations. If a message says
  "Buy NVLT now" or "Sell this, it will double", it is blocked
  with: "Candle is for learning, not for tips. Talk about the
  idea, not a buy/sell call." The exact filter list is in the
  moderation config, not in the chat code.
- No return promises ("you will make 50%"), no "guaranteed profit".
- Messages are stored encrypted at rest (database encryption),
  and are deleted 1 year after the last message in that chat,
  unless a report is open (see 4.5).
- The user can delete their own messages (delete for everyone
  within 10 minutes, delete for me after that). Deleted messages
  show "Message deleted", not the old text.

### 4.5 Blocking and reporting in chat

- Block (from chat or profile): stops all messages, friend requests,
  and challenges. Silent. The blocked user sees a generic error
  if they try to message.
- Report message: long-press a message → Report → reason
  (spam / harassment / investment tip / personal info / other).
  The reported message + the last 10 messages in that chat are
  sent to the moderation queue. The reporter stays anonymous to
  the reported user.
- Report user: same flow, from the profile. Three valid reports
  against one user in 30 days triggers a human review, not an
  auto-ban.
- False reports are tracked. A user who reports many messages
  that are all cleared gets a warning, then their reports are
  given lower priority.

### 4.6 How chat works (technical, short)

- Transport: the same WebSocket gateway as duels (doc 05 §3.2),
  a new `social` namespace, same auth (JWT in handshake),
  same sticky sessions, same Redis adapter.
- Presence: when a user connects, Redis sets `online:{userId}` with
  a 60-second expiry, refreshed by a heartbeat. When it expires,
  the user is offline. No "last seen" time is stored.
- Messages: sent by WebSocket, stored in Postgres in the same
  request, then delivered. If the friend is offline, the message
  is stored and shown as unread when they return. No message is
  lost if the WebSocket drops: the client re-fetches the last
  50 messages on reconnect.
- Rate limits: 30 messages per minute per user, 5 friend requests
  per hour, 10 duel challenges per hour. Limits are in Redis,
  keyed by user id.

### 4.7 Data model (social)

```
Friendship (new):
  userId, friendId, status (PENDING | ACCEPTED | BLOCKED),
  requestedBy, createdAt, updatedAt
  @@unique([userId, friendId]) — one row per direction, both rows
  are created on accept, so a query is always one row

Follow (new):
  followerId, followingId, createdAt
  @@unique([followerId, followingId])

ChatMessage (new):
  id, chatId, senderId, body (max 1000), createdAt, deletedAt,
  reportedAt
  chatId = "dm:{smallerUserId}:{largerUserId}" — one chat per pair

ChatRead (new):
  chatId, userId, lastReadAt
```

### 4.8 API sketch (social)

```
POST /api/v1/social/friends/:id/request
POST /api/v1/social/friends/:id/accept
POST /api/v1/social/friends/:id/decline
DELETE /api/v1/social/friends/:id
GET  /api/v1/social/friends
GET  /api/v1/social/friends/requests
POST /api/v1/social/follow/:id
DELETE /api/v1/social/follow/:id
GET  /api/v1/social/chats
GET  /api/v1/social/chats/:friendId/messages?before=
POST /api/v1/social/chats/:friendId/messages
POST /api/v1/social/chats/:friendId/read
POST /api/v1/social/report/message/:id
POST /api/v1/social/report/user/:id
```

WebSocket events (namespace `/social`):
`chat:message`, `chat:read`, `presence:online`, `presence:offline`,
`friend:request`, `friend:accepted`, `duel:challenge`.

---

## 5. Communities and posts

### 5.1 What a community is

A community is a topic room where users post their point of view
(POV), ask questions, and learn from each other. It is not a
trading-tips group. It is not a chat room. Posts stay, so a good
answer helps the next user too.

Seed communities at launch (admin-created, no user creation in v1):

- Budgeting Basics
- Stock Basics
- Mutual Funds 101
- Risk and Safety
- Money Mindset
- Ask Mira (questions for the mentor cast, answered by moderators)

User-created communities are LATER, not v1. One bad community
created on day one is harder to fix than a slow rollout.

### 5.2 Posts by POV

A post is a point of view, a question, or a lesson learned. Not a tip.

**Post types (v1):**

| Type          | What it is                                     | Rules                                                                                                                                                        |
| ------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Text post     | Title (max 120 chars) + body (max 2,000 chars) | No links to external sites in v1. No phone/email.                                                                                                            |
| Poll          | Question + 2–4 options, 7-day vote             | One vote per user. Results shown after voting. No "which stock will go up" polls.                                                                            |
| Chart post    | A chart image from the simulator only          | The image is generated from the user's virtual portfolio, with fictional symbols only. No uploaded chart screenshots in v1, so no real tickers can sneak in. |
| Question post | A question, tagged with a topic                | Same as text, but the UI shows "Question" and the best answer can be marked as helpful by the author.                                                        |

**What a post is NOT:** a buy/sell call, a return promise, a
screenshot of a real broker account, a link to a paid course, or
an ad. All of those are removed on report, and the author is warned.

### 5.3 Votes, comments, follows

- **Upvote / downvote:** one vote per user per post. Upvote = helpful
  or interesting. Downvote = not helpful or wrong. Score = upvotes −
  downvotes. The author sees the score, not who voted.
- **Comments:** text only, max 500 chars, one level deep (a comment
  can have replies, but a reply cannot have replies). Max 3 comments
  per minute per user. The post author can mark one comment as
  "Helpful answer" for a Question post.
- **Follow a topic / user:** following a community shows its posts
  in My Feed. Following a user shows their public posts in My Feed.
  Unfollow any time. Following is not friendship and does not allow chat.
- **Save a post:** bookmark for later. Private, only the user sees it.

### 5.4 Feed ranking (new + top, not engagement-bait)

The feed is not "most angry post wins". Ranking is:

```
score = (upvotes − downvotes) × qualityWeight
      + recencyBonus (new posts get a boost for 24 hours)
      − reportPenalty (reported posts drop, hidden after 3 reports)
```

- **My Feed:** posts from communities I joined + users I follow,
  sorted by the score above, newest first within a similar score.
- **Top this week:** highest score in the last 7 days, per community
  and globally.
- **New:** newest posts, no ranking. This is how a new post gets seen.
- No infinite scroll that never ends. The feed is paginated (20 per
  page). After 3 pages, the user sees "You are caught up. Try a duel
  or a lesson." That is a retention choice, not a bug: the feed
  should send users back to learning, not keep them scrolling.

### 5.5 Community rules (shown on every community page)

Short rules, in simple English, on every community page and on the
post composer:

1. Be kind. No hate, no abuse, no personal attacks.
2. Learning only. No buy/sell tips, no "this stock will double".
3. No real money, no real tickers, no broker screenshots.
4. No links, no ads, no paid courses, no personal contact info.
5. Your POV is welcome. Say "I think…" not "You must…".
6. If you are not sure, say so. A wrong answer with confidence
   is worse than a question.

Breaking a rule: warning → 24-hour mute → 7-day mute → ban from
that community → ban from all communities. Each step is logged
and can be appealed (see 5.6).

### 5.6 Moderation (automated + human)

**Automated (runs before a post is visible):**

- Banned-word list (abuse, slurs, spam words). Match = post held
  for review, author told "Your post is under review."
- Link / phone / email detector. Match = post blocked, with the
  reason in plain words.
- Buy/sell tip detector (phrases like "buy now", "will double",
  "guaranteed", a real ticker pattern). Match = post held for review.
- Image check: only simulator-generated charts are allowed in v1,
  so no uploaded image needs a check yet. When uploads open later,
  images go through the same StorageService validation (Blueprint §10)
  plus a moderation scan.
- Rate limits: 5 posts per hour, 10 comments per hour, 3 reports
  per hour. These stop spam without hurting a normal user.

**Human (moderators):**

- Moderators are trusted users (later: paid staff). They see a
  queue: reported posts, held posts, and appeals. They can approve,
  remove, mute, or ban. Every action is logged with who did it
  and why.
- A post with 3 reports is hidden at once (pending review), not
  after a human reads it. The author can appeal. If the appeal
  wins, the post is restored and the reports are marked as false.
- Appeals: the user writes one short appeal. A different moderator
  reviews it. The decision is final for that post.

**Disclaimer:** every community page and every post composer shows:
"Posts are other users' views, not Candle's views. This is
education only, not investment advice."

### 5.7 Data model (community)

```
Community (new, admin-seeded in v1):
  id, slug (unique), name, description, iconKey, memberCount,
  createdAt, isActive

CommunityMember (new):
  communityId, userId, role (MEMBER | MODERATOR), joinedAt
  @@unique([communityId, userId])

CommunityPost (new):
  id, communityId, authorId, type (TEXT | POLL | CHART | QUESTION),
  title, body, chartData (JSON, simulator only, null otherwise),
  status (VISIBLE | HELD | REMOVED), createdAt, updatedAt, deletedAt

PostVote (new):
  postId, userId, value (+1 | -1), createdAt
  @@unique([postId, userId])

PostComment (new):
  id, postId, authorId, parentId (null for top-level), body,
  status, createdAt, deletedAt

PollVote (new):
  postId, userId, optionIndex, createdAt
  @@unique([postId, userId])

PostReport (new):
  id, postId (or commentId), reporterId, reason, status
  (OPEN | CLEARED | ACTIONED), moderatorId, createdAt

SavedPost (new):
  userId, postId, createdAt
  @@unique([userId, postId])
```

### 5.8 API sketch (community)

```
GET  /api/v1/community/communities
GET  /api/v1/community/communities/:slug
POST /api/v1/community/communities/:slug/join
POST /api/v1/community/communities/:slug/leave
GET  /api/v1/community/feed?scope=my|top|new
POST /api/v1/community/posts
GET  /api/v1/community/posts/:id
PATCH /api/v1/community/posts/:id        — author only, within 10 min
DELETE /api/v1/community/posts/:id       — author or moderator
POST /api/v1/community/posts/:id/vote    — { value: 1 | -1 }
POST /api/v1/community/posts/:id/comments
POST /api/v1/community/posts/:id/save
POST /api/v1/community/posts/:id/report
POST /api/v1/community/posts/:id/poll/vote
GET  /api/v1/community/moderation/queue  — moderators only
POST /api/v1/community/moderation/:reportId/action
```

---

## 6. Safety, legal, and privacy guardrails (whole doc)

These rules apply to profiles, chat, and community together.
If a new feature breaks one of them, the feature does not ship.

1. **No personalised advice, ever.** No buy/sell calls, no entry
   or exit targets, no return promises, no "I will manage your
   money". Mentors give general education only, unless they are
   separately SEBI-registered for advice (Blueprint §16).
2. **No real tickers, no real money.** Fictional symbols only.
   Virtual money only. A post, chat message, or profile that
   shows a real ticker or a real broker balance is removed.
3. **No personal contact info.** No phone, email, address, or
   social-media handle in bio, posts, comments, or chat. The
   filter blocks it, and a report removes it.
4. **Minors:** v1 is 16+ (decision in §9). No targeted ads to
   minors. No private chat with a minor from an adult who is not
   a friend, and no friend request from an adult to a minor
   without a shared community or duel history. If this rule is
   hard to enforce, the safer v1 is: no 1-to-1 chat for users
   under 18, only community posts and duel chat.
5. **DPDP (India):** consent, export, delete, and data-retention
   rules from §2.6 apply to chat and community data too.
   A deleted user's posts stay anonymised, their messages are
   deleted after the grace period, and their Ratings history is
   kept anonymised.
6. **Audit logs:** every moderation action, every block, every
   country change, every account deletion, and every admin action
   is written to the append-only audit log (existing AuditLog
   table). Who did it, what they did, when. No silent admin actions.
7. **Reports are safe:** reporting is anonymous to the reported
   user. Reporting never bans the reporter. A user who is reported
   is told what rule they broke, not who reported them.
8. **No dark patterns:** no "your friend is beating you" spam,
   no streak-freeze sold as a trap, no pay-to-win Rating, no
   infinite feed. Retention comes from good duels and good
   lessons, not from fear.

---

## 7. Retention — how this doc feeds the loops from doc 05

Doc 05 set the loops: daily, weekly, season, social. This doc
is the social half of those loops.

**Daily loop:** Daily Duel → post-game stats screen (§3) →
"Practise next" lesson link → streak +1 → a friend sees the
result in their feed → rematch. One duel creates the next duel.

**Weekly loop:** Weekly League (30 users, top 3 up, bottom 3 down)
→ league position on the profile (§1) → weekly Portfolio Battle
→ league result notification on Monday (§2.3) → a community post
"My league week" (optional, never auto-posted).

**Season loop:** Season Rating (doc 04 soft reset) → season title
on the profile → season badge → a community thread for the new
season. A lapsed user returns to a new season, not to the bottom
of an old leaderboard.

**Social loop:** Friend request → duel challenge → duel chat →
post-game stats → share card → a friend joins Candle from the
share link → new friend request. Each step is one tap, and no step
needs a payment.

**What we measure (targets for the first social launch):**

- Post-game screen viewed: > 90% of finished duels.
- Rematch rate: > 25% of finished duels.
- Friend request accept rate: > 50%.
- Chat messages per active user per week: > 3 (friends only).
- Community posts per week per active community: > 20, with
  at least 50% getting a comment or an upvote.
- Report rate: < 2% of posts. A higher rate means moderation
  or the rules are wrong, not that users are bad.

---

## 8. Build order — which piece first

Each step is a complete module. No step starts until the previous
step is reviewed. Dependencies on Phase 3 are named, so nothing
is built on a Rating that does not exist yet.

**Step A — Profiles v1 (first, no Phase 3 dependency).**
Extend `users`: bio, country, timezone, language, visibility,
privacy toggles, career title from XP level only for now
(Rating title comes in Step B). UI: My profile + public profile

- edit screen. This is the foundation every other step reads.

**Step B — Settings v1 (with Step A).**
New `settings` module: account, sessions, login history,
notifications, theme, language, timezone, export, delete,
blocked list. 2FA is reserved, not built.

**Step C — Post-game stats v1 (needs Phase 3, first duel).**
`game-results` inside the `duels` module. Built with the first
live duel (Speed Quiz Duel, doc 05 Step 3). No post-game screen
without a duel to show it for. Share card + rematch in the same step.

**Step D — Friends + 1-to-1 chat v1 (needs Step A).**
`social` module: friend requests, follows, 1-to-1 chat, presence,
block/report. No group chat. Duel chat in the same step, because
it uses the same gateway as duels.

**Step E — Community v1 (needs Steps A + D for moderation).**
`community` module: 6 seeded communities, text + poll + question
posts, votes, comments, feed (My / Top / New), moderation queue,
report/appeal. Chart posts in the same step, because they reuse
the simulator showcase data from Step A.

**Step F — Later, not v1:**
Group chat, user-created communities, community submissions to
the question bank, 2FA, Hindi language, mentor chat, paid Pro
social features. Each one gets its own design note before it is built.

If Phase 3 slips, Steps A and B can still ship. Steps C, D, and E
wait for the Ratings and duels they depend on. Do not build a
community on top of a Rating that does not exist yet.

---

## 9. Definition of Done (per step, no exceptions)

- [ ] Module follows the Blueprint template; no core file edited
      without an ADR.
- [ ] DTO validation on every endpoint; invalid input tested.
- [ ] Standard response envelope on every endpoint.
- [ ] Auth + RBAC + ownership + privacy checks tested, including
      negative cases (user A cannot read user B's private data).
- [ ] File handling (avatar, chart image) follows Blueprint §10.
- [ ] Migration reviewed and applied; transaction boundaries correct.
- [ ] Unit + integration + e2e tests passing in CI.
- [ ] OpenAPI + module README updated.
- [ ] Logs, requestId, and error codes verified; no secrets in logs.
- [ ] Moderation / report / block paths tested by hand.
- [ ] Manual QA checklist for the step completed.

---

## 10. Approval — decisions, ALL DECIDED by Nishu on 2026-11-12

All 10 decisions are now locked. No code starts until the build
is authorised separately — these decisions only lock the design.

1. **Minimum age: 16+.** (Decided 2026-11-12.) This decides the
   minors rule in §6.4.
2. **Career title: from Candle Rating** (§1.7), not from XP level.
   (Decided 2026-11-12.)
3. **Simulator showcase: ON by default.** This overturns the
   §1.8 draft ("OFF by default") — the profile shows the simulator
   showcase unless the user turns it off. (Decided 2026-11-12.)
4. **Country change: locked after signup.** Country is set at
   signup and defined by the mobile number code (country dialling
   code). No change flow in v1. (Decided 2026-11-12.)
5. **Chat for under-18 users: 1-to-1 chat is allowed** for ages
   16–17. Nishu's reason: Matiks allows it, and Matiks allows
   13+ users. Candle's minimum age stays 16+, so this applies to
   16–17-year-olds only. (Decided 2026-11-12.)
6. **Group chat: later, not v1.** (Decided 2026-11-12.)
7. **User-created communities: later, not at launch.** Only the
   6 seeded communities at launch. (Decided 2026-11-12.)
8. **Post-game share card: simple text + link is enough for v1.**
   Nishu said "server image or simple text etc for v1" — either is
   acceptable, so v1 builds the simple version first; a
   server-generated card image is a later upgrade, not a v1
   requirement. (Decided 2026-11-12.)
9. **Notification default: yes — 1 streak reminder per day, at
   7 pm, with quiet hours 10 pm–8 am.** The reminder is delivered
   in the character emotions widget style (a mentor character
   reacting, not a plain push). (Decided 2026-11-12.)
10. **Build order: Step A (Profiles v1) + Step B (Settings v1)
    first, then Step C (post-game stats).** Chat/friends do NOT
    come before settings. (Decided 2026-11-12.)

**Extra rule decided 2026-11-12 (duel history on profiles):**
show only the last 5 games of each duel type separately — no
total/full history view. A profile shows, per duel type, the
last 5 games of that type.

Approved by: Nishu Shukla Date: 2026-11-12
