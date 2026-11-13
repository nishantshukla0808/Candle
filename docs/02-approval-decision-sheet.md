# Candle — Blueprint Approval Decision Sheet

**Purpose:** Make the 2026-10-27 production blueprint
(`workspace/candle/docs/01-system-design-blueprint.md`) easy to approve
without re-reading all 18 sections. This sheet changes nothing in the
blueprint and starts no code.

**Status at 2026-10-28 morning (Asia/Calcutta):** Blueprint delivered
2026-10-27 evening, awaiting Nishu's approval. No Candle code exists yet.

## Already decided by Nishu (not up for re-decision)

- No Clash of Clans theme or characters.
- No BaaS (no Supabase / Firebase) — Candle owns its own APIs.
- System design first, animation (Lottie) later.
- A proper application with at least one feature completed properly,
  not a demo of every feature.
- Production-level codebase: proper validation, file handling,
  security, standard responses, middleware, documentation, and an
  architecture where future features plug in easily.

## The 5 things to approve (or change)

1. **World and mentors (proposal, not locked):** "The Exchange", a
   professional finance district, with career-ladder progression
   Intern → Analyst → Strategist → Risk Manager → Portfolio Manager
   → Market Expert. Mentor cast: Mira (Daily Coach), Kabir (Analyst),
   Tara (Risk Guardian), Dev (Patient Builder), Anaya (Portfolio
   Architect), Rey (Frontier Explorer).
2. **Stack:** Next.js + TypeScript + Tailwind (web), NestJS + TypeScript
   (API), PostgreSQL + Prisma, Redis, Docker + CI.
3. **Phase 0 only, first:** Empty production skeleton — config
   validation, response/error system, auth plumbing, logging, health
   checks, Docker, CI, docs. No business feature code yet. Phase 1
   starts only after Phase 0 is reviewed.
4. **Legal path for v1:** Original Candle curriculum only. Zerodha
   Varsity is a topic reference only — no copying, scraping, or
   training on its text unless Zerodha gives written permission.
   Education, not personalised investment advice. Simulator uses
   virtual money and fictional/simulated tickers in v1; real tickers,
   mentorship advice, and paid Pro features need legal review first.
5. **Feature 1 (after Phase 0):** Gamified Learning Engine, end to end
   — Auth + Users, one complete Foundation track, lesson player, quiz
   engine, XP / levels / streaks / badges, progress dashboard, and an
   admin CMS to create and version lessons.

## What approval does NOT start

Simulator, ELO ratings, community, mentorship, analytics, mobile apps,
AI assistant, real market data, payments, or character animation.
Each of those is a later plug-in module, in that order.

## How to reply (any one line works)

- "Approve all 5" — Phase 0 begins.
- "Approve, except change [item] to [change]" — blueprint is updated
  for that item only, then Phase 0 begins.
- "Approve Phase 0 only, hold the rest" — skeleton is built and
  reviewed before any Feature 1 decision.
