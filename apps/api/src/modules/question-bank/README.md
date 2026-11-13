# Question Bank module

Duels Step 1 — docs/05-duels-system-design.md §2 (Phase 3, ADR 0005 §15).
The bank, its CMS workflow, pilot + calibration, template variants, and
the stratified selection engine. **No duel code lives here** — no live
gateway, no matchmaking, no duel state. The future duels module calls
`QuestionBankService.selectSet` / `recordExposure` directly.

## Endpoints (`/api/v1/question-bank`)

| Method | Path                       | Auth  | Notes                                                                                 |
| ------ | -------------------------- | ----- | ------------------------------------------------------------------------------------- |
| POST   | `/items`                   | ADMIN | Create a DRAFT item (author = caller).                                                |
| POST   | `/items/:id/submit-review` | ADMIN | DRAFT → REVIEW.                                                                       |
| POST   | `/items/:id/review`        | ADMIN | REVIEW → PILOT (approve) / REVIEW → DRAFT (reject). Reviewer must differ from author. |
| POST   | `/items/:id/publish`       | ADMIN | PILOT → LIVE only. Never direct DRAFT → LIVE.                                         |
| POST   | `/items/:id/retire`        | ADMIN | LIVE / PILOT → RETIRED.                                                               |
| POST   | `/items/:id/new-version`   | ADMIN | New DRAFT row (version + 1); the old row is never edited in place.                    |
| GET    | `/items`                   | ADMIN | List (includes answers), filters: status, topic, skill, type, difficulty, language.   |
| GET    | `/items/:id`               | ADMIN | One item (includes answers).                                                          |
| GET    | `/coverage`                | ADMIN | LIVE counts per topic × difficulty (zeros included).                                  |
| POST   | `/templates/:id/generate`  | ADMIN | Generate DRAFT variants from a template (deterministic per seed).                     |
| POST   | `/select`                  | user  | Select a set (public views) + record exposure for the caller, one transaction.        |

Every endpoint carries the educational disclaimer (blueprint §16).
Invalid status transitions are 409 `QUESTION_BANK_INVALID_TRANSITION`;
a reviewer approving their own item is 403
`QUESTION_BANK_REVIEWER_MUST_DIFFER`.

## Workflow + immutability

```
DRAFT → REVIEW → PILOT → LIVE → RETIRED
              ↘ DRAFT (reject)      ↗ RETIRED (from PILOT)
```

Published versions are immutable (docs/05 §2.2): editing a LIVE item
creates a **new row** (version + 1, status DRAFT, key `<key>-v<version>`)
via `POST /items/:id/new-version`. Mutations write an audit row to the
shared append-only `audit_log` table (same shape as the admin CMS —
the AuditService is not exported by AdminModule, so the bank writes
the same row through its own repository; no second audit system).

Option shapes (validated by the service, 400 on violation):
MCQ_4 = exactly 4 options, exactly 1 correct; TRUE_FALSE = exactly 2,
exactly 1 correct; CASE_CHOICE = 3–4 options, exactly 1 correct (the
best action), points exactly one 100 / at most one 50 / rest 0, every
option with a non-empty consequence, a context object with at least 2
labelled entries (at least 2 carrying a number), and a rubric of at
least 2 lines; CHART_CHOICE = exactly 4 options, exactly 1 correct
(the best interpretation), no per-option points, a chart object with
exactly 6 xLabels and 6 finite positive series values whose shape
matches its template, and a 1–3 sentence explanation; other types =
at least 2, at least 1 correct.
Topics are validated against the `DUEL_BANK_TOPICS` allowlist constant,
not a closed enum, so topics can grow without a migration.

## CASE_CHOICE (docs/08 §3.3, Phase 7 Stage 1)

The first judgement format: a real-life case, not a quiz question.
Schema (`DuelBankItem.context` / `.rubric`, `DuelBankOption.points` /
`.consequence`; migration `0009_phase7_case_duel`):

- `context` — structured case numbers as labelled key/value pairs,
  e.g. `{"Monthly income": "₹45,000", "Saved so far": "₹20,000"}`.
  The renderer shows them as a small table; numbers are never buried
  only in prose.
- `rubric` — required: why the best action wins and why each other
  action is weaker, shown line by line on reveal.
