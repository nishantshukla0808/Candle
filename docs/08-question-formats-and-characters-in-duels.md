# Candle — Duel Inventory, Characters in Duels, and Predeclared Question Formats

**Date:** 2026-11-12
**Status:** DESIGN + INVENTORY — verified against the code on 2026-11-12.
The format registry in §3 is binding: no question format may be used
in the bank or in a duel until it has a registry entry here, an API
shape, and a frontend renderer for it.
**Depends on:** Blueprint 01, Ratings doc 04, Duels doc 05, Phase 4 doc 07.

---

## 1. Which duels are built, and which are remaining

Verified from `apps/api/src/modules/duels/`, `apps/api/prisma/schema.prisma`
(`DuelType` enum), and docs 05/07.

### Built (Phase 3 + Phase 4 + Phase 5 + Phase 6 + Phase 7 + Phase 8 + Phase 9 + Phase 10 + Phase 11 + Phase 12, tested)

| Duel                         | Code                                                                                                                  | Type in code                             | Rated?                                                                                                                                      | Status                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Friend Challenge (P2)        | — (a start-mode, not a `DuelType` — the duel it starts is a normal LIVE / BLITZ / CASE / CHART / SPRINT / CRISIS row) | Invite-only start-mode, any rated format | Yes — rated by default (ADR 0014 §3; no unrated toggle — the invite shows both Ratings, so accepting with the stakes visible IS the opt-in) | **Built, Phase 12.** Direct invite link `/duels/challenge?code={inviteCode}`, 24 h expiry, one pending per pair per type, accept starts the duel at once via the existing engines (no queue, no new socket namespace), 10 creates/user/hour, same-pair 3/day + 10/day rated caps at settlement, 5-minute rematch cooldown at accept.                                                                                                   |
| -------------------------    | -----------------                                                                                                     | --------------------------               | ----------------------------                                                                                                                | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------                     |
| Bot Duel (P1)                | `DuelType.BOT`                                                                                                        | Practice vs Mira                         | No — XP/streak only                                                                                                                         | **Built, Phase 4.** 7 questions, 15 sec each, Mira adaptive to Learning Rating, 10/day IST.                                                                                                                                                                                                                                                                                                                                            |
| Async Daily Duel (L5)        | `DuelType.DAILY`                                                                                                      | Learning, async                          | Yes — 1/day, Learning Rating                                                                                                                | **Built, Phase 4.** Same 5-question IST set for all players, pairing in finish order, unpaired settled vs Mira.                                                                                                                                                                                                                                                                                                                        |
| Live Speed Quiz Duel (L1)    | `DuelType.LIVE`                                                                                                       | Live head-to-head                        | Yes — Learning Rating                                                                                                                       | **Built, Phase 5.** WebSocket gateway, Redis matchmaking, 7 questions, 15 sec each, same set both players, Mira host. MCQ_4 + TRUE_FALSE only.                                                                                                                                                                                                                                                                                         |
| Myth vs Fact Blitz (L2)      | `DuelType.BLITZ`                                                                                                      | Live head-to-head                        | Yes — Learning Rating                                                                                                                       | **Built, Phase 6.** Same live engine, parameterised by variant. 10 rapid TRUE_FALSE questions, 10 sec each, streak bonus (+10/+20/+30, cap +30), separate BLITZ queue, Mira host.                                                                                                                                                                                                                                                      |
| Case Duel (L3)               | `DuelType.CASE`                                                                                                       | Live head-to-head                        | Yes — Learning Rating                                                                                                                       | **Built, Phase 7 Stage 2.** Same live engine, parameterised by variant. 5 CASE_CHOICE cases, 45 sec each, option points (100/50/0) + speed bonus ≤ 20, winner by points, reason window 10 s, separate CASE queue, Kabir host.                                                                                                                                                                                                          |
| Chart Detective (L4)         | `DuelType.CHART`                                                                                                      | Live head-to-head                        | Yes — Learning Rating                                                                                                                       | **Built, Phase 8 Stage 2.** Same live engine, parameterised by variant. 5 CHART_CHOICE charts, 30 sec each, standard live scoring (100 + ≤ 50 speed bonus), winner by correct count, annotation on reveal, separate CHART queue, Kabir host.                                                                                                                                                                                           |
| Paper Trading Sprint (T1)    | `DuelType.SPRINT`                                                                                                     | Live head-to-head, trading               | Yes — Trading Rating                                                                                                                        | **Built, Phase 9.** Separate trading engine (not the question engine). 15 min, same fictional market, virtual ₹100,000 each, BUY/SELL/HOLD, winner by risk-adjusted return, own sprint queue on the Trading Rating, Mira bot after 30 s, Tara host.                                                                                                                                                                                    |
| Crisis Duel (T2)             | `DuelType.CRISIS`                                                                                                     | Live head-to-head, trading               | Yes — Trading Rating                                                                                                                        | **Built, Phase 10.** Variant of the sprint engine (not a second engine). 15 min, same fictional market, virtual ₹100,000 each, BUY/SELL/HOLD, plus a seeded crash at minute 7–10 (all 6 instruments fall ~12% over 3 minutes, then recover ~5%), winner by crisis risk-adjusted return, own crisis queue on the Trading Rating, Mira bot after 30 s (sells everything to cash on the first crash tick), Tara host.                     |
| Weekly Portfolio Battle (T3) | — (no `DuelType.WEEKLY` — a season of leagues, not a 1v1 duel)                                                        | Async, week-long, trading                | Yes — Trading Rating                                                                                                                        | **Built, Phase 11.** Separate weekly engine (not the question engine, not the live engine). 1-week seasons (Mon 00:00 IST–Sun 23:59 IST), same fictional market, virtual ₹100,000 each, BUY/SELL/HOLD via REST, leagues of 30 seeded by Trading Rating, top 3 promoted / bottom 3 demoted every Monday, winner by risk-adjusted return, Trading Rating vs the market index, manual ADMIN settlement, Anaya host. Tournaments deferred. |
| Question Bank (Step 1)       | —                                                                                                                     | Foundation for all duels                 | —                                                                                                                                           | **Built, Phase 3+4+7 Stage 1+8 Stage 1.** 620 LIVE items, 461 MCQ_4 + 59 TRUE_FALSE + 50 CASE_CHOICE + 50 CHART_CHOICE.                                                                                                                                                                                                                                                                                                                |

