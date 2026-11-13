# Candle — Design Concept Rationale

**File:** `index.html` (this folder) — self-contained, no build step, no network
dependencies. Open it directly in a browser. Concept only; the real app is
untouched. Prepared 2026-11-02 for Nishu's review.

## What the prototype walks through

1. **Design system** — palette, typography, buttons, cards, stat cards,
   progress/XP/streak/badge components, inputs.
2. **The Exchange map** — clickable SVG district of the 6 zones, with the
   career ladder (Intern → Market Expert) beside it.
3. **Lesson screen** — a phone-style lesson with a working quiz question.
4. **Game-feel moments** — XP gain, streak celebration, lesson-complete
   checkmark, badge unlock. All CSS/SVG animation (the same technique the
   real build will use for Lottie-style motion).
5. **Mentor cast** — one card per mentor: role, personality, coaching style,
   signature tip.
6. **Onboarding (new)** — welcome → 5 knowledge questions → analyzing →
   result with placement, mentor, and personal plan. Fully working logic.

## Design decisions

### 1. Ink + gold, not neon + cartoons

The palette borrows from trading terminals and private banks: deep ink
backgrounds (`#0B1120`), one confident gold accent (`#E9B44C`), mint for
gains, soft rose for risk. This keeps the "professional finance world"
bar Nishu set — the game feel comes from motion and reward moments, not
from playful colors or mascots.

### 2. Levels are job titles

Progression uses the career ladder from the blueprint (Intern → Analyst →
Strategist → Risk Manager → Portfolio Manager → Market Expert) instead of
generic "Level 12" ranks. The map, ladder sidebar, and XP demos all speak
this language, so progress feels like a career, not a game score.

### 3. Mentors as identity marks, not faces

Each mentor gets a geometric SVG identity mark (Mira's compass rose,
Tara's shield, Kabir's bars…) with a role color and a gentle hover float.
No cartoon faces — this respects the "not overly cartoonish" constraint
while still giving every desk a memorable guide. Final character art is
still a designer decision; these marks are the concept placeholder.

### 4. Motion is the gamification

The current web UI shows XP/streaks/badges as static numbers. The concept
argues the _feeling_ lives in four signature moments: XP floating up with
a counting ticker, streak eruptions with confetti rings, a drawn checkmark
on lesson complete, and a medal drop with a shine sweep on badge unlock.
All are CSS/SVG keyframes — portable directly into Lottie or the Next.js
build later.

### 5. Onboarding that places, not just welcomes

The new onboarding flow assesses with 5 plain-English questions and maps
the score to a starting desk (0–2 → Foundation from lesson 1 with Dev;
3–4 → Foundation fast lane with Mira; 5 → Market Square preview). It also
assigns a mentor and a daily goal on the result screen, so the "algorithm"
Nishu asked for has a visible first version: placement + mentor + pace.

## Open questions for Nishu

- Is the ink-and-gold direction professional _enough_, or does it still
  feel too game-like?
- Do the mentor identity marks work, or do you want illustrated characters
  after all (still non-cartoonish)?
- Onboarding length: are 5 questions right, or should it be 3 / 8?
- Should the result screen let the user _override_ the placement
  ("start from zero anyway")?