- `points` — per-option score fraction: best action 100, second-best
  50, harmful/other 0. `isCorrect` stays: exactly one option has
  `isCorrect=true` (the best action, points=100).
- `consequence` — the one-line consequence shown under each action card.
- Stem: 3–5 short lines (person, income, goal, constraint). Skills:
  JUDGEMENT, SCENARIO, or RISK_ASSESSMENT only; difficulty 2–4 only
  in v1 (no 1 or 5 — cases are judgement, not recall).
- No option text, consequence, stem, or rubric may contain a buy/sell
  recommendation for a real security (fictional instruments only) —
  rejected with a clear validation error.
- Public views (`POST /select`, duel sets) carry `context` and each
  option's `consequence` — both are shown before answering — but
  NEVER `points`, `isCorrect`, the rubric, or the explanation.
- Renderer: `apps/web/app/duels/case-question.tsx` (45-second timer
  bar, case card + numbers table, action cards, 0.5 s confirm, then
  an optional "Why did you pick this?" step with 3 short reason
  chips). The reason is recorded with the answer, is optional, and
  does NOT affect points. Format test page: `/duels/case-test`.
  Kabir hosts the Case Duel (doc 08 §2.2) — before/after only, never
  inside the question component.
- Scoring (for Stage 2): base points from the option (100 / 50 / 0)
  plus a speed bonus capped at 20 (doc 08 §3.3). Stage 1 adds no
  duel, no `DuelType.CASE` — that is the Stage 2 agent's work.
- Seeds: CASE items go through the same status path as every seed
  item — authored in `prisma/question-bank-seed.ts`, reviewed by a
  second person (the coordinator) before seeding as LIVE, and pinned
  by `question-bank.seed.spec.ts` (counts, coverage, and every
  CASE rule above, including running each seed item through the same
  `validateCaseChoice` the API uses). The two-person CMS rule
  (author ≠ reviewer) applies to runtime-created items as well.

## Pilot + calibration (docs/05 §2.5)

New items reach PILOT after review and are shown only in unrated
practice / bot duels (pilot items are NEVER returned by selection).
`recordPilotAnswer(itemId, correct)` increments `pilotAnswers` /
`pilotCorrect` and recomputes `correctRate`. After **≥ 50** pilot
answers, `calibrate(itemId)` sets difficulty from `correctRate`:

| correctRate | difficulty |
| ----------- | ---------- |
| ≥ 0.90      | 1          |
| 0.80 – 0.90 | 2          |
| 0.50 – 0.80 | 3          |
| 0.35 – 0.50 | 4          |
| < 0.35      | 5          |

`discrimination` stays **null**: full IRT calibration needs
per-rating-band correct rates from real duel data, which does not
exist yet. It is never faked. Neither `recordPilotAnswer` nor
`calibrate` has a public endpoint yet — they are service methods for
the future practice/bot duel module, covered by unit tests.

## Template variants (docs/05 §2.4)

Pure, deterministic generation in `template-engine.ts` (seeded RNG —
the same seed replays the same variant). Every variant is validated
(computable answer, plausible distinct distractors, sane numbers,
parameters inside their domains) before it can be created.

- **tpl-compounding** — "You invest ₹{principal} at {rate}% per year.
  After {years} years, about how much do you have, ignoring tax?"
  Domains: principal {10000, 25000, 50000}, rate {6, 8, 10, 12},
  years {3, 5, 10} (36 combinations). Correct = compounding rounded
  to the nearest ₹100; distractors = simple-interest answer,
  no-growth answer, one-year-less compounding answer.
  Worked example: ₹10,000 at 10% for 3 years → ₹10,000 × 1.1³ =
  ₹13,310 (simple interest would give ₹13,000).
- **tpl-budgeting-503020** — randomised monthly income from
  {30000, 40000, 50000, 60000, 80000}; asks for the 20% savings share.
  Distractors = 30% (wants), 50% (needs), 10% (half the savings).

Generated variants are DRAFT items linked by `templateId` +
`parameters`, seeded at author-estimated difficulty 3, and go through
review like any item. Re-running the same template + seed skips
already-generated variants by key. Both templates seed as DRAFT.

Four Phase 4 templates (same rules — generated variants are DRAFT):