That is 10 duel types built out of the 10 in the catalogue — **all
duels complete.** The first trading duel is built. The
live mix is unchanged: Speed Quiz = MCQ_4 + TRUE_FALSE only, Blitz
= TRUE_FALSE only, Case Duel = CASE_CHOICE only, Chart Detective
= CHART_CHOICE only (doc 08 §4, §3.1/§3.2/§3.3/§3.4).

### Remaining (doc 05 §7, in build order)

| Step | Duel                         | Format                                                    | Rated?        | Needs                                                               |
| ---- | ---------------------------- | --------------------------------------------------------- | ------------- | ------------------------------------------------------------------- |
| 3    | Speed Quiz Duel (L1, live)   | 7 questions, live head-to-head, same set                  | Yes, Learning | WebSocket gateway, matchmaking, sticky sessions, live timer         |
| 4    | Myth vs Fact Blitz (L2)      | 10 rapid true/false, 10 sec each                          | Yes, Learning | TRUE_FALSE bank depth + live engine from Step 3                     |
| 5    | Case Duel (L3)               | Same case, best action + reason, rubric scored            | Yes, Learning | CASE_CHOICE format (§3.3) + rubric                                  |
| 6    | Chart Detective (L4)         | Same fictional chart, trend/risk/safest step              | Yes, Learning | CHART_CHOICE format (§3.4) + seeded chart generator                 |
| 9    | Weekly tournaments (bracket) | Single-elimination bracket inside/after the weekly league | Yes, Trading  | Tournament seeding/match/scheduling design (deferred, ADR 0013 §10) |

Friend Challenge was Step 10 in doc 05 §7 and is **BUILT (Phase 12,
docs/17, ADR 0014)** — it is not a separate engine, it is a way to
start Steps 3–8 with a chosen opponent instead of a matched one.
Nothing in the duel catalogue remains unbuilt.

---

## 2. Characters in duels — yes, and how

Characters are already in duels in a small way, and the design below
extends that without breaking the "animation later" rule.

### 2.1 What exists today

- **Mira is the Bot Duel opponent.** She is simulated server-side
  (`bot-simulation.ts`), with accuracy and timing matched to the
  player's Learning Rating. The result screen names her as the
  opponent. She is not a picture yet in the duel UI — she is a
  named, behaving opponent, which is the part that matters for
  gameplay.
