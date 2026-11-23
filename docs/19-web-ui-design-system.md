# Candle — Web UI Design System (v2 — game-first, round 2)

> **Round 2 (2026-11-13).** Round 1 was rejected by Nishu outright: the prototype
> looked like "the most common ui for erp dashboards or software" — grey cards,
> sidebar, tables — "not the attractive ui at all". Round 2 is a full redesign
> grounded in real research: [20-ui-research-duolingo-matiks-spotify.md](./20-ui-research-duolingo-matiks-spotify.md)
> (Duolingo, Matiks, Spotify, Brilliant, Headspace, Khan Academy — concrete
> patterns with sources, plus a 34-item list of common patterns to deliberately
> avoid). What changed and why is in §14 below. Everything in §§1–13 still
> applies unless §14 explicitly overrides it.

**Status:** Design only. Review-gated — nothing in `apps/web` has been changed.
**Date:** 2026-11-13. **Author:** UI redesign coordinator.
**Builds on:** `docs/design-concept/` (2026-11-02 prototype, ink + gold) — this doc ports
that concept into a buildable system and answers what the prototype left open, except the
4 questions that only Nishu can answer (§10).
**Scope:** the web app only. The future mobile app reuses these tokens and components;
nothing here assumes a native shell.

---

## 1. Audit summary — what is wrong with the current web UI

Full audit: child-agent report, 2026-11-13 (read-only, no files changed). Headline findings:

| #   | Finding                                                                                                                                                                                       | Evidence                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **No design system exists.** No tokens, no shared components, no `components/` directory.                                                                                                     | `tailwind.config.ts` has `theme: { extend: {} }` (empty); `globals.css` is 3 lines; every colour is a hardcoded slate/amber literal        |
| 2   | **The approved 2026-11-02 palette was never ported.** The app is slate-950 + amber-400; the prototype's ink `#0B1120` / gold `#E9B44C` / mint `#3ED598` / rose `#F26D6D` appear nowhere.      | `text-slate-400` ×187, `bg-slate-900` ×133, `bg-amber-400` ×97; violet drifts in only on admin pages                                       |
| 3   | **Duels are undiscoverable.** No Duels link in the nav, no Duels CTA on the landing page, no profile/settings link anywhere.                                                                  | `app/nav.tsx` links Tracks / Dashboard / Simulator / Admin only                                                                            |
| 4   | **Gamification is emoji-only.** `🔥 🏅 🎉 ✓` characters; no XP bar, no career title, no Ratings anywhere, no animation.                                                                       | `apps/web/public/` holds only an empty `.gitkeep`; the one `animate-[fadeUp…]` reference points at keyframes that do not exist (dead code) |
| 5   | **Profile / Settings screens do not exist.** Phase 13 built the API; the web never calls it.                                                                                                  | No `/profile`, `/u/:id`, `/settings` route; `lib/api.ts` has no profile/settings calls                                                     |
| 6   | **No Ratings / leaderboard screen**, despite Ratings being the core loop (doc 04 §7). Dashboard shows level/XP only.                                                                          | `app/dashboard/page.tsx`                                                                                                                   |
| 7   | **Duplicated duel shells.** Six Socket.IO duel pages (live/blitz/case/chart/sprint/crisis, 508–685 lines each) re-implement queue/countdown/bot-offer/host-line/score-bar with visible drift. | Timer bar `duration-100` vs `duration-500`; `↑/↓` vs "Won/Drew/Lost"                                                                       |
| 8   | **Bare states.** Every page: `<p>Loading…</p>` and a red `<p>` error, no skeletons, no retry, no `focus:` styles anywhere (keyboard focus invisible).                                         | `disabled:opacity-50` ×42 but also `opacity-40` in one place                                                                               |
| 9   | **Mobile is fragile.** Nav is one `flex gap-6` row that overflows at 360px; weekly standings table has no scroll wrapper; small controls (`py-1` copy-link) are below touch-target size.      | `app/nav.tsx:12`, `app/duels/weekly/page.tsx:351`, `app/duels/challenge/page.tsx:342`                                                      |
| 10  | **Layout breaks.** Two duel pages nest their own `<main max-w-2xl>` inside layout's `<main max-w-4xl>`.                                                                                       | `app/duels/page.tsx:8`, `app/duels/[id]/result/page.tsx:59`                                                                                |

What already works and must be kept: one shared shell (`layout.tsx` + `Nav`), the
Socket.IO duel flows, the SVG chart renderer (`chart-question.tsx` — the only SVG in
the app), the lesson/quiz flow, onboarding assessment, admin CMS, simulator trade/orders.
The redesign is a reskin + restructure, not a rebuild of working flows.

---

## 2. Design principles