- **tpl-simple-vs-compound** — "You invest ₹{principal} at {rate}%
  per year for {years} years. How much more do you get with compound
  interest than with simple interest, ignoring tax?"
  Domains: principal {20000, 50000, 100000}, rate {8, 10, 12},
  years {3, 5, 10} (27 combinations). Correct = compound total −
  simple total (both rounded to the nearest ₹100 first);
  distractors = "₹0 — simple and compound give the same total",
  double the difference, half the difference. Domains are chosen so
  the difference is always ≥ ₹400 (a smaller difference would round
  to ₹0 and collide with the "same total" distractor).
  Worked example: ₹20,000 at 10% for 3 years → compound ₹26,600,
  simple ₹26,000, difference **₹600** (distractors ₹0… / ₹1,200 /
  ₹300).
- **tpl-sip-goal** — "You want ₹{goal} in {months} months through a
  monthly SIP. Ignoring returns, about how much must you invest each
  month?" Domains: goal {60000, 120000, 180000, 240000, 300000,
  360000}, months {12, 24, 36, 48, 60} (30 combinations). Correct =
  goal ÷ months, rounded to the nearest ₹100; distractors = double,
  half, goal ÷ 10.
  Worked example: ₹1,20,000 in 24 months → **₹5,000** a month
  (distractors ₹10,000 / ₹2,500 / ₹12,000).
- **tpl-emergency-fund** — "Your essential spending is
  ₹{monthlyExpenses} a month. How big should your emergency fund be
  to cover {months} months?" Domains: expenses {15000, 20000, 25000,
  30000, 40000, 50000}, months {3, 4, 5, 6} (24 combinations).
  Correct = expenses × months (exact); distractors = one month,
  one year, three extra months.
  Worked example: ₹20,000 a month × 6 months → **₹1,20,000**
  (distractors ₹20,000 / ₹2,40,000 / ₹1,80,000).
- **tpl-tax-slab** — "In this simplified example, the first ₹3,00,000
  of income is tax-free and the rest is taxed at {rate}%. Your income
  is ₹{income}. How much tax do you pay?" Domains: income {400000,
  …, 1200000} (8 values), rate {5, 10, 15, 20} (32 combinations).
  Correct = (income − ₹3,00,000) × rate; distractors = tax on the
  full income, tax with only ₹1,00,000 treated as free, half the tax.
  Worked example: ₹6,00,000 at 10% → tax **₹30,000** on ₹3,00,000
  (distractors ₹60,000 / ₹50,000 / ₹15,000).

## Selection (docs/05 §2.6)

`selectSet(userIds, blueprint)` — `blueprint = { count,
difficultyMix, topics?, skills?, types?, maxPerTopic? }`:

1. LIVE items only, narrowed to the blueprint's topics/skills/types.
2. Excludes items **any** listed user saw in the last 30 days or saw
   3+ times (`user_question_exposures`).
3. Stratified by the requested difficulty mix; a short cell falls
   back to the **nearest difficulty** (ties prefer easier) — never to
   a repeat.
4. At most `maxPerTopic` (default 2) items from one topic.
5. At least 3 different skills when count ≥ 6 (repair pass swaps a
   duplicated-skill item for an unused-skill item).
6. Never repeats an item within the set. If the bank cannot fill the
   set even after fallback, it throws 409
   `QUESTION_BANK_INSUFFICIENT_COVERAGE` — never a repeated or thin
   set silently.

Returned items are PUBLIC views: id, stem, options (id + text only,
shuffled), type, topic, skill, difficulty — never `isCorrect` or the
explanation. `POST /select` selects and records exposure for the
caller in one transaction; future live duels call the service
directly instead. `recordExposure(userId, itemIds)` is the seam the
duel module will call after serving a set.

## Seed

`prisma/question-bank-seed.ts` — **620 original LIVE items** (10 topics ×
52 + 50 CASE_CHOICE + 50 CHART_CHOICE; difficulties 90 / 159 / 160 /
120 / 91; 461 MCQ_4 + 59 TRUE_FALSE + 50 CASE_CHOICE + 50 CHART_CHOICE;
skills recall 95 / calculation 227 / judgement 147 / scenario 91 /
risk-assessment 10 / chart-reading 50) + the
6 templates as DRAFT. Wired into `prisma/seed.ts` idempotently by `key`:
a LIVE item is never overwritten, it is skipped like a published lesson
version. Doc 05 §7 asks for 500 live items to prove the pipeline and
2,000 before any rated duel launches — **620 meets the 500-item
pipeline target**; the 2,000-item launch target is still ahead, and no
rated duel may launch until it is met.