- The six mentors (Mira, Kabir, Tara, Dev, Anaya, Rey) exist as a
  cast in the blueprint and in the design-concept prototype, but
  they are not yet in the duel screens.

### 2.2 The rule for characters in duels

1. A character is a **host, coach, or opponent — never a hint giver
   during a rated question.** A character must never reveal an answer,
   a correct option, or a trading action while the timer is running.
   Characters speak before the duel, between questions, and after
   the duel — not during a question.
2. One character per duel type, so the player learns who to expect:
   - Bot Duel + Daily Duel: **Mira** (Daily Coach)
   - Speed Quiz + Myth vs Fact: **Mira** (host) — same host, same format family
   - Case Duel: **Kabir** (Analyst) presents the case
   - Chart Detective: **Kabir** presents the chart
   - Paper Trading Sprint + Crisis Duel: **Tara** (Risk Guardian) hosts
   - Weekly Portfolio Battle: **Anaya** (Portfolio Architect) hosts
   - A duel's post-game stats screen is always presented by its host.
3. Characters react to the **result, not to individual answers:**
   win / draw / loss, Rating up / down, a new best streak, a topic
   to practise. Reactions are a short line of text + a mood
   (happy / encouraging / calm), never a taunt, never a shaming line.
4. **Lottie animation is still deferred.** Until the animation work
   is done, a character appears as: a named avatar (initials + colour
   - role tag, from the existing avatar system), a one-line dialogue
     bubble, and a mood tag. When Lottie files are ready, the same
     mood tag maps to a Lottie file (`mira-happy.json`,
     `mira-encouraging.json`, etc.) — no duel logic changes, only the
     renderer swaps a static avatar for an animation.
5. No character is ever a real person, a finfluencer, or a
   recommendation source. Characters teach general concepts only.

### 2.3 Character moments in a duel (the full list, per duel)