1. **Professional first, playful second.** A trading floor, not an arcade. Game feel
   comes from motion and reward moments (XP count-up, streak ring, checkmark draw,
   badge drop), never from mascots, neon, or cartoon faces. (Nishu's standing rule.)
2. **One accent, used sparingly.** Gold is the single brand accent. Everything else is
   ink, paper-white text, and two semantic colours (mint = gain/correct, rose =
   risk/wrong). If a screen has gold everywhere, gold means nothing.
3. **Progress is a career, not a score.** Levels are job titles (Intern → Market
   Expert). Ratings are shown as tiers, not raw numbers alone. (Blueprint §2, doc 06.)
4. **Mobile-first, because the phone is the product.** The web app is what users see
   now and the mobile app comes later; every screen must be right at 360px before it
   is polished at 1280px. Bottom tab bar on mobile, top nav on desktop.
5. **Motion is the gamification.** Four signature moments only (§6.5): XP float,
   streak ring, checkmark draw, badge drop. All CSS keyframes now, Lottie files later
   with no logic change (doc 08 character rule).
6. **No invented data.** A screen shows only what the API provides. Gaps are listed
   in §9, not papered over with fake numbers.

---

## 3. Palette

Carried forward from the 2026-11-02 concept, with justification for every token.
Dark-first; light mode is explicitly deferred (§10, Q5).

| Token         | Value                   | Role                                               | Justification                                                                                              |
| ------------- | ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `--ink-950`   | `#0B1120`               | App background                                     | Deep navy-black: trading-terminal / private-bank feel; OLED-friendly; makes gold read as premium, not loud |
| `--ink-900`   | `#131C31`               | Card background                                    | One step up from bg — cards float without borders shouting                                                 |
| `--ink-800`   | `#1A2540`               | Raised / hover surface                             | Interactive lift for cards and rows                                                                        |
| `--ink-700`   | `#26314D`               | Borders, dividers                                  | Visible on ink-900 without hard edges                                                                      |
| `--paper`     | `#E9EEF8`               | Primary text                                       | Near-white with a cool tint; contrast on ink-950 ≈ 14:1                                                    |
| `--muted`     | `#93A0B8`               | Secondary text, labels                             | Contrast on ink-950 ≈ 5.4:1 — passes AA for normal text                                                    |
| `--gold`      | `#E9B44C`               | Primary accent: CTAs, XP, active states, Ratings   | Confident, warm, "money" without green's buy/sell meaning; contrast on ink-950 ≈ 8:1                       |
| `--gold-deep` | `#C99635`               | Gold hover / pressed, gold text on light           | Darker gold for states where `#E9B44C` is too light                                                        |
| `--gold-soft` | `rgba(233,180,76,0.12)` | Gold tinted backgrounds (active nav, XP bar track) | Lets gold mark a region without a solid block                                                              |
| `--mint`      | `#3ED598`               | Gain / correct / success                           | Green means "good" universally; distinct from gold so gains never look like brand                          |
| `--rose`      | `#F26D6D`               | Loss / wrong / risk / destructive                  | Warm red, not alarm red; matches the concept                                                               |
| `--sky`       | `#5AA9FF`               | Info, links, Trading Rating                        | Blue is reserved for the trading side so Learning (gold) and Trading (sky) are visually separable          |
| `--violet`    | `#B48CFF`               | Admin only                                         | Violet is quarantined to admin screens; it never appears in the learner product (fixes the current drift)  |

**Rules:** gold is the only accent on learner screens; mint/rose appear only as
semantic feedback (never as decoration); sky appears only on trading screens
(simulator, sprint, crisis, weekly) and in the Trading Rating badge; text on gold
buttons is ink-950 (`#0B1120`), never white. **Violet is banned outside `/admin`.**

**Tier colours (Ratings, doc 04):** Bronze `#C08A5A`, Silver `#AAB4C0`, Gold `#E9B44C`,
Platinum `#7EE0D2`, Diamond `#5AA9FF`, Master `#B48CFF`. Tier colours are used only
inside Rating badges — never as page accents — so the Master violet does not leak
into the learner UI.

---

## 4. Typography

- **Family:** Inter (via `next/font/google`, self-hosted) for all UI; system stack
  (`-apple-system, "Segoe UI", Roboto, sans-serif`) as fallback. No display serif —
  the concept used the system stack and Inter keeps that restraint while fixing the
  current "default font" look.
- **Scale (mobile-first):** Display `32/36` bold (landing hero only); H1 `24/30`
  bold; H2 `20/28` semibold; H3 `17/24` semibold; body `15/24` regular; small
  `13/20`; caption/label `12/16` uppercase, `tracking-wide`, muted. Desktop adds
  +2px to Display/H1 only.
- **Numbers:** `font-variant-numeric: tabular-nums` everywhere a number changes
  (XP, Ratings, timers, money) so count-ups never jitter.
- **Rules:** one H1 per screen; section labels are always the caption style (kills
  the current `text-lg font-semibold` vs `font-medium` drift); money is always
  `₹` + Indian grouping (`₹1,00,000`), never `$`; Ratings display rounded to the
  nearest integer, stored value to 1 decimal (doc 04).

---

## 5. Spacing, radius, elevation

- **Spacing scale:** 4px base — `4 / 8 / 12 / 16 / 24 / 32 / 48 / 64`. Page padding
  `16px` mobile, `32px` desktop. Card padding `16px` (mobile) / `24px` (desktop).
  Section gap `24px` mobile / `32px` desktop.
- **Radius:** `--radius: 14px` cards, `10px` inputs/buttons, `999px` pills and avatars.
  (From the concept; kept because 14px reads "product", not "bootstrap".)
- **Elevation:** flat by default — depth comes from `1px` ink-700 borders on ink-900,
  not shadows. One shadow only: floating elements (bottom nav, dialogs, toasts)
  `0 8px 32px rgba(0,0,0,0.45)`.
- **Layout:** content `max-w-5xl` (up from 4xl — the Exchange map and duel screens
  need room), `max-w-2xl` for reading (lesson article, forms). No nested `<main>`
  elements — the shell owns the only `<main>`.

---

## 6. Component library

All components live in `apps/web/components/` (new — the directory does not exist
today). Each is a single file, typed props, no page logic inside.

### 6.1 Primitives

- **Button** — variants: `primary` (gold bg, ink text), `secondary` (ink-800 bg,
  paper text), `ghost` (transparent, gold text), `danger` (rose outline).
  Sizes `md` (`px-5 py-2.5`) and `lg` (`px-6 py-3.5`). One canonical string —
  kills the current ~14 re-typed variants. `disabled` = `opacity-50` + no pointer
  events, everywhere. Focus: `focus-visible` 2px gold ring, offset 2px (fixes the
  zero-`focus:` audit finding).
- **Input / Select / Textarea** — ink-900 bg, ink-700 border, `10px` radius,
  `px-3 py-2.5`; error state = rose border + rose caption (never red page text).
- **Card** — ink-900 bg, ink-700 border, `14px` radius, `16/24px` padding.
  Variants: `default`, `gold` (gold left border 3px — used once per screen max,
  for the "next step" card), `danger` (rose border, destructive confirmations).
- **Tabs** — underline style, gold active indicator; used on profile
  (Overview / Ratings / Learning / Duels / Simulator / Badges) per doc 06 §1.4.
- **Toggle** — switch control for settings (notifications, showcase); gold when on.
- **Dialog** — centred sheet, ink-900, max `90dvh`, scrollable, close button
  always visible; fits 360px phones with no overflow (DAN mobile rule, adopted).
- **Toast** — bottom-centre, ink-800, auto-dismiss; success = mint tick, error =
  rose tick. Replaces full-page error `<p>`s.
- **Skeleton** — shimmer blocks in ink-800 for every loading state (replaces
  `Loading…` text).
- **EmptyState** — geometric mark + one line + one CTA (pattern already used well
  on dashboard; standardised).
- **Disclaimer** — one shared component (kills the duplicated 14-line disclaimers
  in `duels/disclaimer.tsx` and `simulator/disclaimer.tsx`): "Educational purpose
  only — not investment advice. All tickers and numbers are fictional."

### 6.2 Gamification components (the "not gamified" fix)

- **XpBar** — gold fill on gold-soft track, `Xp 1,240 / 2,000 · Analyst`, animated
  width transition; count-up on gain (signature moment 1).
- **ProgressRing** — streak ring: gold arc, number in the centre, confetti-ring
  burst on a new streak day (signature moment 2). Replaces the `🔥 {n}` emoji.
- **StreakPill** — `12-day streak` with a small flame _shape_ (SVG, not emoji),
  gold when active, muted when broken.
- **BadgeChip** — geometric badge mark + name; locked state is a muted outline
  (never a greyed emoji). Unlock plays the medal-drop + shine sweep (moment 4).
- **RatingBadge** — tier colour chip + tier name + rounded Rating
  (`Gold · 1,342`); Learning gold, Trading sky, Candle split gold/sky.
- **CareerLadder** — vertical ladder Intern → Analyst → Strategist → Risk Manager
  → Portfolio Manager → Market Expert; current title highlighted, next title
  with XP remaining. Shown on dashboard and profile.
- **MentorCard / MentorMark** — see §7.

### 6.3 Duel components (unifies the six duplicated shells)

- **DuelShell** — one shell for live/blitz/case/chart/sprint/crisis: phases
  queue → countdown → play → reveal → result; owns queue state, bot offer,
  opponent-gone, host line, and the score bar. Each duel type supplies only its
  question/trading panel. This is the single biggest de-duplication in the plan
  (audit finding 7).
- **TimerBar** — full-width `h-2` bar, gold, drains linearly; turns rose under
  5s. One duration rule (fixes `duration-100` vs `duration-500` drift).
- **ScoreBar** — two-sided live score (names hidden until reveal — scores, not
  answers, per doc 05); animated width.
- **AnswerOption** — full-width card button, `py-3`, min 44px target; states:
  idle / selected (gold border) / correct (mint) / wrong (rose) / disabled.
  TRUE/FALSE uses two large buttons (green-tint left, red-tint right, per doc 08).
- **HostLine** — mentor mark + name + one-line dialogue bubble; appears before
  and after a duel only, never during a question (doc 08 rule).
- **ResultPanel** — win/loss/draw headline in tier colour, Rating change in plain
  words ("+24 Rating — you beat a stronger opponent"), XP breakdown, per-topic
  worst-first list, "Practise next" lesson link, share card (text + link, doc 06
  decision 8), rematch button with the 5-min cooldown state. Builds on the
  existing `result-view.tsx`, which it replaces as the visual layer.

### 6.4 Trading components

- **EquityCard** — cash / equity / P&L with mint/rose colouring and a sparkline
  (SVG, drawn from data — the chart renderer's technique, reused).
- **OrderTicket** — buy/sell form with whole-unit validation and max-120-orders
  state; server-priced note ("Price is set by the server at execution").
- **CrashBanner** — rose banner + panel for Crisis Duel (crash minute, −12% fall,
  recovery) — the only place rose is a full banner, so it reads as an event.

### 6.5 Motion — the four signature moments (CSS keyframes now, Lottie later)

1. **XP float:** `+20 XP` rises and fades above the XP bar; number counts up.
2. **Streak ring:** confetti rings expand from the ProgressRing on a new streak day.
3. **Checkmark draw:** lesson-complete checkmark draws itself (stroke-dashoffset).
4. **Badge drop:** medal drops in with a shine sweep.
   All four already exist as CSS keyframes in `docs/design-concept/index.html:287-303`
   — port them, do not re-invent them. Global rule: `prefers-reduced-motion` disables
   all four (static end state shown instead). No other animation is allowed in v1 —
   no spinners (use skeletons), no hover bounces.

---

## 7. Mentors — character treatment

Locked decisions: original characters only; roles kept (Mira Daily Coach, Kabir
Analyst, Tara Risk Guardian, Dev Patient Builder, Anaya Portfolio Architect, Rey
Frontier Explorer); no Clash of Clans, no cartoonish look; Lottie deferred.

- **Visual:** a named avatar — geometric identity mark + initials + role colour —
  exactly as the concept prototyped (Mira compass rose, Kabir bars, Tara shield,
  Dev foundation block, Anaya tower, Rey compass star). One mark per mentor, drawn
  as inline SVG, same mark everywhere (map, host line, mentor card, streak
  reminder). No faces, no illustrated characters in v1 (open question Q2 may change
  this later — the mark is designed to be swapped for art without touching logic).
- **Mood tag:** a small text tag under the avatar (`encouraging`, `focused`,
  `cautious`, `proud`) that will later map to a Lottie file (`mira-happy.json`
  etc.) with no logic change (doc 08 §2).
- **Voice:** one-line dialogue bubbles before/after duels and lessons only; hosts
  never speak during a rated question; reactions are to the result, never to
  individual answers (doc 08 §2). Streak reminders arrive "in character-emotions
  widget style" (doc 06 decision 9): a mentor reacting, not a plain push.
- **Role colours:** Mira gold, Kabir sky, Tara rose, Dev mint, Anaya violet-tinted
  teal `#7EE0D2`, Rey gold-deep. Colours mark _who_ is speaking, never a game state.

---

## 8. Responsive rules (mobile-first)

- **Breakpoints:** `360` (min supported) / `640` / `768` / `1024` / `1280`.
  Design at 360 first; desktop is the same layout with more columns, never a
  different screen.
- **Navigation:** mobile = bottom tab bar (Home / Learn / Duels / Simulator /
  Profile), 5 tabs, icons + labels, 56px high, safe-area padding; desktop = top
  nav (current `Nav`, extended with Duels + Profile links and an XP/streak chip).
  The mobile tab bar replaces the current overflowing `flex gap-6` row.
- **Touch targets:** minimum 44×44px for every tappable control (fixes the `py-1`
  copy-link, `py-2` leave-queue, and nav links). Answer options `py-3` minimum;
  TRUE/FALSE `py-6`.
- **Tables:** every table gets `overflow-x-auto` (fixes weekly standings, the one
  un-wrapped table); on mobile, standings collapse to cards below 640px.
- **Dialogs/sheets:** max `90dvh`, scrollable, buttons always reachable — the DAN
  mobile rule, adopted here.
- **Safe areas:** `env(safe-area-inset-bottom)` on the tab bar; no content under
  the notch.
- **Duel screens on mobile:** timer bar pinned to top; answer options full-width
  single column; score bar condensed to two numbers + bar; host line collapses to
  mark + name (bubble hidden during play — it never speaks mid-duel anyway).

---

## 9. Accessibility

- **Contrast:** paper on ink-950 ≈ 14:1; muted on ink-950 ≈ 5.4:1 (AA normal text);
  gold on ink-950 ≈ 8:1; gold text on gold-soft passes AA; never use muted text
  below 12px.
- **Focus:** visible 2px gold `focus-visible` ring on every interactive element
  (fixes the zero-`focus:` finding). Focus order follows visual order; dialogs trap
  focus and return it on close.
- **Touch:** 44px minimum (§8); no hover-only information — every hover state has
  a tap equivalent.
- **Motion:** `prefers-reduced-motion` kills all four signature moments and all
  transitions over 150ms; the reduce-motion setting (Phase 13) is respected
  app-wide, not just in settings.
- **Screen readers:** timer is `aria-live="off"` during play (it changes every
  second — announcing it would spam) and announces only on question change and
  result; score changes announced politely; charts have text equivalents
  (trend + annotation in words, per doc 08 reveal rule).
- **Language:** simple, short English throughout (Nishu's standing preference);
  no jargon without a one-line explanation.

---

## 10. Screens (what each screen is, in this system)

| Screen           | Route                              | Key components                                                                           | Notes                                                                                             |
| ---------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Landing          | `/`                                | Hero, mentor strip, Ratings teaser, Duels CTA                                            | Logged-in state: "Continue" + Daily Duel card; currently static for everyone                      |
| Home / Dashboard | `/dashboard`                       | Exchange map, CareerLadder, XpBar, StreakPill, RatingBadge ×3, continue card, Daily Duel | The Exchange map is the home identity — 6 zones, clickable, current zone highlighted              |
| Tracks           | `/tracks`, `/tracks/[slug]`        | Track cards, progress bars                                                               | Mostly a reskin; keep structure                                                                   |
| Lesson           | `/lessons/[id]`                    | Article, AnswerOption quiz, completion panel (checkmark draw)                            | Markdown renderer gains callouts + tables (§9 gap: no images yet)                                 |
| Duels hub        | `/duels`                           | DuelCard ×10 with host, Rating, format tag                                               | Grouped: Practice / Learning rated / Trading rated; Friend Challenge card links to challenge page |
| Live duel        | `/duels/live` (+ blitz/case/chart) | DuelShell, TimerBar, ScoreBar, AnswerOption, HostLine                                    | One shell, four question panels                                                                   |
| Trading duel     | `/duels/sprint`, `/duels/crisis`   | DuelShell, EquityCard, OrderTicket, CrashBanner                                          | Same shell, trading panel instead of questions                                                    |
| Weekly           | `/duels/weekly`                    | League standings, portfolio, trade form                                                  | Standings collapse to cards on mobile                                                             |
| Challenge        | `/duels/challenge`                 | Invite form, pending lists                                                               | User-id input stays until friend lookup exists (§9 gap)                                           |
| Result           | `/duels/[id]/result`               | ResultPanel                                                                              | Replaces `result-view.tsx` visuals; data unchanged                                                |
| Simulator        | `/simulator*`                      | EquityCard, holdings table, OrderTicket                                                  | Add sparkline; disclaimer component shared                                                        |
| Profile          | `/profile`, `/u/:id`               | Tabs, RatingBadge, CareerLadder, last-5 history, showcase                                | **New — Phase 13 API exists**                                                                     |
| Settings         | `/settings`                        | Sections: account, security/sessions, notifications, appearance, data (export/delete)    | **New — Phase 13 API exists**                                                                     |
| Leaderboard      | `/leaderboard` (new)               | RatingBadge table, global + per-country tabs                                             | **New screen; needs API gap closed (§9)**                                                         |

---

## 11. Application plan — how this lands in `apps/web` (NOT applied yet)

Order matters: tokens first, then shell, then screens. Each step is independently
reviewable and shippable; stop after any step.

| Step | Change                                                                                                                                                                                                                                              | Files                                                                                                                   |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 0    | **Tokens.** Extend `tailwind.config.ts` with §3 palette, §4 type scale, §5 radii; rewrite `globals.css` with CSS variables + the 4 keyframes + `prefers-reduced-motion`.                                                                            | `tailwind.config.ts`, `app/globals.css`                                                                                 |
| 1    | **Primitives.** New `components/` directory: Button, Input, Card, Tabs, Toggle, Dialog, Toast, Skeleton, EmptyState, Disclaimer, XpBar, ProgressRing, StreakPill, BadgeChip, RatingBadge, MentorMark. Delete the duplicated disclaimer files.       | `components/*`, delete `app/duels/disclaimer.tsx`, `app/simulator/disclaimer.tsx`                                       |
| 2    | **Shell + nav.** Extend `Nav` (Duels + Profile links, XP/streak chip, active states); add mobile bottom tab bar; fix `layout.tsx` max width to `max-w-5xl`; remove nested `<main>` in duels hub + result page.                                      | `app/layout.tsx`, `app/nav.tsx`, new `components/BottomNav.tsx`, `app/duels/page.tsx`, `app/duels/[id]/result/page.tsx` |
| 3    | **Home + landing.** Logged-in landing state; dashboard rebuild (Exchange map, CareerLadder, Ratings, continue card, Daily Duel). Port the map SVG from the concept.                                                                                 | `app/page.tsx`, `app/dashboard/page.tsx`, new `components/ExchangeMap.tsx`                                              |
| 4    | **Lesson.** Reskin lesson + quiz with AnswerOption + completion moment; add callouts to the markdown renderer.                                                                                                                                      | `app/lessons/[id]/page.tsx`                                                                                             |
| 5    | **Duel shell.** Extract `DuelShell` + TimerBar + ScoreBar + HostLine + AnswerOption; migrate live → blitz → case → chart (one per commit); then sprint/crisis onto the shell with trading panels. Keep all socket logic untouched — only JSX moves. | `components/DuelShell.tsx` etc., `app/duels/live                                                                        | blitz | case | chart | sprint | crisis/page.tsx` |
| 6    | **Result.** Rebuild `result-view.tsx` as ResultPanel; wire share card + rematch states.                                                                                                                                                             | `app/duels/result-view.tsx`, `app/duels/[id]/result/page.tsx`                                                           |
| 7    | **Profile + Settings (new screens).** Build `/profile`, `/u/:id`, `/profile/edit`, `/settings` against the Phase 13 API (§10 table). Add profile link + avatar to nav.                                                                              | New `app/profile/*`, `app/settings/*`, `lib/api.ts` (profile/settings types)                                            |
| 8    | **Simulator + weekly + challenge reskin.** EquityCard + sparkline; standings cards on mobile; challenge form keeps raw user-id until §9 gap closes.                                                                                                 | `app/simulator/*`, `app/duels/weekly/page.tsx`, `app/duels/challenge/page.tsx`                                          |
| 9    | **States + a11y pass.** Skeletons + retry on every data page; `focus-visible` audit; 360px pass on every screen; `prefers-reduced-motion` audit.                                                                                                    | All pages                                                                                                               |
| 10   | **Leaderboard.** Only after the §9 API gap is closed.                                                                                                                                                                                               | New `app/leaderboard/page.tsx`                                                                                          |

**What stays API-only for now:** admin CMS (reskin deferred — it is not a learner
screen), push delivery of streak reminders (preference + scheduling hook only),
server-generated share-card images (doc 06 decision 8: later).

**Verification per step:** `npm run build` (web), typecheck, lint, Prettier; visual
check at 360px and 1280px; e2e suite must stay green (unit 687 / e2e 151 at Phase 13
— the redesign must not move those numbers).

---

## 12. API / data gaps (list, do not invent)

1. **No leaderboard endpoint.** Ratings exist per-user; there is no global or
   per-country leaderboard read. Leaderboard screen waits on this.
2. **No user lookup / search.** Friend Challenge needs a raw userId; there is no
   "find a user by name" endpoint. Challenge form keeps the raw input until this
   exists (friends phase).
3. **No avatar upload.** Profiles have no avatar image field — the avatar is the
   initials + geometric mark. If Nishu wants uploaded photos, that is a new
   endpoint + StorageService work, not a UI decision.
4. **No lesson images.** The lesson markdown renderer supports headers/bold/lists
   only; no image/table/callout blocks in the curriculum yet.
5. **Streak reminder delivery.** Settings store the preference (7pm, max 1/day);
   there is no push/notification delivery system. The in-app character-emotions
   widget is the v1 surface.
6. **Country is null for everyone in v1** (signup collects no country — Phase 13
   limit). National leaderboards and country flags on profiles are empty until
   the signup flow collects it.

---

## 13. Open questions for Nishu

Carried from the 2026-11-02 concept (still unanswered) plus new ones from this pass:

1. **Palette:** is ink + gold professional _enough_, or does it still feel too
   game-like? (Concept Q1 — the whole system rests on this answer.)
2. **Mentors:** do the geometric identity marks work, or do you want illustrated
   characters after all (still non-cartoonish)? (Concept Q2.)
3. **Onboarding length:** 5 questions right, or 3 / 8? (Concept Q3 — the live
   onboarding assessment already uses 12; the concept's 5 was a prototype number.)
4. **Placement override:** should the result screen let the user override the
   placement ("start from zero anyway")? (Concept Q4.)
5. **Light mode:** dark-first is specified here; is a light theme ever wanted, or
   is dark the product identity?
6. **Bottom tab bar:** mobile gets a bottom tab bar (Home / Learn / Duels /
   Simulator / Profile) — happy with those five tabs?
7. **Leaderboard priority:** build the leaderboard API + screen now, or after
   friends + chat?

## 14. Round 2 — what changed from round 1 and why (ERP-dashboard look → game-first look)

Round 1's failure was structural, not cosmetic. It kept the dashboard's
information architecture (sidebar + grey card grid + tables as the home screen)
and only re-skinned it in ink + gold. A re-skin of a dashboard is still a
dashboard. Round 2 changes the architecture itself, using the research in
doc 20:

| Round 1 (rejected)                                | Round 2 (game-first)                                                                                                                             | Research basis                                                                                                                                         |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Home = sidebar + grey card grid + tables          | Home = a winding **Exchange path** through the 6 zones; the game IS the home screen                                                              | Duolingo path (§2.1); Khan Path view                                                                                                                   |
| Stats as KPI widgets                              | Streak flame, XP bar, gems, league position in a thin **HUD**; numbers are heroes                                                                | Duolingo §2.2; Matiks §3.5 status strip                                                                                                                |
| Geometric mentor marks only                       | Mentors as **illustrated-feeling character cards** with mood, speech bubbles, reactions                                                          | Duolingo §2.4; Headspace orbs §6.6 — but warm + characterful, non-cartoonish, professional                                                             |
| Flat buttons, soft blurred shadows                | **Chunky ledge buttons**: gold face, hard darker-gold ledge, press = down 4px, spring back                                                       | Duolingo §2.3 (3D ledge button)                                                                                                                        |
| Flat, static backgrounds                          | **Layered, alive backgrounds**: background frames, ambient/interactive elements, scene depth, parallax on edge scenery only, hover/tap responses | Spotify Canvas + art-derived gradients (§4.7); Headspace low-amplitude aliveness (§6.5); Duolingo + Creedo "quiet centre, scenery at the edges" (§2.7) |
| Grey cards, 1px borders everywhere                | **Tonal depth, not borders**: stepped ink surfaces; gold rationed to the one primary action                                                      | Spotify §§4.2, 4.8                                                                                                                                     |
| Duels as a list of rows                           | **Arena framing**: live-event feel, vs cards, 3-2-1 countdown, live scores, 60-second tension                                                    | Matiks §§3.3, 3.7                                                                                                                                      |
| Result = a card with numbers                      | **Scene-change celebration**: full-bleed takeover, Rating in plain words, XP count-up, badge moment, rematch                                     | Duolingo §2.5; Spotify Wrapped rule (restraint all year earns one loud moment)                                                                         |
| Generic "premium" (mesh gradients, glassmorphism) | **One ownable world**: ink canvas, gold voltage, original mentors, bespoke display voice                                                         | §9 avoid-list items 5, 12, 13, 26 in doc 20                                                                                                            |

**Rules that did not change:** ink `#0B1120` + gold `#E9B44C` identity; one
accent rationed to one verb; no Clash of Clans theme/characters; no copied
characters; fictional tickers/money only, disclaimers on trading screens;
mobile-first; hosts speak before/after, never during a rated question.

**Rules added in round 2:**

- **Quiet centre, scenery at the edges.** The path corridor stays open and
  legible; world-building (Exchange-district scenery, mentors, ambient props)
  lives at the left/right edges and in unit banner colours. Parallax only on
  edge scenery, never under tappable nodes. (Duolingo + Creedo lesson, doc 20 §2.7.)
- **Aliveness at low amplitude on calm screens, loud only at celebrations.**
  Idle life everywhere (mentors blink/breathe/react, current node pulses,
  streak flame idles at a 2s pulse) — but a busy animated backdrop must never
  fight legibility. (Headspace §6.5; Spotify §4.7.)
- **Characters have jobs.** A mentor appears because it hosts, coaches,
  opposes, or celebrates — never as decoration on a generic card. (Doc 20 §9
  item 8.)
- **Failure is safe.** Wrong answers get a gentle banner ("Correct solution:…")
  and progress still advances slightly; no harsh red screens, no buzzer.
  (Duolingo §2.5.)
- **The §9 avoid-list in doc 20 is a checklist on every screen.** If a screen
  could manage inventory, it is wrong.

**Correction recorded in doc 20:** Matiks' mascot is **Sero**, not "Siro".
Earlier Candle docs used "Siro" as the Matiks reference name. Use Sero from
here on. (Candle's own mentors are unaffected.)

**Application plan (§11) is unchanged in order** — steps 0–10 still apply —
but steps 2–6 now land the round-2 visual language (path home, ledge buttons,
alive backgrounds, character cards), not the round-1 dashboard language.
Still NOT applied; `apps/web` is untouched until Nishu approves the round-2
prototype.

---

## 15. Round 3 — colour grading (refined gold + ink, plus 5 alternative identities)

**Date:** 2026-11-13. **Status:** design + documentation, then round-3
integration (same day). Nothing in `apps/web` has been changed. The
prototype artifact (`candle-ui-prototype`) **has** now been rebuilt from the
hand-off spec in §15.8 — refined gold + ink default, six-theme switcher,
Lottie wired in; §15.10 records how, what was verified, and what is still
open. **Scope note:** this section is the
colour-grading design. Lottie pipeline notes are in §15.10 (written during
the round-3 integration, after seeing the Lottie files).

**What Nishu asked, in two parts.** (1) Round-2 feedback: "better than round
1, but colour grading can be much better." (2) Expanded brief: "why we stick
to gold + ink — keep exploring DIFFERENT professional and cool colour
gradings that are efficient in any manner." So §15 does both: §15.1–§15.6
refine gold + ink into a richer grade (Variant 1, the refined default), and
§15.7 explores five complete alternative identities on the same structure,
scored on the same efficiency tests, so Nishu can compare them live in the
prototype via the theme switcher specified in §15.8. Gold + ink is kept as
one of the switcher options — it is not deleted.

### 15.1 Research — what "good colour grading" means for a dark, game-first UI

Grading here means film-style grading applied to UI tokens: deciding the
colour temperature of shadows, midtones, and highlights separately, then
holding that split consistently across every screen — not "pick a prettier
accent". Sources (all fetched 2026-11-13; full treatment in doc 20):

1. **Tonal depth is lightness steps, not borders.** Spotify's stack is
   `#121212` base → `#181818` card → `#1f1f1f` interactive →
   `#282828` hover, with panels separated by black gutters and 8px corners,
   "not borders" (doc 20 §4.2; Spotify reconstructions corroborated at
   https://www.shadcn.io/design/spotify and
   https://agent-ds.oday-bakkour.com/systems/spotify). Material Design 3
   says the same: dark elevation is "tonal difference", higher surfaces
   lighter, with a brand-colour surface tint (M3 colour roles,
   https://m3.material.io). Dark-mode guides agree on 3–4 lightness levels
   with 2–4% steps each, e.g. base L:10–12%, cards L:17–19%, modals
   L:21–23% (https://colorarchive.org/guides/dark-mode-accessible-night-themes/).
   Round 2 failed this test: its four ink steps (`#0B1120` → `#131C31` →
   `#1A2540` → `#26314D`) were all the same cold navy at similar saturation,
   so cards read as "grey boxes with borders" instead of depth.
2. **Split the temperature: cool shadows, warm light.** The most-used
   cinematic grade is warm highlights against cool shadows — "warm amber
   highlights with cool teal shadows… that split is what makes
   teal-and-orange read as cinematic instead of just orange" and "a cinematic
   grade almost always splits temperature — warm somewhere, cool somewhere
   else. Flat, single-temperature color is what makes [work] look like stock
   footage" (https://seedance-2.app/blog/seedance-2-0-color-grading;
   https://xprmts.com/blogs/journal/teal-and-orange-color-grading;
   https://photoguide.site/blog/content/color-grading-tips-for-stunning-photos).
   The mechanism is Chevreul's 1839 law of simultaneous contrast: warm
   against cool pushes both further apart, so a warm face/figure stands out
   from a cool room. Candle's translation: **shadows and surfaces stay cool
   navy; light — paper text, gold, mentor faces, glows — is warm.** Round 2
   had this backwards in one place: its paper `#E9EEF8` and muted `#93A0B8`
   were both cool blue-greys, so the "light" in the UI was the same
   temperature as the shadows and nothing glowed.
3. **Desaturate and lighten accents for dark.** Saturated colour "blooms"
   on near-black: "reduce chroma by roughly a quarter and raise lightness"
   (https://www.huely.net/learn/); "desaturate accent colors by 10 to 20
   percent, and lighten them by 15 to 25 percent"
   (https://aircolor.benjaminbellamy.com/dark-mode-color-palette-guide/;
   https://colorarchive.org/guides/dark-mode-palette-guide/). Round 2's sky
   `#5AA9FF` (S 100%) was the worst offender — electric against ink.
4. **One accent, rationed to one verb.** Spotify green appears "only on:
   play/pause controls, active nav, primary CTAs… Used exactly once or
   twice per viewport — never decoratively", ~5% of the screen, and always
   pairs with black text, never white (doc 20 §4.2; UXPin's 2026 survey
   concurs: "Spotify's dark interface reduces visual competition… the
   signature green is used exclusively for interactive elements",
   https://www.uxpin.com/studio/blog/color-schemes-for-apps/). Every
   variant in §15.7 obeys this: one accent, one ledge tone, everything
   else ink/paper/semantic.
5. **Ambient light colours the room; chrome never does.** Spotify washes a
   page's top 232px in a gradient sampled from its content, fading into
   `#121212`, and scrims (gradient falloff, never a flat dark panel) keep
   text legible over imagery (doc 20 §4.7). Duolingo's equivalent is
   colour-field zoning per unit plus characters-as-scenery at the edges with
   a quiet centre (doc 20 §2.7). Round 2 had ambient layers in prose but
   no glow/scrim/vignette tokens — so the prototype's edges were flat ink.
6. **Characters must sit inside the grade.** A character colour that is
   not a tint of the palette reads as a sticker. The rule adopted here:
   every mentor colour shares the palette's lightness band (L ≈ 51–71%)
   and a capped saturation (S ≈ 49–86%), and is a tint of a palette colour
   (gold, sky, rose, mint, teal, deep gold) — never a new hue.
7. **Contrast is recomputed, not inherited.** WCAG 2.2 AA: 4.5:1 normal
   text, 3:1 large text / UI components. Pure white on pure black (21:1)
   causes halation and fatigue; near-white at ~14–15:1 is the comfortable
   AAA target (https://www.huely.net/learn/;
   https://blog.jiteshprakash.com.np/blog/dark-mode-design-beyond-inverting/).
   **Correction to doc §§3/§9:** the ratios quoted there were understated.
   Recomputed with the WCAG relative-luminance formula, the old tokens on
   old ink-950 `#0B1120` are paper **16.18:1** (doc said ≈14:1), muted
   **7.14:1** (doc said ≈5.4:1), gold **9.95:1** (doc said ≈8:1). The
   targets in §15.3 are therefore stated against recomputed numbers, and
   the muted token is deliberately _dimmed_ from its old actual 7.14:1
   back toward ~6.4:1 to restore the paper/muted hierarchy.

### 15.2 The grade in one sentence (Variant 1)

**Deepen the ink, warm the light, cool the shadows.** Canvas drops from
`#0B1120` (L 8%) to `#070C18` (L 6.1%) with a new near-black shell
`#05080F` below it, so the screen has somewhere darker to go; surfaces step
up in six small warm-neutral lifts instead of four cold jumps; paper warms
from cool blue-white `#E9EEF8` (H 220°) to warm ivory `#E6DFCE` (H 40°);
muted warms from blue-grey `#93A0B8` to warm taupe `#9C9284`; gold deepens
and warms from `#E9B44C` (H 40°, S 78%) to `#EBA93B` (H 38°, S 81%, L 58%)
with a darker, more saturated ledge `#B07E24`; sky is desaturated
(S 100% → 80%) and lightened; rose warms toward coral; mint shifts a touch
toward teal. Ambient light is now tokenised: per-zone glows at 8–10%
opacity, top/bottom scrims, and a vignette that darkens the edges and
leaves the centre corridor lit.

### 15.3 Variant 1 — refined gold + ink: before/after token table

Every row is a mechanical swap for the applying agent (old value → new
value). `NEW` rows have no old value. Tokens not listed are unchanged.

| Token                                        | Old                     | New                                                                            | Reason                                                                                                                                                                                                                     |
| -------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--ink-1000` (shell/gutters)                 | —                       | `#05080F`                                                                      | NEW. A floor darker than the canvas, like Spotify's `#000000` shell vs `#121212` panel: gives the canvas somewhere to lift from and makes the bottom nav / modal scrim read as depth, not as a lighter panel               |
| `--ink-950` (app canvas)                     | `#0B1120`               | `#070C18`                                                                      | Deepened L 8% → 6.1%, saturation 49% → 55%. Cooler, darker shadows = more headroom for the warm light above them; still not pure black (halation)                                                                          |
| `--ink-900` (card)                           | `#131C31`               | `#0F182C`                                                                      | Deepened L 13% → 11.6%. The old card sat too close to the old canvas; the step canvas→card is now cleaner                                                                                                                  |
| `--ink-850` (section / duel panel)           | —                       | `#141F38`                                                                      | NEW. Fills the old 900→800 jump: lesson-article wells, duel panels, and tab panels get their own step instead of reusing the card or the raised surface                                                                    |
| `--ink-800` (raised / hover)                 | `#1A2540`               | `#182742`                                                                      | Slightly deeper, hue nudged 223° → 219° (a touch warmer) so hovered surfaces feel lit, not just lighter                                                                                                                    |
| `--ink-700` (subtle border/divider)          | `#26314D`               | `#222E4C`                                                                      | Darker (L 23% → ~19%) — depth from tonal steps, not hard borders (Spotify rule, §15.1.1). Border-vs-card step stays ~1.3:1, as before                                                                                      |
| `--ink-600` (strong border / input)          | —                       | `#2B375C`                                                                      | NEW. Inputs, selected outlines, and borders that must read at 3:1 as UI components use this, not ink-700                                                                                                                   |
| `--paper` (primary text)                     | `#E9EEF8`               | `#E6DFCE`                                                                      | Warmed H 220° → 40° (cool blue-white → warm ivory). This is the single biggest grading move: the light in the UI is now warm against cool shadows (§15.1.2). Deliberately dimmed so contrast lands at 14.71:1, not 16.79:1 |
| `--muted` (secondary text)                   | `#93A0B8`               | `#9C9284`                                                                      | Warmed to taupe (H 219° → ~35°). Deliberately dimmed vs its old actual 7.14:1 to 6.38:1 — restores the paper/muted hierarchy that the old token had collapsed                                                              |
| `--muted-bright` (small text on raised)      | —                       | `#A8A091`                                                                      | NEW. `--muted` falls to 4.87:1 on ink-800; small text on raised/hover surfaces must use this instead (5.76:1 on ink-800, 5.31:1 on hover)                                                                                  |
| `--gold` (accent)                            | `#E9B44C`               | `#EBA93B`                                                                      | Warmer + deeper (H 40° → 38°, L 61% → 58%, S 78% → 81%). Richer "money" gold; still 9.56:1 on canvas as text, 9.56:1 with ink text on a gold fill                                                                          |
| `--gold-bright` (XP count-up, flame core)    | —                       | `#F2BE55`                                                                      | NEW. The bright end of the gold ramp. Same value as Mira's colour, deliberately: Mira _is_ the gold mentor (§15.5)                                                                                                         |
| `--gold-deep` (ledge / pressed / hover-dark) | `#C99635`               | `#B07E24`                                                                      | Darker + more saturated (L 50% → 42%, S 58% → 66%). A ledge must read as a shadow under the gold face; the old value was too close to the face. Still 5.45:1 on canvas if ever used as text                                |
| `--gold-soft` (tinted wash)                  | `rgba(233,180,76,0.12)` | `rgba(235,169,59,0.14)`                                                        | Follows the new gold; alpha raised 0.12 → 0.14 because the canvas is darker now and the wash needs to survive it                                                                                                           |
| `--gold-glow` (ambient / celebration)        | —                       | `rgba(235,169,59,0.22)`                                                        | NEW. Celebration and hero glows only — never a button, never a card fill                                                                                                                                                   |
| `--mint` (gain / correct)                    | `#3ED598`               | `#3AD6A0`                                                                      | Shifted H 156° → 159° (a touch toward teal) so mint sits inside the cool-shadow family instead of glowing lime against it. 10.52:1 on canvas                                                                               |
| `--mint-soft` (correct-answer wash)          | —                       | `rgba(58,214,160,0.12)`                                                        | NEW. Correct-answer tint wash for AnswerOption; solid mint is never a background                                                                                                                                           |
| `--rose` (loss / wrong / risk)               | `#F26D6D`               | `#F2756B`                                                                      | Warmed H 0° → 4° (rose → coral-rose) so loss reads warm, like the gold family, not cold pink. 7.01:1 on canvas                                                                                                             |
| `--rose-soft` (wrong-answer wash)            | —                       | `rgba(242,117,107,0.12)`                                                       | NEW. Wrong-answer tint wash; CrashBanner uses this wash + rose text, not a solid rose block                                                                                                                                |
| `--sky` (trading / info)                     | `#5AA9FF`               | `#7AB3F0`                                                                      | Desaturated S 100% → 80% and lightened L 68% → 71% (§15.1.3 — the old sky was the most "blooming" token). 8.87:1 on canvas                                                                                                 |
| `--sky-soft` (trading wash)                  | —                       | `rgba(122,179,240,0.12)`                                                       | NEW. Trading-panel tint wash                                                                                                                                                                                               |
| `--violet` (admin only)                      | `#B48CFF`               | `#A88CFF`                                                                      | Hue shifted 261° → 255° (toward blue) so it sits with the ink instead of floating violet. **Ban unchanged: admin screens only, never learner UI**                                                                          |
| Mentor Mira                                  | `#E9B44C` (= gold)      | `#F2BE55`                                                                      | Now distinct from CTA gold by lightness (L 64% vs 58%): Mira is the _bright_ gold, the button is the _working_ gold                                                                                                        |
| Mentor Kabir                                 | `#5AA9FF` (= sky)       | `#7FB0E8`                                                                      | Softened sky (S 100% → 70%): a person, not a link                                                                                                                                                                          |
| Mentor Tara                                  | `#F26D6D` (= rose)      | `#F08A7A`                                                                      | Warmed coral-rose, distinct from loss-rose by hue (H 8° vs 4°) and lightness                                                                                                                                               |
| Mentor Dev                                   | `#3ED598` (= mint)      | `#4FD1A5`                                                                      | Softened mint (S 64% → 59%), lighter than gain-mint so Dev reads as a character, not a correct tick                                                                                                                        |
| Mentor Anaya                                 | `#7EE0D2`               | `#63C9B8`                                                                      | Deepened L 69% → 59%, S 61% → 49%: the old Anaya was the palest, most glowing mentor and clashed with mint; now clearly teal, clearly distinct from Dev                                                                    |
| Mentor Rey                                   | `#C99635` (= gold-deep) | `#D99A2B`                                                                      | Deep gold/amber, darker than Mira by ~13 lightness points: the "frontier" gold, not the "coach" gold                                                                                                                       |
| Tier Bronze / Silver                         | `#C08A5A` / `#AAB4C0`   | unchanged                                                                      | Already warm/neutral; no change needed                                                                                                                                                                                     |
| Tier Gold                                    | `#E9B44C`               | `#EBA93B`                                                                      | Follows new gold                                                                                                                                                                                                           |
| Tier Platinum                                | `#7EE0D2`               | `#63C9B8`                                                                      | Follows new Anaya teal                                                                                                                                                                                                     |
| Tier Diamond                                 | `#5AA9FF`               | `#7AB3F0`                                                                      | Follows new sky                                                                                                                                                                                                            |
| Tier Master                                  | `#B48CFF`               | `#A88CFF`                                                                      | Follows new violet                                                                                                                                                                                                         |
| `--glow-gold`                                | —                       | `rgba(235,169,59,0.10)`                                                        | NEW. Ambient zone glow, Foundation zone                                                                                                                                                                                    |
| `--glow-sky`                                 | —                       | `rgba(122,179,240,0.10)`                                                       | NEW. Markets zone                                                                                                                                                                                                          |
| `--glow-rose`                                | —                       | `rgba(242,117,107,0.08)`                                                       | NEW. Risk zone (lower alpha: rose blooms fastest)                                                                                                                                                                          |
| `--glow-mint`                                | —                       | `rgba(58,214,160,0.08)`                                                        | NEW. Growth zone                                                                                                                                                                                                           |
| `--glow-teal`                                | —                       | `rgba(99,201,184,0.08)`                                                        | NEW. Portfolio zone                                                                                                                                                                                                        |
| `--glow-deepgold`                            | —                       | `rgba(217,154,43,0.10)`                                                        | NEW. Frontier zone                                                                                                                                                                                                         |
| `--scrim-top`                                | —                       | `linear-gradient(180deg, rgba(5,8,15,0.65), rgba(5,8,15,0))`                   | NEW. Legibility falloff over hero/scenery art (Spotify scrim rule)                                                                                                                                                         |
| `--scrim-bottom`                             | —                       | `linear-gradient(0deg, rgba(5,8,15,0.75), rgba(5,8,15,0))`                     | NEW. Same, from below, for captions over art                                                                                                                                                                               |
| `--vignette`                                 | —                       | `radial-gradient(120% 90% at 50% 0%, transparent 55%, rgba(5,8,15,0.55) 100%)` | NEW. Darkens edges, leaves the centre corridor lit — the "quiet centre, scenery at the edges" rule made tokenised                                                                                                          |
| `--hero-wash`                                | —                       | `linear-gradient(180deg, <zone-glow at 0.16>, transparent 232px)`              | NEW. Per-screen hero wash sampled from the zone/mentor glow (Spotify's 232px fade, doc 20 §4.7), fading into the canvas                                                                                                    |

### 15.4 Contrast table (Variant 1, recomputed WCAG 2.x relative luminance)

Method: WCAG contrast = (L1 + 0.05) / (L2 + 0.05) on relative luminance.
All pairs below were computed from the hex values in §15.3 in this task
(scripted, not eyeballed). Pass bar: normal text ≥ 4.5:1, large text / UI
components ≥ 3:1. "Old actual" is the recomputed old value — the doc's
§§3/§9 figures (≈14 / ≈5.4 / ≈8) were understated; see §15.1.7.

| Pair                                    | Old actual | New         | Verdict                                                                          |
| --------------------------------------- | ---------- | ----------- | -------------------------------------------------------------------------------- |
| paper on ink-950 (canvas)               | 16.18:1    | **14.71:1** | AAA. Deliberately ~14.7, not 16.8 — warm + dimmed to avoid halation              |
| paper on ink-900 (card)                 | 15.20:1*   | 13.32:1     | AAA                                                                              |
| paper on ink-800 (raised)               | 12.82:1*   | 11.23:1     | AAA                                                                              |
| muted on ink-950                        | 7.14:1     | **6.38:1**  | AA, near the old _claimed_ 5.4:1. Hierarchy restored (paper 14.71 vs muted 6.38) |
| muted on ink-900                        | 6.70:1*    | 5.78:1      | AA                                                                               |
| muted on ink-800                        | 5.66:1*    | 4.87:1      | AA — smallest passing value in the system; do not use muted below 12px here      |
| muted-bright on ink-800                 | —          | 5.76:1      | AA. Use this, not muted, for small text on raised surfaces                       |
| muted-bright on ink-700-hover `#1E2C4E` | —          | 5.31:1      | AA                                                                               |
| gold on ink-950 (text)                  | 9.95:1     | **9.56:1**  | AAA                                                                              |
| gold on ink-900                         | 9.35:1*    | 8.65:1      | AAA                                                                              |
| ink-950 on gold (button text)           | 9.95:1     | **9.56:1**  | AAA. Gold buttons keep ink text, never white (Spotify rule)                      |
| gold-deep on ink-950 (text)             | 7.08:1     | 5.45:1      | AA. Ledge tone is usable as text if needed; its job is the ledge                 |
| mint on ink-950                         | 10.02:1    | 10.52:1     | AAA                                                                              |
| mint on ink-800                         | 7.94:1*    | 8.03:1      | AAA                                                                              |
| rose on ink-950                         | 6.44:1     | 7.01:1      | AAA                                                                              |
| rose on ink-800                         | 5.10:1*    | 5.35:1      | AA                                                                               |
| sky on ink-950                          | 7.67:1     | 8.87:1      | AAA                                                                              |
| sky on ink-800                          | 6.08:1*    | 6.77:1      | AAA                                                                              |
| violet on ink-950 (admin)               | 7.30:1     | 7.31:1      | AAA                                                                              |
| Mira `#F2BE55` on ink-950               | 11.00:1*   | 11.42:1     | AAA (mentor mark / name)                                                         |
| Kabir `#7FB0E8` on ink-950              | —          | 8.63:1      | AAA                                                                              |
| Tara `#F08A7A` on ink-950               | —          | 8.02:1      | AAA                                                                              |
| Dev `#4FD1A5` on ink-950                | —          | 10.23:1     | AAA                                                                              |
| Anaya `#63C9B8` on ink-950              | —          | 9.84:1      | AAA                                                                              |
| Rey `#D99A2B` on ink-950                | —          | 8.01:1      | AAA                                                                              |

\* Old-actual values on old card/raised surfaces, recomputed from old hexes
for comparison; the old doc never published them.
**Numbers and timers:** all numerals use tabular-nums (§4) and are set in
paper or accent on ink-950/900, i.e. ≥ 8.65:1 — timers, XP counts, Ratings,
and P&L figures are the highest-contrast elements on every screen, as they
must be when read at speed in a duel.

### 15.5 Grading rules (Variant 1 — these are rules, not suggestions)

1. **Six tonal steps, no more.** Shell 1000 → canvas 950 → card 900 →
   section 850 → raised 800 → border 700/600. A surface may only sit on
   the step directly below it (card on canvas, raised on card, dialog on
   raised). Skipping a step (e.g. a dialog straight on canvas) flattens
   depth; adding a seventh step re-invents the grey-box look.
2. **Temperature split, always.** Shadows/surfaces cool navy (H ≈ 219–224°);
   light warm (paper H 40°, gold H 38°, glows warm). No cool-white text,
   no warm-grey surface. If a new element needs a colour, ask first which
   side of the split it lives on.
3. **Gold rationing (unchanged, now enforced by tokens).** Gold appears
   only as: primary CTA face, active nav/tab indicator, XP bar fill, streak
   flame, Rating badge (Learning/Candle), current-node ring, focus ring.
   Gold-soft washes mark at most one region per screen; gold-glow appears
   only on the result screen and in hero washes. If gold appears twice in
   one viewport for two different meanings, one of them is wrong.
4. **Semantic colours are feedback, never decoration.** Mint/rose appear
   only as: correct/wrong answer states + washes, gain/loss figures,
   CrashBanner, toasts. Sky appears only on trading screens and the
   Trading Rating badge. Violet never leaves `/admin`.
5. **Mentor colours are tints, not new hues.** Each mentor colour is a
   tint of a palette colour (§15.3), in the L 51–71% band. A mentor mark
   uses its colour at full strength only at ≤ 48px; larger character art
   uses the same hue at lower saturation (wash the fill toward paper by
   ~15%). Mentor names in HostLine use the mentor colour at ≥ 4.5:1
   (all pass — §15.4); mentor speech-bubble text is always paper.
6. **Ambient grading.** Edge scenery and zone backgrounds use only the
   `--glow-*` tokens (8–10% alpha) over ink-950, plus `--scrim-top` /
   `--scrim-bottom` where text sits over art, plus `--vignette` on the
   Home path and result screens. **Centre corridor stays quiet:** no glow,
   no scrim, no vignette under tappable nodes, answer options, or the
   timer bar. Parallax only on edge scenery, never under tappable nodes
   (round-2 rule, unchanged). Glow alpha never exceeds 0.16 even in the
   hero wash — above that, scenery starts competing with content.
7. **Zone glows (Home path, one per Exchange zone).** Foundation → gold;
   Markets → sky; Risk → rose; Growth → mint; Portfolio → teal; Frontier →
   deep gold. A zone's banner, node ring, and edge scenery share its glow;
   the corridor itself stays ink-950.
8. **Ledge buttons follow the grade.** Gold face `--gold`, ledge
   `--gold-deep` (4px hard offset, no blur — round-2 rule). Pressed state:
   face darkens toward gold-deep, translates down 4px. The ledge is a
   shadow, never text (gold-deep as text is allowed but never required).
9. **Focus ring is gold in every theme** (Variant 1: `--gold`); it is the
   one element allowed to break rationing, because it must be findable.
10. **No pure black, no pure white.** Darkest token is `#05080F`, lightest
    is `#E6DFCE`. Any `#000000` / `#FFFFFF` in the prototype is a bug.

### 15.6 Per-screen grading notes (Variant 1)

| Screen                       | What changes (grade only — layout unchanged)                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Home / path**              | Canvas ink-950; shell ink-1000 behind the bottom nav; vignette on; zone glows at edges per §15.5.7; corridor ink-950 with no wash; current node ring gold, completed nodes gold-deep ledge, locked nodes muted on ink-800; HUD chips on ink-900 with paper numbers; streak flame gold-bright core → gold → gold-deep                                                                                |
| **Learn / quiz**             | Lesson article well ink-850 (new step — the article finally has its own depth); quiz progress bar gold on gold-soft track; AnswerOption idle ink-900 / ink-700 border, selected gold border, correct mint-soft wash + mint border, wrong rose-soft wash + rose border; feedback banner mint-soft / rose-soft (never solid); host line before/after only, mentor colour on the mark + name           |
| **Duels lobby + Speed Quiz** | Lobby cards ink-900, hover ink-800; live-duel arena gets the hosting mentor's glow at 0.10 on the top 232px hero wash only; TimerBar gold, turns rose under 5s; ScoreBar paper vs muted with gold/sky split for Learning vs Trading; VS cards on ink-850; countdown numerals paper at 9.56:1+                                                                                                       |
| **Result**                   | Scene-change takeover: full-bleed wash in the winning mentor's glow at 0.16 fading to ink-950 (Spotify Wrapped rule — restraint all year earns one loud moment); Rating change in plain words in paper, delta in mint/rose; XP count-up in gold-bright; badge drop with gold-glow; loss state uses the same grade with rose as the delta colour, never a red screen (failure is safe, round-2 rule) |
| **Simulator**                | Trading side of the split: sky is the accent here (badges, Trading Rating, chart highlights); gold appears only for the primary trade CTA and XP; EquityCard ink-900, P&L mint/rose figures; chart SVG uses sky/mint/rose on ink-850 with scrim-bottom under the axis labels; disclaimer in muted on ink-900                                                                                        |
| **Profile / Settings**       | Quietest screens in the product: canvas ink-950, cards ink-900, almost no glow (one gold-soft wash on the "next step" card only, §6.1); Rating badges in tier colours (§15.3); career ladder current title gold, others muted; toggles gold when on; destructive actions rose outline on ink-900; showcase snapshot on ink-850                                                                      |

### 15.7 Alternative identities — five complete gradings, scored the same way

Each variant below is a **complete** grading on the identical structure:
same six-step tonal ladder, same one-accent rationing, same text roles,
same mentor set, same screens. Only the hex values change — which is what
makes the theme switcher in §15.8 mechanical. "Trade" = the trading-side
colour (the second accent that separates Trading from Learning, as sky does
in Variant 1). Gain reuses the accent in Variants 2 and 3 per the Spotify
rule (success _reuses_ the brand colour, doc 20 §4.2); elsewhere gain is
mint `#3AD6A0`. Loss is rose `#F2756B` in every variant (loss must mean the
same thing everywhere — a theme that re-inks loss would retrain the user).

**Efficiency test (same for every variant).** Contrast: paper/muted/accent
vs canvas, card, raised (WCAG, scripted as in §15.4). Numbers/timers:
accent + paper ratios at the sizes timers actually render. Game elements:
streak flame (must stay warm — a green/teal flame reads wrong), XP bar
(accent fill), Rating badge (tier colours must survive the new canvas),
mentor characters (§15.7.7). Dark identity: does the dark still feel like
a trading floor at night, not a tinted light theme? Distinctiveness: could
this screenshot be any fintech / any SaaS app? Scores are 1–5, 5 best,
judged by the designer against those tests — they are comparative, not
absolute.

#### Variant 2 — Emerald + deep green ("the fresh bank")

| Token                                                             | Value                                                                                  | Notes                                               |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Shell / canvas / card / section / raised / border / strong border | `#040D08` / `#07120D` / `#0C1F16` / `#0F261B` / `#142F21` / `#1E3D2C` / `#2A4F3A`      | Deep green-black; shadows cool-green, not neutral   |
| Paper / muted / muted-bright                                      | `#E9F1E9` / `#8A9A8E` / `#9AA89D`                                                      | Green-tinted white; muted is green-grey             |
| Accent / bright / ledge / soft / glow                             | `#2ED99A` / `#5CE8B0` / `#1A9E6E` / `rgba(46,217,154,0.14)` / `rgba(46,217,154,0.22)`  | Emerald; ledge 5.59:1 on canvas as text             |
| Gain / loss / trade                                               | `#2ED99A` (= accent, Spotify reuse) / `#F2756B` / `#7AB3F0`                            | Learning = emerald, Trading = sky                   |
| Zone glows                                                        | gold `#F2BE55` 0.10 / sky 0.10 / rose 0.08 / emerald 0.10 / teal 0.08 / deep gold 0.10 | Unchanged hues — glows follow zones, not the accent |
| Hero wash / scrims / vignette                                     | Same structure as §15.3, scrim base `#040D08`                                          | —                                                   |

Contrasts: paper 16.55:1 bg / 14.90 card / 13.25 raised; muted 6.44 /
5.80 / 5.16; accent 10.45 bg, ink-on-accent 10.45. **Scores:** contrast 5,
numbers 5, game 4, mentors 3, dark identity 4, distinctiveness 3.
**Trade-offs:** the cleanest numbers of any variant and the freshest feel;
but the XP bar, the gain tick, and the primary CTA are all the same emerald,
so three meanings collapse into one colour; and "green fintech" is the most
crowded shelf in the market (every neo-bank is green). Mentor note below.

#### Variant 3 — Teal + charcoal ("the consultancy")

| Token                                                             | Value                                                                                 | Notes                                                    |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Shell / canvas / card / section / raised / border / strong border | `#060E10` / `#0A1214` / `#111E21` / `#14262A` / `#1A3035` / `#243E44` / `#2F4E55`     | Charcoal with a teal undertone; the most neutral variant |
| Paper / muted / muted-bright                                      | `#E8F0EF` / `#87989A` / `#97A6A8`                                                     | Cool white; muted is blue-grey                           |
| Accent / bright / ledge / soft / glow                             | `#2EC4B6` / `#5CD8CC` / `#1E8A80` / `rgba(46,196,182,0.14)` / `rgba(46,196,182,0.22)` | Teal; ledge 4.51:1 on canvas as text                     |
| Gain / loss / trade                                               | `#2EC4B6` (= accent, Spotify reuse) / `#F2756B` / `#EBA93B`                           | Learning = teal, Trading = gold (inverted vs V1)         |
| Zone glows / scrims / vignette                                    | Same structure, scrim base `#060E10`                                                  | —                                                        |

Contrasts: paper 16.35 / 14.73 / 13.20; muted 6.30 / 5.67 / 5.09; accent
8.73 bg, ink-on-accent 8.73. **Scores:** contrast 5, numbers 4, game 3,
mentors 2, dark identity 4, distinctiveness 2.
**Trade-offs:** the calmest, most "professional" read — and the most generic.
Teal + charcoal is the default palette of a thousand SaaS dashboards and
consultancy sites; nothing in a screenshot says Candle. Worst mentor
harmony of the set (§15.7.7); gain vs accent are 14° apart in hue, so a
correct answer and a primary CTA are nearly the same colour.

#### Variant 4 — Midnight blue + electric sky ("the terminal")

| Token                                                             | Value                                                                                   | Notes                                                                          |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Shell / canvas / card / section / raised / border / strong border | `#04081A` / `#060D1F` / `#0D1A33` / `#10223F` / `#162C4C` / `#1F3A5E` / `#2A4A72`       | Deepest blue; closest to round-2 navy, but deeper and stepped                  |
| Paper / muted / muted-bright                                      | `#E9EEF8` / `#8494B2` / `#93A6C2`                                                       | Original cool paper, kept — this variant _is_ the cool one                     |
| Accent / bright / ledge / soft / glow                             | `#6FB0FF` / `#9CC8FF` / `#2E7AD9` / `rgba(111,176,255,0.14)` / `rgba(111,176,255,0.22)` | Electric sky, desaturated from the old `#5AA9FF` (S 100% → ~83%); ledge 4.52:1 |
| Gain / loss / trade                                               | `#3AD6A0` / `#F2756B` / `#EBA93B`                                                       | Learning = sky, Trading = gold (inverted vs V1)                                |
| Zone glows / scrims / vignette                                    | Same structure, scrim base `#04081A`                                                    | —                                                                              |

Contrasts: paper 16.63 / 14.88 / 13.23; muted 6.32 / 5.66 / 5.03; accent
8.60 bg, ink-on-accent 8.60. **Scores:** contrast 5, numbers 5, game 4,
mentors 3, dark identity 4, distinctiveness 2.
**Trade-offs:** the most legible at speed (sky numerals are superb) and the
most familiar — which is the problem. Midnight blue + bright blue is the
house style of every bank, broker terminal, and B2B dashboard; it reads
"terminal", not "game". Kabir collides with the accent (§15.7.7).

#### Variant 5 — Plum + warm amber ("the private bank")

| Token                                                             | Value                                                                                 | Notes                                                         |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Shell / canvas / card / section / raised / border / strong border | `#0E0810` / `#150E17` / `#1F1420` / `#261A28` / `#2E2131` / `#3B2C3E` / `#4A384D`     | Plum-black; shadows warm-purple, the only warm-shadow variant |
| Paper / muted / muted-bright                                      | `#F2E9E0` / `#9C8A90` / `#B09A9E`                                                     | Warm cream paper; muted is mauve-grey                         |
| Accent / bright / ledge / soft / glow                             | `#F2A93B` / `#F7C65E` / `#B07E24` / `rgba(242,169,59,0.14)` / `rgba(242,169,59,0.22)` | Warm amber — gold's richer cousin on plum; ledge 5.29:1       |
| Gain / loss / trade                                               | `#3AD6A0` / `#F2756B` / `#7AB3F0`                                                     | Learning = amber, Trading = sky (same split as V1)            |
| Zone glows / scrims / vignette                                    | Same structure, scrim base `#0E0810`                                                  | —                                                             |

Contrasts: paper 15.81 / 14.85 / 13.55; muted 5.83 / 5.47 / 5.00; accent
9.50 bg, ink-on-accent 9.50. **Scores:** contrast 5, numbers 5, game 4,
mentors 4, dark identity 5, distinctiveness 5.
**Trade-offs:** the most distinctive after V1 and the most premium-feeling —
plum + amber is private-bank / luxury, and no other learning app owns it.
Anaya's teal is complementary to plum, so she pops best here. The cost:
rose/loss sits in the same warm-red family as the plum canvas, so the
CrashBanner and wrong-answer states need their rose-soft wash strengthened
(0.12 → 0.16, judgement call in §15.8.4), and plum can read fashion/luxury
rather than finance if the copy ever gets flowery. Keep the copy plain and
it stays finance.

#### Variant 6 — Espresso + copper ("the workshop")

| Token                                                             | Value                                                                                 | Notes                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Shell / canvas / card / section / raised / border / strong border | `#0C0705` / `#120D0A` / `#1D1410` / `#241A13` / `#2C2016` / `#3A2C1E` / `#4A3826`     | Espresso brown-black; warmest shadows in the set                          |
| Paper / muted / muted-bright                                      | `#F2E8DA` / `#9C8A76` / `#B09A86`                                                     | Cream paper; muted is warm taupe                                          |
| Accent / bright / ledge / soft / glow                             | `#E89B5A` / `#F5B87E` / `#A85E28` / `rgba(232,155,90,0.14)` / `rgba(232,155,90,0.22)` | Molten copper; ledge 3.95:1 on canvas — **never use as text** (see below) |
| Gain / loss / trade                                               | `#3AD6A0` / `#F2756B` / `#7AB3F0`                                                     | Learning = copper, Trading = sky                                          |
| Zone glows / scrims / vignette                                    | Same structure, scrim base `#0C0705`                                                  | —                                                                         |

Contrasts: paper 15.93 / 14.94 / 13.79; muted 5.80 / 5.44 / 5.02; accent
8.52 bg, ink-on-accent 8.52. **Scores:** contrast 4, numbers 4, game 4,
mentors 3, dark identity 5, distinctiveness 4.
**Trade-offs:** the warmest and most tactile grade — it feels crafted, like
a workshop or a roastery, and the dark identity is strong. But copper is
the weakest accent as _text_ (8.52:1, lowest of the six) and its ledge
`#A85E28` fails AA as text (3.95:1), so the ledge must be graphic-only; and
copper numerals are less crisp at small sizes than gold/sky/emerald.
Distinctive, but it reads "coffee" as easily as "finance".

#### Scorecard (all six variants)

| Variant                     | Contrast | Numbers / timers | Game elements | Mentor harmony | Dark identity | Distinctiveness | Total /30 |
| --------------------------- | -------- | ---------------- | ------------- | -------------- | ------------- | --------------- | --------- |
| **V1 Gold + ink (refined)** | 5        | 5                | 5             | 5              | 5             | 4               | **29**    |
| V2 Emerald + deep green     | 5        | 5                | 4             | 3              | 4             | 3               | 24        |
| V3 Teal + charcoal          | 5        | 4                | 3             | 2              | 4             | 2               | 20        |
| V4 Midnight + electric sky  | 5        | 5                | 4             | 3              | 4             | 2               | 23        |
| V5 Plum + warm amber        | 5        | 5                | 4             | 4              | 5             | 5               | **28**    |
| V6 Espresso + copper        | 4        | 4                | 4             | 3              | 5             | 4               | 24        |

Reading the table: every variant passes contrast — contrast does not
separate them. What separates them is **meaning collision** (how many
different things share one colour) and **distinctiveness** (could this be
any app?). V1 and V5 are the only variants where the accent, the gain
colour, the trading colour, and all six mentor colours are all different
things. V2/V3 collapse gain into the accent; V3/V4 collapse a mentor into
the accent; V6 collapses three warm ambers (accent, Mira, Rey) into one
family.

#### Mentor harmony per variant (Lottie mentor colours: Mira gold, Kabir sky, Tara rose, Anaya teal, Dev mint, Rey deep gold)

Mentor colours are the fixed set from §15.3 (Mira `#F2BE55`, Kabir
`#7FB0E8`, Tara `#F08A7A`, Dev `#4FD1A5`, Anaya `#63C9B8`, Rey `#D99A2B`).
All six clear ≥ 7.25:1 on every variant canvas as text/mark — legibility
is never the problem. _Distinguishability_ is: a mentor whose colour equals
(or sits within ~15° hue of) the theme accent, the gain colour, or another
mentor stops reading as a person and starts reading as UI chrome.

| Variant              | Harmonises?                | Where it breaks                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1 Gold + ink**    | **Yes, fully.**            | Nothing breaks. Mira is gold-bright vs CTA gold (lightness-separated, intentional); Rey is deep gold (family, darker). All six mentors distinct from each other, from gain/loss, and from sky. This is the only variant with zero collisions.                                                                                                                                                                           |
| V2 Emerald           | **Partially.**             | Dev mint `#4FD1A5` (H 160°) sits 8° from accent emerald `#2ED99A` (H 152°); Anaya teal `#63C9B8` (H 170°) sits 18° away. Dev and Anaya both read as "green UI". Mira gold pops beautifully (complementary) and Tara/Kabir/Rey are fine. _Fix if V2 is chosen:_ re-tint Anaya toward sky-teal `#5FB0D8` and lighten Dev to pale mint `#7ED9A8` (judgement call — §15.8.4).                                               |
| V3 Teal              | **No — worst of the set.** | Anaya teal (H 170°) is 4° from accent teal (H 174°) — Anaya _is_ the accent. Dev mint (H 160°) is 14° away. Two of six mentors disappear into the chrome; only Mira gold (complementary) still reads as a character. _Fix if V3 is chosen:_ Anaya would need a full re-tint (deep aqua `#4A9EB8` or a new hue), which breaks the "mentors are tints of the palette" rule — a sign the theme, not the mentors, is wrong. |
| V4 Midnight sky      | **Partially.**             | Kabir sky `#7FB0E8` (H 212°) is 1° from accent sky `#6FB0FF` (H 211°) — Kabir _is_ the accent. Mira gold equals the trading colour, so Mira reads as "trading host" on learning screens. _Fix if V4 is chosen:_ re-tint Kabir toward lavender-blue `#8FA8E8` and accept Mira/trade sharing gold.                                                                                                                        |
| V5 Plum + amber      | **Yes, with one caution.** | Anaya teal is complementary to plum and pops best here; Mira = accent-amber by lightness only (same pattern as V1, acceptable). Caution: Tara rose and loss-rose both sit in the warm-red family of the plum canvas — Tara's mark needs its full-strength colour (no wash) to stay distinct from loss states.                                                                                                           |
| V6 Espresso + copper | **Partially.**             | Mira `#F2BE55` (H 40°), Rey `#D99A2B` (H 38°), and accent copper `#E89B5A` (H 24°) collapse into one warm-amber family (16° spread across three meanings). _Fix if V6 is chosen:_ darken the accent to burnt copper `#C96F2E` so Mira/Rey separate by lightness — but that drops accent contrast toward ~7:1.                                                                                                           |

**Streak flame in every variant:** the flame stays warm amber/gold
(`#F2A93B` core → `#B07E24` edge) in all six themes, including emerald and
teal. A green or teal flame reads as a UI state, not fire. This is a
deliberate exception to "one accent" — the flame is content (a character
moment), not chrome. XP bar fill follows the theme accent; Rating badge
follows the Learning/Trading split of that variant's table above.

### 15.8 Hand-off spec for the applying agent (theme switcher + Variant 1 rebuild)

**Do not rebuild the prototype from memory. This spec is the build.**

#### 15.8.1 Token architecture (the one decision everything else hangs on)

- All six themes live in **one token file** (prototype: a `themes.css` /
  token map — the applying agent chooses the file, but there must be
  exactly one). Every theme is an object/map with the **same keys**:
  `ink-1000, ink-950, ink-900, ink-850, ink-800, ink-700, ink-600, paper,
muted, muted-bright, accent, accent-bright, accent-deep, accent-soft,
accent-glow, gain, gain-soft, loss, loss-soft, trade, trade-soft, violet,
mentor-mira, mentor-kabir, mentor-tara, mentor-dev, mentor-anaya,
mentor-rey, tier-bronze, tier-silver, tier-gold, tier-platinum,
tier-diamond, tier-master, glow-gold, glow-sky, glow-rose, glow-mint,
glow-teal, glow-deepgold, scrim-top, scrim-bottom, vignette, hero-wash`.
  Variant 1's values are §15.3; Variants 2–6 are §15.7. A theme that adds
  a key or renames one is a bug — the switcher works only because the keys
  are identical.
- Components reference **CSS variables only** (`var(--accent)`,
  `var(--ink-900)`…), never hex literals. Any hex literal left in a
  component is a bug: grep for `#[0-9A-Fa-f]{6}` in component code after
  the rebuild; the only hits should be inside the token file.
- Theme is selected by `data-theme="gold | emerald | teal | midnight |
plum | copper"` on the root element. **Default: `gold`** (Variant 1).
  Persist the choice in `localStorage` (prototype only) so Nishu's pick
  survives reloads; on first load, gold.

#### 15.8.2 Theme switcher UI (prototype only, not production)

- A switcher control is visible on **all six screens** (Home, Learn,
  Duels lobby + Speed Quiz, result, Simulator, Profile/Settings) in the
  prototype — fixed position, same place on every screen (top-right on
  desktop, above the bottom tab bar on mobile), so Nishu can flip themes
  mid-flow without losing his place.
- Control: six labelled options — **Gold Ink (refined), Emerald, Teal
  Charcoal, Midnight Sky, Plum Amber, Espresso Copper** — as a segmented
  control or a compact dropdown (applying agent's call; segmented is
  better for comparison because all options stay visible). It must be
  keyboard-accessible (real buttons/radio inputs, visible gold/accent
  focus ring) and must announce the theme change to screen readers.
- Switching changes **only the token values**. Same layout, same copy,
  same spacing/radius/type/motion, same mentor geometry, same ledge
  structure. If a screen's layout shifts when the theme flips, the layout
  is leaking a theme-dependent value — fix the leak, do not adjust the
  theme.
- Side-by-side comparison: Nishu asked to compare live. The switcher
  flips the whole prototype; true side-by-side (two screens at once) is
  out of scope for the prototype — the applying agent should note in its
  report that instant flipping with persisted scroll position is the
  comparison mechanism, and that a split-screen view is a follow-up if
  Nishu asks for it.

#### 15.8.3 Mechanical mapping (Variant 1 rebuild)

- Apply §15.3 row by row: old token → new token. That table _is_ the
  mapping; do not re-derive values from prose.
- New tokens with no old value (`ink-1000`, `ink-850`, `ink-600`,
  `muted-bright`, `gold-bright`, `gold-glow`, `mint-soft`, `rose-soft`,
  `sky-soft`, all `glow-*`, both scrims, `vignette`, `hero-wash`) are
  introduced where §15.5–§15.6 say they belong — nowhere else on first
  pass. In particular: `ink-850` only for lesson-article wells, duel
  panels, and tab panels; `muted-bright` only for small text on raised
  surfaces; `gold-glow` only for the result screen and hero washes.
- Per-screen grade is §15.6. Follow it screen by screen; do not invent
  extra washes.
- Unchanged from round 2: layout, spacing, radius, type scale, the four
  signature motions, ledge-button structure (face/ledge values change per
  §15.3, structure does not), hosts speak before/after never during a
  rated question, violet stays admin-only, no Clash of Clans, no copied
  characters, fictional tickers/money only with disclaimers.

#### 15.8.4 Judgement calls (not token swaps — the applying agent decides, and records the decision)

1. **V3 gain vs accent:** gain reuses the accent by design (§15.7). If in
   the live prototype a correct answer is hard to tell from a CTA, the
   fix is _not_ a new gain colour — it is strengthening the correct-state
   wash/border. Record what was observed.
2. **V5 rose wash:** strengthen `rose-soft` from 0.12 to 0.16 on plum for
   CrashBanner and wrong-answer states if loss reads as "part of the
   background". Record the alpha actually used.
3. **V6 ledge as text:** `--accent-deep` (`#A85E28`, 3.95:1) must never be
   used as text in the copper theme. If any component uses the ledge tone
   for a label, swap the label to `--accent` and record it.
4. **Mentor re-tints (V2/V3/V4/V6):** the fixes listed in §15.7.7 are
   proposals, not tokens. Do **not** silently re-tint mentors to make a
   variant work — apply the variant as specified first, show Nishu the
   collision, and only re-tint if he picks that variant. Record which
   collisions are visible in the live prototype.
5. **Streak flame:** stays warm amber in all themes (§15.7.7) — do not
   recolour it to the theme accent.
6. **Focus ring:** follows the theme accent in every theme (gold in V1,
   emerald in V2, etc.). This is the one sanctioned exception to
   "gold everywhere".
7. **Zone glows follow zones, not themes:** a zone's glow hue is fixed
   (§15.5.7) in all six themes. If a zone glow clashes with a theme
   canvas (e.g. rose glow on plum), lower its alpha by 0.02, never change
   its hue. Record any alpha change.
8. **Result-screen takeover:** the wash hue follows the _winning mentor's_
   glow in V1/V5/V6, the _theme accent_ in V2/V3/V4 (where mentor glows
   collide with the accent). Record the choice per theme.
9. **Theme names in UI:** use the names in §15.8.2 exactly, so Nishu's
   feedback ("plum feels…") maps to a variant unambiguously.

#### 15.8.5 Verification checklist (run per theme, all six)

- [ ] Contrast table re-run for that theme (paper/muted/accent on
      canvas, card, raised — §15.4 method); no pair below its §15.7 value
      by more than rounding (±0.05).
- [ ] Grep: no hex literal outside the token file.
- [ ] All six screens render at 360px and 1280px with no overflow and no
      layout shift when flipping themes.
- [ ] Timer bar, XP count-up, Rating badge, and P&L figures legible in
      each theme (screenshot each theme's duel screen).
- [ ] Mentor cards: all six mentors distinguishable from the accent and
      from each other in each theme; collisions in §15.7.7 confirmed
      present/absent and recorded.
- [ ] Streak flame is warm amber in every theme; focus ring follows the
      theme accent.
- [ ] `prefers-reduced-motion` still disables the four signature moments
      in every theme.
- [ ] Default load is gold; `localStorage` persists Nishu's pick.

### 15.9 Recommendation

**Keep Variant 1 (refined gold + ink) as the default and the recommendation.**
Reasoning: it is the only variant with zero meaning collisions — accent,
gain, trading colour, and all six mentor colours are all different things
(scorecard 29/30) — and gold-on-navy is the most ownable reading of
"finance" (money, premium, trading floor at night) while the warm/cool
split (§15.1.2) is what makes it feel graded rather than merely dark. The
round-3 refinement fixes exactly what Nishu criticised in round 2 (flat,
single-temperature ink; cool paper; electric sky; no ambient tokens)
without changing the identity he already approved in the 2026-11-02
concept.

**If Nishu wants a change, the challenger is Variant 5 (plum + warm
amber, 28/30)** — the most distinctive alternative, the best mentor
harmony after V1 (Anaya's teal is complementary to plum), and the most
premium-feeling. Its only cost is the rose-on-plum caution, which is a
wash-strength fix, not a redesign. **Variant 2 (emerald, 24/30)** is the
safe second challenger if he wants fresh/cool rather than premium — but
expect the "green fintech" comparison, and budget the Dev/Anaya re-tint.
**Variants 3 and 4 are controls, not recommendations:** V3 (teal +
charcoal) is the generic SaaS look round 1 was rejected for, and V4
(midnight + sky) is the generic bank-terminal look; both are included so
Nishu can see what "professional but not Candle" looks like side by side
with V1/V5. **Variant 6 (espresso + copper)** is the most tactile and
warmest, but its accent is the weakest as text and its warm-amber family
collapses Mira, Rey, and the accent into one meaning — keep it as a
wild-card, not a finalist.

**Open question for Nishu (add to §13 when §15 is reviewed):** after
flipping through the six themes in the prototype — does gold + ink still
feel like Candle, or does plum + amber (or emerald) feel more like the
product? The switcher exists so that question is answered by looking, not
by debating hex values.

### 15.10 Lottie pipeline notes (round-3 integration, 2026-11-13)

**What shipped.** The prototype (`candle-ui-prototype`, rebuilt in place from
§15.8) now runs the refined gold + ink grade as the default theme, a
six-theme switcher, and the Lottie animations. Player choice: **plain
lottie-web 5.12.2 (UMD), SVG renderer** — not lottie-react. The prototype is
vanilla JS with no build step, so the UMD build is the zero-dependency fit;
the production app (`apps/web`) can revisit the wrapper choice. The script
loads from the cdnjs CDN; if it (or any JSON) fails to load, every mount
falls back to the existing static SVG character — the fallback stays in the
DOM inside a `.lottie-fallback` span and is hidden only once the Lottie SVG
has loaded (`DOMLoaded` → `.lottie-on`). No Lottie file was invented: only
the seven verified files are wired.

**Files.** Production source: `apps/web/public/lottie/*.json`. Prototype
copies: `ts-spaces/candle-ui-prototype/assets/lottie/*.json` (same seven
files, served relative as `assets/lottie/<file>`).

| File                  | Where it plays in the prototype                                                                                    | Playback |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | -------- |
| `mira-idle.json`      | Home coach Mira; Duels-lobby Mira (default); live-duel host Mira; result Mira (loss, and default)                  | loop     |
| `mira-wave.json`      | Home Mira on tap; lobby Mira on arriving at Duels and on tap — plays once, then back to `mira-idle`                | once     |
| `mira-celebrate.json` | Result Mira on a win                                                                                               | once     |
| `kabir-thinking.json` | Kabir on the Home path ("waiting in the Square"); Kabir in the lesson                                              | loop     |
| `tara-shield.json`    | Tara in the Simulator                                                                                              | loop     |
| `streak-flame.json`   | Streak flame in the HUD, Home and Learn screens (replaces the static flame SVG; the old SVG stays as the fallback) | loop     |
| `xp-countup.json`     | XP burst over the XP panel on the result screen (win or loss — XP is earned either way)                            | once     |

Dev, Anaya, Rey, Nishu, and Arjun have no files yet and keep their current
SVG treatment. The wiring lives in one block in the prototype script
(`LOTTIE` / `lottieMount` / `lottieSlot` / `lottieSet` / `lottieOnceThen`,
debug handle `window.CANDLE_LOTTIE`); `go()` calls `onScreenShown()` for the
Duels-arrival wave and `finishDuel()` swaps in the celebration + XP burst.

**Mood-tag → file mapping.** As in `apps/web/public/lottie/README.md`:
Mira `calm`/`idle`/default → `mira-idle.json`; Mira `happy`/`proud`/win →
`mira-celebrate.json`; Mira `encouraging`/greeting/`hello` →
`mira-wave.json`; Mira `cautious` → `mira-idle.json`; Kabir
`thinking`/`calm`/default → `kabir-thinking.json`; Tara
`calm`/`reassuring`/default → `tara-shield.json`; system streak HUD →
`streak-flame.json`; system XP gain → `xp-countup.json`.

**How to add a new character animation.** Do not hand-write Lottie JSON.
Edit the generator and regenerate (full gotchas — one style per group,
front-to-back order, array keyframes, unique `ix`, the jsdom realm rule —
live in `apps/web/public/lottie/README.md`):

```bash
cd tools/lottie
npm install          # once: lottie-web, jsdom, sharp (dev-only, gitignored)
node generate.mjs    # writes apps/web/public/lottie/*.json
node verify.mjs      # structural checks + real lottie-web playback + PNG frames
```

Then copy the new JSON into the prototype's `assets/lottie/`, add a
`lottieSlot(key, element, "<file>", loop)` call, and wire its trigger
(arrival / tap / result) the same way `mira-wave` is wired. Naming:
`<mentor>-<moment>.json` for characters, `<thing>-<moment>.json` for HUD
elements; lowercase, hyphens, no version numbers in the filename.

**Reduced motion (must-follow rule).** `prefers-reduced-motion` is read once
(`LOT.reduceMotion`); when it is on, every mount loads with `autoplay:
false` and shows a static first frame via `goToAndStop(0, true)`, one-shot
swaps (wave / celebrate) are skipped, and the XP burst is not played — the
accompanying text line carries the moment instead. The prototype Settings
"Reduce motion" toggle only toasts (pre-existing prototype behaviour); the
media query is the enforcement point. The four signature CSS motions are
still killed by the existing `prefers-reduced-motion` media query in every
theme.

**Theme-proofing notes.** Mentor colours are FIXED across all six themes
(§15.8.4.4 — no per-theme re-tint); the streak flame stays warm amber in
every theme (§15.8.4.5); the focus ring follows the theme accent (§15.8.4.6).
Two known colour mismatches, neither fixed here: (1) the Lottie files were
authored against the old palette — Mira inside the files is `#E9B44C`,
while the new Mira token is `#F2BE55` — so Lottie Mira and SVG Mira are
slightly different golds side by side on Home; re-grading the files is a
generator change for a later pass, not this integration. (2) Kabir's sky
was deepened `#5AA9FF` → `#3E8FE8` inside the files (documented deviation,
kept — see the Lottie README). Edge scenery (candle ghosts, logo, ambient
orbs) re-inks with the theme accent/trade/gain; zone banners keep their
fixed zone colours (§15.5.7).

**Judgement calls recorded (§15.8.4).** (1) V3 gain = accent by design; the
correct-answer state is distinguished by its wash/border, not a new gain
colour — **not visually confirmed** in this round (no live-browser visual
pass; see Verification below). (2) V5 `loss-soft` strengthened 0.12 → 0.16
for CrashBanner / wrong-answer states, as specified. (3) V6 `--accent-deep`
(`#A85E28`, 3.95:1) is never used as text — verified: no
`color:var(--accent-deep)` / `color:var(--gold-ledge)` in the prototype.
(4) Mentor re-tints NOT applied; collisions are shown as specified (see
below). (5) Streak flame warm amber in all themes. (6) Focus ring follows
the theme accent. (7) Zone glows fixed hues; no alpha change was needed.
(8) Result wash follows the winning mentor's glow in V1/V5/V6 (Mira gold)
and the theme accent in V2/V3/V4. (9) Theme names in the UI are exactly
Gold Ink (refined) / Emerald / Teal Charcoal / Midnight Sky / Plum Amber /
Espresso Copper. Two further calls of the applying agent's own: (a) the
switcher is a compact toggle + dropdown panel, not an always-visible
segmented row — at 960–1280px a full row would cover the HUD, so the panel
opens on tap/click and **stays open after a pick** (toggle or Escape to
close) so flipping through themes is still one click per theme; top-right
only at ≥1280px, bottom-right at 960–1279px (desktop has no tab bar there),
above the tab bar on mobile. (b) A `--faint` token (not in §15.3) was
needed for the small labels the prototype already had; the first values
guessed for it failed AA on card surfaces, so they were re-solved to the
darkest values still ≥4.7:1 on card: gold `#8B8379`, emerald `#7A8A7E`,
teal `#7A8B8D`, midnight `#7787A4`, plum `#917F86`, copper `#917F6D`.

**Mentor collisions observed (hue check, live prototype).** All match
§15.7.7; none were re-tinted. V2 Emerald: Dev 2° and Anaya 12° from the
accent. V3 Teal (worst): Anaya 4° and Dev 14° from the accent — Anaya
_is_ the accent. V4 Midnight: Kabir 1° from the accent. V6 Espresso:
Mira 13°, Rey 11°, Tara 19° from the accent — the warm-amber family
collapses. V1 Gold and V5 Plum show Mira/Rey within 0–4° of the accent,
but those are the intentional lightness-separated cases §15.7.7 blesses
(Mira bright gold vs working gold; Rey deep gold). Note: Dev/Anaya also sit
within ~1–11° of the _gain_ colour in every theme — that is by design (Dev
is the mint mentor, Anaya the teal one); they read as characters because
they appear only as characters, never as feedback states.

**Contrast re-run (round 3).** All six themes have identical token keys
(70 keys). Canvas + card ratios match §15.4/§15.7 exactly (e.g. V1 paper
14.71/13.32, muted 6.38/5.78, gold 9.56/8.65). **Discrepancy found in the
doc, not the tokens:** §15.7's printed "raised" figures do not reproduce
from the §15.7 table values on the raised (ink-800) step. Recomputed on
ink-800: emerald paper 12.50 (doc 13.25), muted 4.86 (doc 5.16); teal
11.95 / 4.60 (doc 13.20 / 5.09); midnight 12.04 / 4.58 (doc 13.23 /
5.03); plum 12.70 / 4.68 (doc 13.55 / 5.00); copper 13.08 / 4.76 (doc
13.79 / 5.02). The printed figures sit between the section (ink-850) and
raised steps, so the §15.7 contrast lines need correcting; the tokens are
exactly the §15.7 tables and every pair still passes AA on the true raised
step (paper 11.95–13.08, muted 4.58–4.86). Faint now passes everywhere
(5.02–5.33 on canvas, 4.71–4.80 on card). `tools/lottie/verify.mjs`
re-run: 7 files, 0 problems.

**Verification (round 3) — what was and was not checked.** Checked in
jsdom with lottie-web 5.12.2 (same player the Lottie track's verifier uses):
all 7 screens activate; all 6 themes apply (data-theme, localStorage,
radio state, toggle label all agree on every theme); theme persists across
a fresh load; the full duel runs to a win with XP 100 and the result
screen swaps in `mira-celebrate.json` + the XP burst; wave plays on Duels
arrival and on tapping home Mira, then returns to idle; the switcher
opens/closes, applies a theme from a real radio `change` event, announces
it, and closes on Escape; reduced motion shows a static frame 0 with the
animation paused. Three inline scripts parse clean (`node --check`). **Not
checked:** no live-browser run was possible from this agent — the managed
Chromium on this VM refuses to start from the CLI (it requires the browser
service's WebGL domain policy), and no probe tool is available here — so
there are **no 360px/1280px screenshots, no visual overflow check, and no
real-time duel click-through** (the duel was hand-driven via its internals,
as in round 2). A visual pass with the parent's probe/audit tooling is
still needed before Nishu sees this, especially: switcher placement on
small screens, V3 correct-answer vs CTA legibility, and the result wash
at 0.16 (restrained by design — confirm it still reads as a celebration).

**⚠️ Tension — faces / illustrated characters (decision for Nishu).**
Doc §6 (and §13 Q2) says v1 is "no faces, no illustrated characters" —
mentors were to be geometric identity marks only (Mira compass rose, Kabir
bars, Tara shield…), with the mark "designed to be swapped for art without
touching logic". Round 2 instead built simple geometric SVG characters
_with_ faces (eyes, smiles, hair, arms), and round 3 wired Lottie versions
of those same characters — Mira blinking and waving, Kabir thinking, Tara
with her shield. That directly contradicts the v1 rule as written. This is
flagged here, not silently rewritten: either (a) accept the characters as
the new v1 direction and update §6/Q2 to say so, or (b) hold the rule and
revert the characters to marks-only. The prototype as built assumes (a)
until Nishu says otherwise.

---

_End of §15._