Phase 4 growth (2026-11-11, qb-121..qb-520 — the Phase 3 items
qb-001..qb-120 are untouched): 400 new items, 131 materialised
template variants + 269 hand-written original items. The materialised
variants were enumerated from `template-engine.ts` and verified
against the TS engine (same stem, same option texts — see
`question-bank.seed.spec.ts`, which spot-checks one variant per
template against the engine and pins the whole bank's counts,
coverage, option shapes, explanations, and content rules). The seed
items were authored by the Phase 4 Stage 1 builder and reviewed by
the Phase 4 coordinator before seeding as LIVE; templates themselves
seed as DRAFT, and variants generated at runtime through
`POST /templates/:id/generate` still seed as DRAFT and go through the
CMS workflow. Template difficulties in the seed are author estimates
by parameter size (longer horizons / higher rates are harder); pilot +
calibration set the real difficulty later (docs/05 §2.5).

| Topic          | Items   | Difficulties (1/2/3/4/5) | MCQ_4   | TRUE_FALSE | CASE_CHOICE | CHART_CHOICE | Template | Hand-written |
| -------------- | ------- | ------------------------ | ------- | ---------- | ----------- | ------------ | -------- | ------------ |
| money-basics   | 62      | 9/17/16/11/9             | 45      | 7          | 5           | 5            | 0        | 40           |
| budgeting      | 62      | 9/17/16/11/9             | 44      | 8          | 5           | 5            | 5        | 35           |
| banking-saving | 62      | 10/16/16/11/9            | 48      | 4          | 5           | 5            | 24       | 16           |
| stocks         | 62      | 9/17/16/11/9             | 44      | 8          | 5           | 5            | 0        | 40           |
| mutual-funds   | 62      | 10/16/16/11/9            | 49      | 3          | 5           | 5            | 30       | 10           |
| risk           | 62      | 9/15/16/13/9             | 44      | 8          | 5           | 5            | 0        | 40           |
| compounding    | 62      | 8/16/16/13/9             | 50      | 2          | 5           | 5            | 40       | 0            |
| tax-basics     | 62      | 8/15/16/13/10            | 49      | 3          | 5           | 5            | 32       | 8            |
| insurance      | 62      | 9/15/16/13/9             | 44      | 8          | 5           | 5            | 0        | 40           |
| markets        | 62      | 9/15/16/13/9             | 44      | 8          | 5           | 5            | 0        | 40           |
| **Total**      | **620** | **90/159/160/120/91**    | **461** | **59**     | **50**      | **50**       | **131**  | **269**      |

Known skew: calculation is the largest skill (227) because all 6
templates are calculation-only; recall (95), judgement (127), and
scenario (71) come from hand-written items. Nine topics have all four
skills; compounding has three (recall / calculation / judgement — no
scenario items yet). Selection still works — a 7-item set needs ≥ 3
skills, and the bank-wide mix covers it — but future growth should
add judgement/scenario/chart-reading templates or hand-written items
before the bank grows much further in calculation. One pre-existing Phase 3 item, qb-081, has a
4-sentence explanation ("Year 1… Year 2… Year 3…"); it is
grandfathered — the 120 Phase 3 items were not edited.

Phase 7 Stage 1 growth (2026-11-12, qb-521..qb-570): 50 CASE_CHOICE
items, 5 per topic, difficulties 2:15 / 3:20 / 4:15, skills JUDGEMENT
20 / SCENARIO 20 / RISK_ASSESSMENT 10. Every item has a 3–5 line stem,
context with at least 2 numbers, 3–4 actions with consequence +
points (100/50/0), a rubric, and a 1–3 sentence explanation. The seed
spec pins all of it (counts, coverage, and every CASE rule, including
running each seed item through the same `validateCaseChoice` the API
uses). The CASE_CHOICE format (renderer + bank) is Stage 1; the Case
Duel itself — `DuelType.CASE`, the live variant, rubric scoring — is
Stage 2 and is not built here.