- **Before:** host introduces the duel in one line ("7 questions,
  15 seconds each. Same set for both of you. Good luck.")
- **Countdown:** host name + duel title, no dialogue.
- **Between questions:** no character dialogue (keeps the pace).
- **After:** host gives the result line, the Rating change in plain
  words, and one practise-next suggestion (from doc 06 post-game stats).
- **Bot Duel only:** Mira also "plays" — her simulated answers and
  times are shown on the result screen, with her accuracy for that duel.

---

## 3. Predeclared question formats — the registry

**The rule:** the frontend never guesses how to show a question.
Every question the API sends carries a `format` code. The frontend
looks that code up in this registry and renders exactly that layout.
If a format is not in this registry, the bank cannot publish items
in it, and the API must reject them. Adding a format means: registry
entry here + Prisma enum (already exists for all six) + API validation

- frontend renderer + tests. No silent formats.

The six formats are already declared in Prisma
(`DuelBankQuestionType`). Two are live, four are declared but not
yet used in the bank. That is deliberate — the UI for each is
declared now, so the bank and the frontend grow in step.

### 3.1 MCQ_4 — four-option multiple choice — LIVE

- **Use in:** Bot Duel, Daily Duel, Speed Quiz Duel.
- **Bank:** 461 live items.
- **API shape:** `stem` (text), `options[4]` (text, shuffled per duel),
  `correctOptionId` (server only, never sent before reveal),
  `explanation` (sent only on reveal).
- **UI, predeclared:** stem at top, 4 options as full-width cards
  in a 1-column list (mobile) / 2×2 grid (desktop), one tap selects,
  selected card is highlighted, no separate Submit button (tap = answer,
  with a 0.5 sec confirm state). Timer is a thin bar at the top,
  15 sec. On reveal: correct card turns green, chosen wrong card
  turns red, explanation appears below in simple English.
- **Scoring:** 100 base + up to 50 speed bonus (doc 07 §6).
- **Validation:** exactly 4 options, exactly 1 correct.

### 3.2 TRUE_FALSE — true or false — LIVE

- **Use in:** Myth vs Fact Blitz (Step 4), and as a fast variant
  inside Bot/Daily duels.
- **Bank:** 59 live items.
- **API shape:** `stem` (a statement), `options[2]` ("True", "False"),
  `correctOptionId` (server only), `explanation` (reveal only).
- **UI, predeclared:** stem as a large statement card, two big
  buttons side by side: TRUE (left, green tint) and FALSE (right,
  red tint). One tap answers. Timer 10 sec, thin bar at top.
  On reveal: the correct button fills solid, the wrong choice (if
  any) is marked, explanation below.
- **Scoring:** same as MCQ_4, plus a streak multiplier in Blitz
  (one wrong answer resets the in-duel streak, see doc 05).
- **Validation:** exactly 2 options, exactly 1 correct.

### 3.3 CASE_CHOICE — scenario case, best action — LIVE (format + bank + duel, Phase 7)

- **Use in:** Case Duel (Step 5 — built, Phase 7 Stage 2, docs/12 + ADR 0009).
- **Bank:** 50 live items (qb-521..qb-570, 5 per topic, difficulties 2:15 / 3:20 / 4:15,
  skills JUDGEMENT / SCENARIO / RISK_ASSESSMENT). The 50-item minimum is met — the
  Case Duel is built on this bank (docs/12 + ADR 0009).
- **API shape:** `stem` (the case: person, income, goal, constraint,
  in 3–5 short lines), `context` (numbers as structured fields, not
  buried in prose), `options[3–4]` (actions, each with a short
  consequence line and per-option `points`: best 100, second-best 50, other 0),
  `correctOptionId` (best action, server only),
  `rubric` (why the best action wins, and why each other action is
  weaker — shown on reveal), `explanation`.
- **UI, predeclared:** case card at top with the numbers in a
  small table (income / goal / deadline), options as action cards
  with a one-line consequence each, one tap selects, then a second
  step appears: "Why did you pick this?" with 3 short reason chips
  (optional, 10 sec extra; the reason is recorded with the answer
  and does NOT affect points or the win/loss). Timer 45 sec for the case (longer than a quiz
  question — this is judgement, not recall). On reveal: best action
  highlighted, rubric shown line by line.
  Renderer: `apps/web/app/duels/case-question.tsx`, format test page
  `/duels/case-test`. It renders by the question's `type` code only.
  Host: Kabir (doc 08 §2.2) — before/after only, never during a question.
- **Scoring:** base points for the best action, partial points for
  the second-best action (defined in the rubric), 0 for a harmful
  action. Speed bonus is smaller here (max 20) — thinking time is
  part of the skill. The duel-side scoring (Stage 2) applies
  `points` 100 / 50 / 0 + the capped speed bonus.
- **Validation:** 3–4 options, exactly 1 best, rubric required,
  no option may be a buy/sell recommendation for a real security.

### 3.4 CHART_CHOICE — chart reading — LIVE (format + bank + duel, Phase 8)

- **Use in:** Chart Detective (Step 6 — built, Phase 8 Stage 2, docs/13 + ADR 0010).
- **Bank:** 50 live items (qb-571..qb-620, 5 per topic, difficulties 2:15 / 3:20 / 4:15,
  skill CHART_READING only, templates 10 each of STEADY_RISE / VOLATILE_FLAT /
  SHARP_FALL_RECOVERY / STEADY_FALL / SPIKE_THEN_FALL). The 50-item minimum is met — the
  Chart Detective duel is unblocked on bank depth.
- **API shape:** `stem` (the question, one line), `chart` (structured data:
  `title`, `instrument` (fictional only), `template`, `xLabel`, `yLabel`,
  `xLabels[6]`, `series[6]`, `annotation` — the chart is drawn from data, so it is
  accessible and identical for both players), `options[4]` (interpretations),
  `correctOptionId` (server only), `explanation`. The public view carries the
  chart WITHOUT the reveal-only `annotation` (trend + highlighted zone).
  The seeded chart generator (`apps/api/src/modules/question-bank/chart-generator.ts`,
  mulberry32 + FNV-1a, same pattern as the bot simulation) generates a series
  from a seed + template; every series is 6 points.
- **UI, predeclared:** chart at top, full width, with a clear
  title and axis labels, drawn from the data (SVG line chart, not an image,
  no chart library, no network). Below it, the question in one line, then 4 option cards.
  Timer 30 sec, thin bar at top. One tap answers (0.5 s confirm state).
  On reveal: the chart is annotated (trend line / risk zone highlighted, from the
  `annotation` the server sends at reveal), correct interpretation in green,
  chosen wrong interpretation in red, explanation below.
  Renderer: `apps/web/app/duels/chart-question.tsx`, format test page
  `/duels/chart-test`. It renders by the question's `type` code only.
  Host: Kabir (doc 08 §2.2) — before/after only, never during a question.
- **Scoring:** same as MCQ_4. A wrong chart read is a wrong answer —
  no partial credit, because the chart is the question.
- **Validation:** chart data must be present and valid (exactly 6 xLabels and
  6 finite positive series values, title/axis labels present, known template,
  series shape matches the template — a rise must end above its start, a
  recovery must trough mid-series and end above the trough), exactly 4 options
  with exactly 1 correct, explanation 1–3 sentences, skill CHART_READING only,
  difficulty 2–4, fictional instrument only (no bare ticker-like code), no real
  ticker, no price advice.

### 3.5 NUMERIC — enter a number — DECLARED, NOT LIVE

- **Use in:** calculation duels and as a variant inside Speed Quiz
  (e.g. "about how much after 3 years?").
- **Bank:** 0 live items.
- **API shape:** `stem`, `answer` (number, server only),
  `tolerance` (e.g. ±5% — an approximate answer counts, because
  finance estimates are approximate), `unit` (₹, %, years),
  `explanation` (shows the working, step by step, on reveal).
- **UI, predeclared:** stem, then a large number input with the
  unit shown beside it, a numeric keypad on mobile, one Submit
  button. No multiple choice — the player must produce the number.
  Timer 30 sec. On reveal: correct range shown, player's answer
  marked inside/outside the range, working shown step by step.
- **Scoring:** full points inside tolerance, half points inside
  2× tolerance, 0 outside. Speed bonus as MCQ_4.
- **Validation:** answer is a number, tolerance is set, unit is set.

### 3.6 ORDERING — put steps in order — DECLARED, NOT LIVE

- **Use in:** process duels (e.g. "Put these steps for building
  an emergency fund in order").
- **Bank:** 0 live items.
- **API shape:** `stem`, `items[4]` (steps, shuffled per duel),
  `correctOrder` (server only), `explanation`.
- **UI, predeclared:** stem, then 4 draggable / tap-to-number
  cards. Tap a card to assign it 1, 2, 3, 4 (tap again to clear).
  Submit button to lock the order. Timer 30 sec. On reveal:
  cards reorder into the correct order with numbers, explanation below.
- **Scoring:** 100 for a perfect order, 50 for 3 of 4 in the
  correct position, 0 otherwise. No speed bonus — ordering is
  thinking, not speed.
- **Validation:** exactly 4 items, exactly 1 correct order.

### 3.7 Trading formats (not question formats — declared separately)

Trading duels do not use question formats. They use actions:
BUY / SELL / HOLD on a fictional instrument, with quantity.
Their UI is predeclared in the simulator (Phase 2) and in doc 05:
portfolio card, order form, holdings table, and a risk panel.
No new question format is needed for trading duels. The Paper
Trading Sprint (T1) is built (Phase 9, docs/14, ADR 0011) on
exactly these actions, and the Crisis Duel (T2) is built (Phase 10,
docs/15, ADR 0012) on the same actions, as a variant of the sprint
engine — a seeded crash mid-duel, winner by crisis risk-adjusted
return.

---

## 4. What this changes in the build order

- The bank can now grow in the four declared-but-empty formats,
  but only after each format's renderer exists. Order: renderer
  first (in the web app, with a format test page), then bank items.
- Case Duel (Step 5) is built (Phase 7, docs/12 + ADR 0009).
  Chart Detective (Step 6) is built (Phase 8, docs/13 + ADR 0010)
  — 5 CHART_CHOICE charts, 30 sec each, standard live scoring,
  annotation on reveal, separate CHART queue, Kabir host.
- Crisis Duel (Step 8) is built (Phase 10, docs/15 + ADR 0012) —
  a variant of the sprint engine, not a second engine: seeded crash
  at minute 7–10, winner by crisis risk-adjusted return, separate
  crisis queue, Tara host.
- No duel may mix formats without declaring the mix in its
  blueprint (e.g. Speed Quiz = MCQ_4 + TRUE_FALSE only, in a
  declared ratio). A duel's format mix is part of its design,
  not a surprise at runtime.

---

## Approval

Approve this registry and the next duel built (Step 3, Speed Quiz)
will use only the two live formats (MCQ_4, TRUE_FALSE) with the
UIs above. The four new formats will be built one by one, renderer
first, bank second, duel third — in the order in doc 05 §7.