Phase 8 Stage 1 growth (2026-11-12, qb-571..qb-620): 50 CHART_CHOICE
items, 5 per topic, difficulties 2:15 / 3:20 / 4:15, skill CHART_READING
50, templates 10 each of STEADY_RISE / VOLATILE_FLAT /
SHARP_FALL_RECOVERY / STEADY_FALL / SPIKE_THEN_FALL. Every item has a
one-line stem, a chart generated from its key + template + fictional
instrument (same key replays the same 6-point series), 4
interpretations with exactly 1 correct, and a 1–3 sentence explanation
showing how to read the chart. The seed spec pins all of it (counts,
coverage, and every CHART rule, including running each seed item
through the same `validateChartChoice` the API uses and replaying each
series from the generator). The CHART_CHOICE format (renderer +
generator + bank) is Stage 1; the Chart Detective duel itself —
`DuelType.CHART`, the live variant, chart scoring — is Stage 2 and is
not built here.

## CHART_CHOICE (docs/08 §3.4, Phase 8 Stage 1)

The first chart format: read a line, not a paragraph. Schema
(`DuelBankItem.chart`, migration `0010_phase8_chart_detective`):

- `chart` — structured chart data: `title`, `instrument` (fictional
  only), `template`, `xLabel`, `yLabel`, `xLabels[6]`, `series[6]`,
  `annotation` (trend + highlighted zone, reveal-only). The renderer
  draws the line from this data (SVG, never an image).
- Seeded chart generator (`chart-generator.ts`): pure, deterministic,
  replayable — mulberry32 + FNV-1a, the same pattern as the bot
  simulation. Five templates, every series 6 points: STEADY_RISE,
  VOLATILE_FLAT, SHARP_FALL_RECOVERY, STEADY_FALL, SPIKE_THEN_FALL.
  The same (seed, template, instrument) always replays the same chart.
- Stem: one line (the question). Skill: CHART_READING only; difficulty
  2–4 only in v1 (no 1 or 5 — charts are read, not recalled).
  Explanation: 1–3 short sentences showing how to read the chart.
- No field may contain a buy/sell recommendation for a real security,
  and the instrument must be fictional — never a real name, never a
  bare ticker-like code (2–5 capital letters) — rejected with a clear
  validation error.
- Public views (`POST /select`, duel sets) carry the `chart` WITHOUT
  its `annotation` — the trend highlight arrives only at reveal — and
  NEVER `isCorrect`, `points`, or the explanation.
- Renderer: `apps/web/app/duels/chart-question.tsx` (30-second timer
  bar, SVG line chart with title + axis labels, 4 interpretation
  cards, 0.5 s confirm, reveal with the annotation zone highlighted).
  Format test page: `/duels/chart-test`. Kabir hosts the Chart
  Detective duel (doc 08 §2.2) — before/after only, never inside the
  question component.
- Scoring (for Stage 2): same as MCQ_4 — a wrong chart read is a
  wrong answer, no partial credit. Stage 1 adds no duel, no
  `DuelType.CHART` — that is the Stage 2 agent's work (append
  `ALTER TYPE "DuelType" ADD VALUE 'CHART'` to migration 0010, which
  was never applied to a live Postgres).
- Seeds: CHART items go through the same status path as every seed
  item — authored in `prisma/question-bank-seed.ts` (the chart for
  each item is generated from its key + template + instrument, so a
  key replays its series), reviewed by a second person (the
  coordinator) before seeding as LIVE, and pinned by
  `question-bank.seed.spec.ts` (counts, coverage, and every CHART
  rule above, including running each seed item through the same
  `validateChartChoice` the API uses and replaying each series from
  the generator). The two-person CMS rule (author ≠ reviewer)
  applies to runtime-created items as well.

## Layout (the Feature Module Template, blueprint §5)

- `question-bank.controller.ts` — thin
- `question-bank.service.ts` — workflow / pilot / calibration / generation / selection orchestration
- `question-bank.repository.ts` — the ONLY file touching Prisma here
- `template-engine.ts` — pure deterministic variant generation
- `selection.service.ts` — pure stratified selection (+ injectable wrapper)
- `dto/question-bank.dto.ts` — boundary validation
- `*.spec.ts` — unit tests
