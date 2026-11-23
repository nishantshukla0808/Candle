# UI References for a Premium Gamified Learning Redesign — Research Report

**References:** Brilliant (brilliant.org) · Headspace · Khan Academy (incl. 2026 "Reimagined")
**Researched:** 2026-11-13 · Research only, no build
**Brief lenses applied:** (1) PROFESSIONAL / PREMIUM, not common — favour distinctive, polished, award-level UI; call out common patterns to deliberately AVOID. (2) Rich layered backgrounds, ambient/interactive elements, scene depth, motion that make the UI feel alive and immersive rather than flat.

---

## 1. BRILLIANT (brilliant.org)

**Positioning:** "Duolingo for logical thinking and programming" — but deliberately adult, premium, and restrained. Its own design language reads as _"education that respects your intelligence — premium, structured, never cute."_
Sources: https://www.webdesignhot.com/design.md/brilliant-org/ · https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/

### Home / learn screen layout and structure

- **Mobile home:** a single active course resumes front and centre (e.g. course "Exploring Data Visually" opens on lesson "Reading Bar Charts"). The home is a _continuation_ screen, not a catalogue grid. Top strip holds the reward currencies (keys, discount, coin, lightning bolt); bottom nav is just **Home / Courses / Premium / Profile**.
  Source: https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/
- **Lesson structure (the core loop):** each lesson opens with a **2–4 sentence concept intro + illustration**, then moves straight into a **chain of interactive problems** — "learn by doing", explicitly not lecture-first. Wrong answers are **not penalised**: the UI shows the correct answer and explains the reasoning. Immediate per-problem feedback with worked explanations.
  Sources: https://math.kilowatto.com/en/research/mc-14-competitive-products/ · https://understandtutor.com/blog/brilliant-review
- **Learning Paths:** guided sequences of topics from core ideas to advanced ones, with practice checkpoints; 40+ courses, elementary through graduate level, topic-jump friendly across courses but tightly sequenced within a lesson.
  Sources: http://brilliant.org/help/features/ · https://math.kilowatto.com/en/research/mc-14-competitive-products/
- **Interaction design inside problems:** visual/interactive widgets (sliders, draggable diagrams, multi-step reveals), **tap-to-select answers instead of typing**, a guided code field for Python, a speaker button that reads tasks aloud, a "Check" button to consciously commit an answer, restart option per task. Visual help/hints instead of the full solution when stuck.
  Sources: https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/ · https://math.kilowatto.com/en/research/mc-14-competitive-products/

### Colour, typography, card shapes, button styles

- **Two faces — note the split (do not conflate):**
  - _Marketing site (brilliant.org):_ **near-black canvas `#0c0e16`** (slight cool tilt, never pure black), **single chromatic accent "Brilliant Coral" `#fc6e51`** for CTAs, white body copy at 100% for maximum legibility. Diagram accents (yellow `#ffd44d`, cyan `#5ac3e5`, purple `#b582ff`) appear **only inside illustrations, never as CTA palette**. Headings in custom **Brilliant Sans** (rounded humanist sans, Inter-adjacent) at **56–88px**.
    Source: https://www.webdesignhot.com/design.md/brilliant-org/
  - _In-app product UI:_ black-and-white first, **single action green `#29cc57`** for primary CTAs and affirmative states, paper-white `#ffffff` page/cards, hairline borders `#e4e4e4`, **fully pill-shaped buttons (9999px radius)** — "avoid sharp corners; shapes communicate approachability". Headings in CoFo Robert (serif, large) + CoFo Brilliant sans for body at 16px/1.5; green progress bar at the top of lessons.
    Sources: https://designmunk.com/brilliant/ · https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/
- **Premium lesson:** one canvas + one accent voltage, full stop. Coral was picked specifically to evoke the warm orange of physics-textbook diagrams — the accent has a _story_, it is not a default palette pick.

### Gamification presentation

- **XP:** measures learning activity; earned from concepts and problems; **weekly XP sets standing in Leagues**. **Leagues:** weekly XP competitions between **30 learners**, **10 league levels named after elements, from Hydrogen up to Einsteinium** (promotion/demotion weekly).
  Sources: http://brilliant.org/help/features/ · https://understandtutor.com/blog/brilliant-review
- **Streak:** consecutive days; extend by solving **3 problems or finishing 1 concept per day**. **Streak Charges** automatically protect a missed day; max **2** held; earnable through activity. Free users get **2 keys/day**, each key opening one lesson/practice set. Also coins, lightning bolts, daily goals, and an **iOS home-screen widget showing streak + practice prompts**.
  Sources: http://brilliant.org/help/features/ · https://understandtutor.com/blog/brilliant-review · https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/
- **Presentation style:** currencies sit in a quiet top strip (keys / coin / lightning bolt icons), never a flashing HUD. Progress is a **thin green bar at the top of every lesson** plus narrow bars between sections — progress is ambient and always visible, not a separate "stats" screen.

### Navigation and content discovery

- Bottom tab bar (Home / Courses / Premium / Profile) on mobile; **Home resumes** the current course, Courses is the catalogue, Profile holds progress. Discovery is path-led (Learning Paths), not search-led; you can jump topics across courses but must take a course in order.
  Sources: https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/ · https://understandtutor.com/blog/brilliant-review
- **Ask Koji from the Home tab:** type a maths question in your own words and it routes you to the concept/practice that covers it — discovery via the tutor, not via a search box.
  Source: http://brilliant.org/help/features/

### Motion / micro-interactions / celebration

- **Koji transition animation:** a short Koji animation plays **between learning steps**, flanked by narrow progress bars — "the app thus continuously makes visible that you have completed a section and have arrived at the next step. This constant small feedback is the actual motivational engine."
  Source: https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/
- **Rendering quality:** Brilliant uses **Rive state machines with GPU rendering, 60 FPS constant** — rated 5/5 visual quality in competitive analysis; "premium animations, state-driven interactivity".
  Source: https://github.com/overclockedbrains/insyte/blob/HEAD/.planning/research/canvas-renderer/agent-c-competitive-trends.md
- **Celebration moment (observed in app footage):** lesson-complete screen shows "Lesson complete!", XP awarded, score (e.g. 3/3), and a "You started a streak!" notification — small, specific, immediate.
  Source: https://www.instagram.com/reel/DdFZaKqxd9h/
- **Reduced motion respected:** geometry animations disable under `prefers-reduced-motion: reduce`.
  Source: https://www.webdesignhot.com/design.md/brilliant-org/

### Character / mascot

- **Koji — the AI tutor character (launched 29 May 2026).** It sees what you are working on, walks you through the thinking step by step **without giving the answer**, can highlight or rearrange the interactive elements on screen while talking you toward the answer. **By default Koji speaks first** — it talks at the start of every lesson page — and reacts to correct answers with praise; it also signals when help is available if you get stuck. It is a _functional_ character (tutor + hint system + router), not decoration.
  Sources: http://brilliant.org/help/features/ · https://understandtutor.com/blog/brilliant-review · https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/

### Layered backgrounds, ambient elements, scene depth

- **Marketing hero: full-bleed animated geometry** — circles morphing to spheres, triangles tiling into hexagons, isometric grids — in coral and white on near-black. The geometry _is_ the background layer; it moves, but slowly and structurally, like a living diagram rather than decoration.
  Source: https://www.webdesignhot.com/design.md/brilliant-org/
- **In-app, the "scene" is the problem itself:** draggable diagrams, sliders, scales with weights, area models — the interactive widget is a small living scene (e.g. five squares on a balance scale totalling 40) rather than a static question card. Depth comes from _manipulable_ visuals, not background layers.
  Source: https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/
- **Honest limit:** the app interior is deliberately flat and minimal ("clean, modern, highly interactive… no distractions… the focus is on the problem"). Brilliant earns immersion from the _content_ animating, not from ambient backgrounds. Do not copy its flatness if the goal is an immersive world — copy its discipline instead.
  Source: https://free-apps-android.com/brilliant/

### What makes it feel premium / distinct (not an ERP dashboard)

- Dark canvas + **one** storied accent; huge custom typography; "premium, structured, never cute" — it refuses childish gamification styling while keeping game mechanics underneath. The product feels like "watching a Vimeo science explainer rather than reading a textbook".
  Source: https://www.webdesignhot.com/design.md/brilliant-org/
- **Transferable to Candle:** (a) one accent colour with a story (gold already does this — protect it, don't add more); (b) always-visible thin progress bar + per-section completion beats; (c) tutor character that speaks _before/after_, never during a question (validates Candle's existing host rule); (d) forgiveness mechanic (Streak Charges) instead of punishment; (e) leagues of 30 with themed level names as the competitive layer, not a global leaderboard on the home screen.

---

## 2. HEADSPACE

**Positioning:** the warmest, most illustration-led wellness product — "a children's storybook re-rendered with platform-grade UI scaffolding". Apple Design Award + Webby laurels. The strongest of the three for _ambient aliveness_.
Sources: https://www.shadcn.io/design/headspace · https://www.floow.design/aso-screens/headspace

### Home / learn screen layout and structure

- **"Today" tab = personalised home screen.** Structure observed in-app: a sky-and-clouds header graphic, **"Recents" / "Favorites" pill toggles**, a **"Your essentials"** section led by one hero card — **"Today's Meditation"** (yellow-orange card, 3–20 min, with a streak counter, e.g. 355) — followed by a short vertical list of next sessions ("Wind down for bed • 4 min", "Fall asleep • 45 min", "Sleep through the night • 45–480 min").
  Source: https://www.facebook.com/annmariewalts1/posts/pfbid0Gp21ZDTtVAzh6orfg3XfcyiLyTh7s6CcmAjqajPfAbirQNuLkQnokjGjQozsoCkSl
- **2025 redesign — "Today" as a scroll of 2-minute Micro-Moments:** mindful tooth-brushing, contextual breathing while queueing, 60-second compassion bursts. Plus a **Movement tab** pairing breath with low-impact workouts filmed in pastel studios.
  Source: https://www.successconsciousness.com/blog/tips-for-life/beyond-meditation-7-well-being-apps-that-actually-rewire-your-daily-habits/
- **Content organised by feeling/state, not by taxonomy:** stress, sleep, focus, anxiety, relationships, fitness; courses are series of 10–30 short sessions led by one teacher; **SOS sessions** for panic/anxiety; sleep content (Sleepcasts, wind-downs) is a first-class section, not a buried category.
  Source: https://www.canmindful.top/blog/best-cute-meditation-apps
- **Marketing page anatomy (measured):** white 80px nav under a yellow strip; centred two-line bold H1; two side-by-side warm `#F9F4F2` cards; a **six-tile category grid** (16px-radius tiles, soft shadows) before any real UI is shown; inset radius-16 colour cards (yellow slide, blue business band, sky band); full-bleed yellow ticker; giant pill CTA on yellow.
  Source: https://www.unfairly.ai/brand-guidelines/headspace/

### Colour, typography, card shapes, button styles

- **Measured colour ratio on headspace.com (1440px): white 59% · yellow 24% · CTA blue 9% · sky blue 8%.** Orange covers almost no area — it lives only in the logo and illustrations.
  Source: https://www.unfairly.ai/brand-guidelines/headspace/
- **Tokens (extracted from live site):** page floor **warm off-white `#f9f4f2`** (not cold `#ffffff`); load-bearing text **warm charcoal `#2d2c2b`** (softer than pure black; pure black appears only in form-input text); **single saturated voltage blue `#0061ef`** living _only_ on the primary CTA pill and a handful of inline accent dots; **character-orb mascots** — saffron `#ffce00`, bubble pink `#ffa1cc`, aqua `#00a4ff`, grass green `#02873e`, ultraviolet `#3b197f`; brand-orange dot `#f47d31` in the logo only; deep indigo `#3b197f` for contemplative moments.
  Sources: https://www.shadcn.io/design/headspace · https://styles.refero.design/style/035a098b-5a27-48a3-8a3a-c68a698e3eab
- **Typography:** a **single custom family, Headspace Apercu**, weights 400/500/700, 12 levels from **12px nav meta to 64px / weight-700 / −1.92px-tracked hero**. Negative tracking tightens as sizes scale — headlines feel "sculpted rather than shouted". No serif, no italic, no second family.
  Sources: https://www.shadcn.io/design/headspace · https://styles.refero.design/style/035a098b-5a27-48a3-8a3a-c68a698e3eab
- **Shape language:** radii **16px cards, 24px feature plates, 32px primary CTA, 800px (full pill)** for secondary buttons and the dark "Chat with Ebb" pill. Primary CTA pill is **48px tall, weight 700 / 14px**. **No box-shadow tier at all** — depth comes from 1px warm hairlines (`#e2ded9`) and corner rounding, not elevation. Spacing on a 4/8/24/32/48px scale.
  Source: https://www.shadcn.io/design/headspace
- **App Store screenshots:** yellow→orange gradient wave (`#FCE356` → `#FF6A00`) repeated across 6 of 8 frames as a scroll-stopping colour block; two-tone captions (near-black `#1F2937` + burnt orange `#FF5F00`); deep purple frame (`#5B2E8C`) and cobalt frame (`#2563EB` + pink blobs) used sparingly to signal different verticals.
  Source: https://www.floow.design/aso-screens/headspace

### Gamification presentation

- **Deliberately minimal — the anti-pattern reference.** Headspace tracks exactly **two things: minutes practiced (today / this week / this month) + streak (consecutive days, shown but not emphasised)**. **No XP. No levels. No badges. No quests.** The streak is visible but breaking it triggers **no loss messaging or dramatic consequences** — "a gentle nudge to return, not a source of anxiety". Progress indicators feel supportive, not flashy. Adding levels/XP/competition would conflict with the product's purpose, so the progression system stays minimal.
  Source: https://www.themasterly.com/blog/progression-systems-that-build-daily-habits
- **What _does_ exist:** badges for completing a meditation course series end-to-end; regular challenges and insights; stats/reports showing how practice is affecting you; a self-care tracker.
  Source: https://squeezegrowth.com/headspace-review/
- **Transferable lesson:** for a _premium_ feel, restraint is a feature — one quiet consistency metric (streak + minutes) can carry retention better than a loud XP economy, and it never makes the home screen look like a game dashboard.

### Navigation and content discovery

- **Mobile bottom tab bar: Today / Explore / Ebb / Care / (profile).** Today is the personalised home; Explore is the library; **Ebb** is the AI companion; Care is therapy/coaching access.
  Source: https://www.facebook.com/annmariewalts1/posts/pfbid0Gp21ZDTtVAzh6orfg3XfcyiLyTh7s6CcmAjqajPfAbirQNuLkQnokjGjQozsoCkSl
- **Web/app chrome is minimal on purpose:** "fewer things to click on"; search icon top-left, account/settings top-right; **no typical nav bar** on web — a single-page design you move through, rather than a menu tree.
  Source: https://squeezegrowth.com/headspace-review/
- **Discovery is state-led, not catalogue-led:** "how are you feeling?" routes you to content; the Today tab's first action is a _next step_ (e.g. scheduling a first therapy appointment), not a browse grid.
  Source: https://www.g2.com/products/headspace-headspace/reviews?filters%5Bnps_score%5D%5B0%5D=3

### Motion / micro-interactions / celebration

- **The breathing circle is the signature motion:** the play button **breathes in and out, expanding and contracting like lungs** during a session — a visual cue that guides the meditation. Measured at **scale 1.0 → 1.04 → 1.0 over 8 seconds** in time with inhale/exhale guidance (one implementation documents a 12s cycle: 4s inhale, 2s hold, 4s exhale, 2s hold). On the in-meditation Play screen the breathing sphere fills **~60% of the screen** on a butter-cream canvas, with soft guidance text above ("Take a deep breath in…") and a thin progress arc at the very top. Nothing else.
  Sources: https://www.duaa.design/headspace · https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/headspace-mobile/DESIGN.md
- **Motion rules (from brand analysis):** **button-press 150ms**; **"animate characters, not layouts"**; **slow, soft, breathing pace** — transitions **400–800ms** with custom easing (slower = calmer); session-complete uses a **subtle overshoot (1.02 scale before settling)** — a gentle "well done" without jarring confetti; ambient stars animate on a **120-second cycle, "so slow it's barely perceptible"**; loading screen morphs the Headspace circle through breathing-like forms.
  Sources: https://www.unfairly.ai/brand-guidelines/headspace/ · https://github.com/sampathmannam/nilamind/blob/HEAD/docs/UI_UX_PRINCIPLES.md · https://www.duaa.design/headspace
- **Onboarding motion case study:** guided breathing animation + gentle dissolves + soft circular progress fill raised activation **from 34% to 64% (+89%)** and meditation completion by 73% — motion as the activation mechanism, not decoration.
  Source: https://www.uxstalwarts.com/case-study/headspace-inc/
- **Celebration is deliberately quiet:** session-complete = gentle affirmation + progress acknowledgement + breathing option. No confetti cannons. (Contrast with Duolingo/Brilliant — Headspace proves a premium product can celebrate _softly_.)
  Source: https://github.com/sampathmannam/nilamind/blob/HEAD/docs/UI_UX_PRINCIPLES.md

### Character / mascot

- **The orange-beanie mascot is a cultural icon; the broader cast is hand-drawn character orbs** — round, flat-colour, face-led figures (closed-eye or open-eye faces) that float between sections, cluster above headings, and sit inside feature chips. They **replace stock photography, gradients, and mesh backgrounds** entirely. Since the 2024 refresh, faces express **stress, sadness, contentment — not only joy** — so the mascot can match the emotional topic (Sleep, Stress, Hard Topics). Illustration kit: **3840×2160 scenes in eight themes** (Evergreen, Work, Education, Mindful Eating, Seasonal, Sleep, Stress/Anxiety, Hard Topics). Rules: **flat colour, no outlines, no gradients inside shapes; no realistic people; no stock 3D or clip art.**
  Sources: https://www.shadcn.io/design/headspace · https://www.unfairly.ai/brand-guidelines/headspace/ · https://www.successconsciousness.com/blog/tips-for-life/beyond-meditation-7-well-being-apps-that-actually-rewire-your-daily-habits/
- **Characters appear as companions, never pop-ups:** round-headed characters in soft pastel hoodies sitting cross-legged on hilltops, holding mugs, walking dogs — on every empty state, milestone reveal, and completion screen.
  Source: https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/headspace-mobile/DESIGN.md

### Layered backgrounds, ambient elements, scene depth — STRONGEST of the three

- **Sleepcasts are immersive _audio scenes_:** instead of a narrative, you are placed in a scene — **a slow train, a rainy day in a bookshop, a desert campfire, a moonlit garden, a drift over a sleepy shoreline**. 45–55 minutes, **remixed nightly** so the mind can't memorise them; layered ambient sounds (rain, wind, fire) sit under narration; wind-down exercises precede the main session.
  Sources: https://inthemoment.app/articles/calm-vs-headspace · https://www.otherworldtales.com/blog/bedtime-stories-for-adults-audio · https://www.mobileappdaily.com/product-review/headspace
- **Visual scene depth:** full illustrated scenes (not photos) built from circles and soft shapes in bold flat colour; the App Store wave gradient and the in-app sky-and-clouds header give each screen a _place_, not a background colour. The 2024 identity keeps "breath-driven animation since the start".
  Sources: https://www.unfairly.ai/brand-guidelines/headspace/ · https://www.facebook.com/annmariewalts1/posts/pfbid0Gp21ZDTtVAzh6orfg3XfcyiLyTh7s6CcmAjqajPfAbirQNuLkQnokjGjQozsoCkSl
- **Ambient motion as a layer:** barely-perceptible star drift, breathing orbs, slow fades — the screen is never fully static, but nothing ever demands attention. This is the key transferable idea: **aliveness at low amplitude**.

### What makes it feel premium / distinct (not an ERP dashboard)

- "Earns its warmth by **refusing the visual shortcuts most peers depend on — no nature photography, no soft-serif gestures, no eucalyptus-green wash, no lotus illustration. Just cream canvas, warm charcoal ink, one blue pill, and a cast of character orbs.**" One typeface, one CTA voltage, flat surfaces, hairlines instead of shadows.
  Source: https://www.shadcn.io/design/headspace
- **Transferable to Candle:** (a) a warm off-white canvas + one gold voltage already matches Candle's ink+gold direction — Headspace validates the _ratio discipline_ (one accent, used sparingly); (b) a signature ambient element (breathing sphere → Candle could have a living "Exchange" scene: ticker glow, ambient market pulse); (c) characters with _emotional range_ as companions in empty states and completions; (d) state-led discovery ("how are you feeling?" → "what do you want to learn/do today?"); (e) celebration at low amplitude — a gentle overshoot + affirmation, not confetti spam.

---

## 3. KHAN ACADEMY (incl. 2026 "Reimagined")

**Positioning:** "warm-not-corporate" — mission-driven warmth, free-for-everyone, the volunteer-tutor voice. The _weakest_ of the three on ambient immersion (deliberately flat), the _strongest_ on **mastery visualisation** — the learning-tree + mastery-dot system is the single most transferable pattern in this whole report.
Sources: https://www.webdesignhot.com/design.md/khan-academy/ · https://blog.khanacademy.org/meet-the-new-khan-academy-classroom-experience/

### Home / learn screen layout and structure

- **Learner Home + Learner Queue (Reimagined, 2026):** instead of a list of assignments, students see **a focused path through what comes next**. **Daily Missions** (due today/tomorrow/overdue) and **Weekly Missions** break work into small manageable steps; **Unit Missions** organise learning by unit and replace the old Unit/Course Mastery Goals. Two views: a list view and a **"Path" view** (recommended for younger students — a visual, direct view of assignments). "More visible progress indicators throughout the platform."
  Sources: https://support.khanacademy.org/hc/en-us/articles/46056261189773-What-s-changing-for-students-on-the-reimagined-Khan-Academy · https://blog.khanacademy.org/meet-the-new-khan-academy-classroom-experience/
- **Learning tree (signature pattern):** course structure rendered as a tree — units → lessons → skills — with a **mastery dot next to every skill**. Subject illustrations are SVG with `currentColor` tinting; mascot illustrations are SVG, crisp at any size.
  Source: https://www.webdesignhot.com/design.md/khan-academy/
- **Mobile app (established structure):** bottom nav **Home / Course / Workbook / Profile**; Home = recent activity + personalised recommendations; Course = all subjects/lessons; Workbook = practice with immediate feedback; Profile = settings + overall progress.
  Source: https://tecnobits.com/en/what-does-khan-academy-app-UI-mean/
- **iPad design precedent:** grid layout with **subjects (breadth) vertical, topics (depth) horizontal** — "the breadth is very clearly vertical, the depth is very clearly horizontal" — which cut content access from **8 taps to 2 taps or less**.
  Source: https://www.fastcompany.com/3041180/w_750

### Colour, typography, card shapes, button styles

- **Tokens (measured from khanacademy.org):** canvas paper-white `#ffffff`, warming to `#f7f8fa` in alt bands; **brand mint `#14bf96`** ("Khan Mint") on wordmark, primary CTA, mascot plumage, mastery dots; text warm near-black `#21242c`; cream `#fef9e9` for tip/encouragement bands; mint promo band `#e3f9f1`; footer dark band `#21242c`.
  Source: https://www.webdesignhot.com/design.md/khan-academy/
- **Typography:** **Lato** throughout (in use since 2012), weights 400/700/900; hero **56px/900/1.1/−0.02em**; section hero 44px/700; course title 32px/700; body **16px/400/1.5**; card title 18px/700; uppercase eyebrow 13px/700/+0.08em; points display 16px/700 with tabular numerals.
  Source: https://www.webdesignhot.com/design.md/khan-academy/
- **Buttons:** primary = **pill (9999px), 48px tall, 12×24px padding, mint `#14bf96`, white text, 16px/700**; hover `#0e9a78` ("darker mint shift, **no shadow lift, no scale**"); active `#0a7d63`. Secondary = white with 2px `#0a7d63` outline. Donate CTA deliberately uses signal blue `#1865f2` to differentiate the nonprofit ask from learning actions.
  Source: https://www.webdesignhot.com/design.md/khan-academy/
- **Cards:** course card **8px radius**, 24px padding, **1px border `#d6d8de`**, shadow `0 1px 3px rgba(33,36,44,0.06)`; hover = shadow deepens to `0 4px 12px`, **no scale, no translate**. Skill row: mastery dot left, title centre, "Practice"/"Mastered" tag right. Lesson tile: **soft mint-tinted bg `#f0fcf7`** with type icon (video/exercise/article), title, runtime. Encouragement card: warm cream `#fef9e9`, 12px radius, **1px `#f4cf3e` border**, mascot illustration top-left.
  Source: https://www.webdesignhot.com/design.md/khan-academy/
- **Radii:** 2/4/6/8/12/9999 — friendly default is **8px**; spacing on a 4px base scale up to 128px; header 64px, sidebar 280px, content max 1240px.
  Source: https://www.webdesignhot.com/design.md/khan-academy/

### Gamification presentation

- **Mastery system (the core):** skills progress **Not Started → Attempted → Familiar → Proficient → Mastered**. Each stage has a **colour-coded mastery dot with a progress arc**: attempted grey `#a8aab2` · familiar blue `#1865f2` · proficient purple `#9059ff` · mastered deep green `#0a7d63`. Matching pill badges ("Mastered" green pill on mint `#e3f9f1`, etc.). You **don't advance until you master the prerequisite** — "no gaps". The knowledge map visualises the whole skill tree at a glance.
  Sources: https://www.webdesignhot.com/design.md/khan-academy/ · https://support.khanacademy.org/hc/en-us/articles/202487710-What-are-energy-points-badges-and-avatars · https://github.com/robertwilczynski/awesome-skills/blob/HEAD/skills/enterprise/khan-academy/SKILL.md
- **Energy Points (classic system):** measure **effort, explicitly not mastery or ability** — earned for videos watched, problems solved, pushing the edge of knowledge. Displayed as a yellow pill: **"⚡ 2,340"** (lightning icon + tabular numerals, `#f4cf3e` border, `#a06c0a` text). **Badges in 5 rarity tiers: Meteorite → Moon → Earth → Sun → Black Hole**, awarded for behaviours (points, mastery, community, CS). **Avatars level up** over time.
  Sources: https://support.khanacademy.org/hc/en-us/articles/202487710-What-are-energy-points-badges-and-avatars · https://www.webdesignhot.com/design.md/khan-academy/
- **Gems (Reimagined, 2026 — replaces Energy Points, Avatars and LearnStorm):** students earn Gems by completing assignments and building skills. **Every 50 Gems unlocks one surprise Khanmigo accessory** (hats, glasses — one hat + one pair of glasses worn at a time). **Gem total sits in the upper-right corner** of Learner Home and every lesson; clicking it opens the **Achievements page/modal → "Customize Khanmigo" → Khanmigo's Collections**. **Gem Challenges** are class-level: teachers set custom rewards tied to gem milestones (pizza party, movie day, extra recess). **Gem Jam** turns practice into a team race: teams earn Gems by reaching Proficient, and each gem moves their team's **Racermigo** mascot up a track in real time.
  Sources: https://support.khanacademy.org/hc/en-us/articles/42456050422157-How-can-my-students-customize-Khanmigo · https://support.khanacademy.org/hc/en-us/articles/42456912953997-How-can-I-customize-Khanmigo-and-unlock-new-Khanmigo-accessories · https://blog.khanacademy.org/five-ways-khan-academy-is-making-student-practice-more-motivating/ · https://support.khanacademy.org/hc/en-us/articles/45128558403341-How-do-I-use-Gem-Jam-with-my-students-in-Khan-Academy-Reimagined
- **Streak:** orange fire icon `#e07c2c`; "Persistence" badge for a 5-day streak.
  Sources: https://www.webdesignhot.com/design.md/khan-academy/ · https://github.com/robertwilczynski/awesome-skills/blob/HEAD/skills/enterprise/khan-academy/SKILL.md

### Navigation and content discovery

- **Guided, not browsed:** the Learner Queue + Missions tell you what to do next; the learning tree shows where you are. Web header 64px + 280px sidebar for the tree. Mobile: 4-tab bottom nav. The design goal is stated explicitly: "easier to navigate, easier to understand what to do next".
  Sources: https://blog.khanacademy.org/meet-the-new-khan-academy-classroom-experience/ · https://www.webdesignhot.com/design.md/khan-academy/
- **Khanmigo Assistant sits at the top of the experience** (teacher side) and the Gem total in the upper-right (student side) — the two persistent anchors are _help_ and _progress_, not menus.
  Source: https://blog.khanacademy.org/meet-the-new-khan-academy-classroom-experience/

### Motion / micro-interactions / celebration

- **Rainbow confetti erupts on screen when students submit correct answers** — the reward mechanism — and a **friendly monster guides students through lessons**. On iPad, **handwriting recognition** lets students write answers by hand, with a scratch-work notes area beside each problem.
  Source: https://www.fastcompany.com/3041180/w_750
- **Confetti at 100% progress** and similar milestones (documented as a recommended gamification addition in a Khan chatbot UI study: "gamification elements (like confetti) upon reaching 100% progress… to enhance user engagement and provide positive reinforcement").
  Source: https://www.twisha.work/chatbot
- **Gem-earn moment (observed in launch video):** on-screen **"10 gems earned!"** plus an unlocked-item reveal (e.g. "Oval Glasses", "VR Headset", "Ranger Hat") — the reward is a _visible thing for your character_, not just a number going up. Tagline: "More sparkle. More fun."
  Source: https://www.facebook.com/reel/2335191556884372/
- **Illustration system with motion:** the brand refresh (Alyssa Foote + team) built a custom in-house illustration system, unified icon system, and new learner avatars; **animated shorts for the Financial Literacy Theater** pair narrative clarity with playful, character-driven design.
  Source: https://alyssafoote.com/Khan-Academy

### Character / mascot

- **Khanmigo — the owl AI tutor.** Appears on AI tutor surfaces and learner pages; in Reimagined it is **customisable**: accessories (hats, glasses) unlocked with Gems, one hat + one pair of glasses at a time, managed in "Khanmigo's Collections". During Gem Jam, each team's Khanmigo becomes a **Racermigo** that visibly races up the track as the team earns Gems — the mascot _is_ the progress bar.
  Sources: https://www.webdesignhot.com/design.md/khan-academy/ · https://support.khanacademy.org/hc/en-us/articles/42456912953997-How-can-I-customize-Khanmigo-and-unlock-new-Khanmigo-accessories · https://support.khanacademy.org/hc/en-us/articles/45128558403341-How-do-I-use-Gem-Jam-with-my-students-in-Khan-Academy-Reimagined
- **Custom illustration system** (not stock): in-house illustrations, playful learner avatars with creative naming, unified course-unit icons — the brand refresh explicitly fixed avatars that "felt disconnected from the brand and lacked consistency".
  Source: https://alyssafoote.com/Khan-Academy

### Layered backgrounds, ambient elements, scene depth — HONEST ASSESSMENT: THIN

- Khan is **deliberately flat**: paper-white canvas, flat cards, 1px borders, soft shadows, no gradients, no ambient layers, no scene backgrounds. Warmth comes from the **illustration system** (SVG, `currentColor` tinting), the **cream encouragement bands**, and the **mint-tinted lesson tiles** — colour _fields_, not depth.
  Source: https://www.webdesignhot.com/design.md/khan-academy/
- Its "alive" quality lives in **micro-moments**: mastery dots filling with progress arcs, confetti bursts on correct answers, the Racermigo racing, the gem-earn reveal. The screen is a calm surface; the _progress itself_ animates.
- **Verdict for Candle:** take Khan's mastery visualisation and Mission/queue structure; do **not** take its backgrounds. If Candle wants immersion, Khan is the wrong model for depth — Headspace and Brilliant are the models there.

### What makes it feel premium / distinct (not an ERP dashboard)

- **"Mission-driven warmth":** one mint, one humanist sans (Lato since 2012), generous 16px/1.5 body, encouraging plain-spoken voice ("we believe in you, and here is the next exercise"). It never looks like a dashboard because **there is no dashboard grid** — there is a _tree_ and a _queue_: two editorial structures, not KPI cards.
  Source: https://www.webdesignhot.com/design.md/khan-academy/
- **Transferable to Candle:** (a) **mastery dots with progress arcs** as the skill-progress language (directly mappable to Candle's topic/skill mastery per duel type); (b) **Learner Queue / Daily Mission** as the home structure — "what's next" instead of a catalogue; (c) **effort currency vs mastery signal kept separate** (Energy Points ≠ mastery — Candle already separates XP from Ratings; Khan validates it); (d) **reward = something visible on your character** (accessory unlock every 50 gems → Candle avatar/mentor customisation); (e) **team race where the mascot IS the progress bar** (Racermigo → a Candle equivalent: mentor climbing the Exchange tower as the league progresses).

---

## Cross-reference synthesis — patterns to STEAL (for Candle)

| Pattern                                              | From                                                                      | Candle mapping                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| One canvas + one accent voltage + one display family | All three                                                                 | Ink + gold already; protect the ratio, don't add accents                      |
| Home = "what's next", not a catalogue                | Brilliant resume-course; Khan Queue/Missions; Headspace Today             | Learn screen opens on the next lesson/duel, not a grid                        |
| Progress always visible, ambiently                   | Brilliant thin green bar; Khan mastery dots; Headspace minutes            | Thin progress bar + per-topic mastery dots on every screen                    |
| Effort currency ≠ skill signal                       | Khan (Energy Points vs mastery); Brilliant (XP vs Leagues)                | XP vs Ratings separation — already correct, keep it                           |
| Forgiveness > punishment                             | Brilliant Streak Charges (max 2)                                          | Streak freeze/charge, never loss-shaming                                      |
| Leagues of 30, themed level names                    | Brilliant (elements Hydrogen→Einsteinium)                                 | League tiers with finance-themed names                                        |
| Tutor speaks before/after, never during              | Brilliant Koji                                                            | Already a Candle rule — validated                                             |
| Reward = visible thing on your character             | Khan (50 gems → accessory)                                                | Mentor/avatar customisation unlocks                                           |
| Mascot IS the progress bar                           | Khan Racermigo                                                            | Mentor climbing a tower / market chart as league progresses                   |
| One signature ambient element                        | Headspace breathing sphere; Brilliant animated geometry                   | A living Exchange scene (ambient ticker glow / market pulse) at low amplitude |
| Celebration at low amplitude, frequent + specific    | Brilliant lesson-complete (XP + score + streak); Headspace 1.02 overshoot | Small specific win screens, not confetti spam                                 |
| State-led discovery                                  | Headspace ("how are you feeling?")                                        | "What do you want to do today?" — learn / duel / trade                        |

## Patterns to DELIBERATELY AVOID (common / generic — Nishu's warning)

1. **The ERP/admin dashboard:** left sidebar nav + KPI stat-card grid + data tables + chart widgets. _None_ of the three references uses it; it is the single fastest way to look generic. If a screen looks like it could manage inventory, it is wrong.
2. **Catalogue-grid home:** a wall of identical course cards with stock-photo thumbnails and "Enroll" buttons. All three references lead with _continuation_ (resume / queue / today), not browsing.
3. **Multi-accent rainbow UI:** 4–6 saturated colours competing for attention (the default SaaS palette). Each reference commits to **one** accent voltage; diagram/illustration colours never leak into chrome.
4. **Default system type + default radii:** Inter/system sans at default sizes with 4–8px radii everywhere reads as an unbranded template. Each reference has a _custom or committed_ typeface and a _deliberate_ radius system (Brilliant 9999px pills; Headspace 16/24/32/800; Khan 8px + pills).
5. **Gradient-mesh / glassmorphism backgrounds as a substitute for art direction:** the "premium" cliché of 2023–25. Brilliant uses _animated geometry with a story_ (physics diagrams); Headspace uses _hand-drawn characters_; Khan uses _flat colour fields_. None uses a generic purple-blue mesh.
6. **Emoji-only gamification / confetti spam:** loud badges, flashing streak flames and confetti on every tap. Brilliant keeps currencies in a quiet top strip; Headspace has _no_ XP at all; Khan's confetti is tied to real mastery moments. Gamification that shouts reads as a kids' app, not premium.
7. **Leaderboard as the home screen:** global rank tables front-and-centre. Brilliant buries Leagues behind weekly XP; Khan's competition is team-based (Gem Jam) and opt-in; Headspace has no competition at all.
8. **Mascot as decoration:** a character slapped on a generic UI. In all three, the character is _functional_ — Koji tutors and routes, Khanmigo is the tutor and the progress bar, Headspace orbs carry the emotion of the content. A mascot that does no job is clutter.
9. **Modal-heavy flows and menu trees:** Headspace explicitly removed the nav bar; Khan cut access from 8 taps to 2. Deep menus and pop-up stacks are the ERP tell.
10. **Dark-mode-everything or light-mode-everything by default:** each reference _commits_ to one canvas for a reason (Brilliant dark = blackboard/diagram metaphor; Headspace cream = storybook warmth; Khan white = paper/workbook). Pick the canvas that serves Candle's metaphor (ink = trading floor at night) and commit — don't hedge with a theme toggle as the design.
11. **Copying Duolingo's loudness wholesale:** the most-copied "gamified learning" look. Brilliant's own verdict is the warning: "premium, structured, never cute". For a _professional premium_ finance product, Duolingo-level loudness actively damages trust.
12. **Stock photography / 3D clip-art illustrations:** Headspace's brand rules ban both outright ("Don't use realistic people in illustration; don't use stock 3D or clip art"). Custom illustration is what makes each reference unmistakable.

## Immersion / aliveness — ranked by reference

1. **Headspace (strongest):** breathing sphere (60% of play screen, 8–12s cycle), barely-perceptible 120s star drift, illustrated scenes as _places_, Sleepcasts as audio worlds (train / bookshop / campfire), characters with emotional range. Lesson: **aliveness at low amplitude, always on**.
2. **Brilliant (strong):** full-bleed animated geometry hero (morphing circles, tiling triangles, isometric grids), Rive 60fps state-machine animations, _manipulable_ problem scenes (draggable diagrams, balance scales). Lesson: **the content itself moves; the chrome stays calm**.
3. **Khan Academy (weakest — deliberately):** flat by design; aliveness only in micro-moments (mastery arcs filling, confetti on correct answers, Racermigo racing, gem-earn reveals). Lesson: **if the surface is flat, the progress itself must animate** — otherwise the product feels dead.

## Source list (all URLs used)

- https://brilliant.org/help/features/ (official — XP, Leagues, streaks, Streak Charges, Learning Paths, Koji, widget)
- https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/ (hands-on review with app screenshots — home screen, progress bars, Koji transitions, tap-to-answer)
- https://www.webdesignhot.com/design.md/brilliant-org/ (Brilliant marketing-site design tokens — #0c0e16, coral #fc6e51, animated geometry)
- https://designmunk.com/brilliant/ (in-app UI spec — green #29cc57, pill buttons, CoFo typefaces)
- https://math.kilowatto.com/en/research/mc-14-competitive-products/ (competitive research — lesson loop, no-penalty feedback)
- https://understandtutor.com/blog/brilliant-review (review — Koji launch date/behaviour, leagues Hydrogen→Einsteinium, keys)
- https://free-apps-android.com/brilliant/ (review — minimal interface, immediate feedback)
- https://www.instagram.com/reel/DdFZaKqxd9h/ (app footage — "Lesson complete!", XP, 3/3, streak start)
- https://github.com/overclockedbrains/insyte/blob/HEAD/.planning/research/canvas-renderer/agent-c-competitive-trends.md (competitive motion research — Brilliant Rive, 60 FPS)
- https://www.shadcn.io/design/headspace (Headspace design tokens — #f9f4f2, #2d2c2b, #0061ef, orbs, Apercu, radii)
- https://www.unfairly.ai/brand-guidelines/headspace/ (brand guidelines — colour ratio 59/24/9/8, illustration rules, motion, Today/Meditate/Sleep/Care screens)
- https://styles.refero.design/style/035a098b-5a27-48a3-8a3a-c68a698e3eab (Headspace style reference — cream canvas, radii, single-family type)
- https://www.floow.design/aso-screens/headspace (App Store screenshot teardown — gradient wave, two-tone captions, trust-first framing)
- https://www.themasterly.com/blog/progression-systems-that-build-daily-habits (Headspace minimal progression — minutes + streak only)
- https://squeezegrowth.com/headspace-review/ (review — home base, minimal chrome, gamification, timers)
- https://www.successconsciousness.com/blog/tips-for-life/beyond-meditation-7-well-being-apps-that-actually-rewire-your-daily-habits/ (2025 redesign — Micro-Moments, Movement tab, orange-beanie mascot)
- https://www.g2.com/products/headspace-headspace/reviews?filters%5Bnps_score%5D%5B0%5D=3 (reviews — Today tab as personalised home)
- https://www.facebook.com/annmariewalts1/posts/pfbid0Gp21ZDTtVAzh6orfg3XfcyiLyTh7s6CcmAjqajPfAbirQNuLkQnokjGjQozsoCkSl (in-app home screenshot — Today's Meditation card, streak 355, bottom nav)
- https://www.duaa.design/headspace (brand + motion analysis — breathing play button, morphing loading circle)
- https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/headspace-mobile/DESIGN.md (Headspace iOS design tokens — breathing sphere 1.0→1.04→1.0 over 8s, 60% of play screen)
- https://github.com/sampathmannam/nilamind/blob/HEAD/docs/UI_UX_PRINCIPLES.md (Headspace as emotional-design case study — 4-2-6 breathing, 400–800ms transitions, 1.02 overshoot, 120s star cycle)
- https://www.uxstalwarts.com/case-study/headspace-inc/ (onboarding motion case study — activation 34%→64%)
- https://inthemoment.app/articles/calm-vs-headspace (comparison — Sleepcasts as immersive scenes, animated explanations)
- https://www.otherworldtales.com/blog/bedtime-stories-for-adults-audio (Sleepcasts — 45–55 min, nightly remix, layered ambience)
- https://www.canmindful.top/blog/best-cute-meditation-apps (Headspace library organised by feeling; sleep content)
- https://www.mobileappdaily.com/product-review/headspace (review — Sleepcasts, soundscapes, wind-downs)
- https://www.webdesignhot.com/design.md/khan-academy/ (Khan design tokens — mint #14bf96, Lato, mastery dots, buttons, cards)
- https://blog.khanacademy.org/meet-the-new-khan-academy-classroom-experience/ (Reimagined — Learner Queue, Missions, guided experience)
- https://blog.khanacademy.org/five-ways-khan-academy-is-making-student-practice-more-motivating/ (Reimagined motivation — Gems, Missions, Khanmigo personalisation)
- https://support.khanacademy.org/hc/en-us/articles/46056261189773-What-s-changing-for-students-on-the-reimagined-Khan-Academy (Reimagined changes — Missions, Path view, removed features)
- https://support.khanacademy.org/hc/en-us/articles/202487710-What-are-energy-points-badges-and-avatars (official — Energy Points, badge tiers Meteorite→Black Hole, avatars)
- https://support.khanacademy.org/hc/en-us/articles/42456050422157-How-can-my-students-customize-Khanmigo (official — Gems, 50 gems = 1 accessory)
- https://support.khanacademy.org/hc/en-us/articles/42456912953997-How-can-I-customize-Khanmigo-and-unlock-new-Khanmigo-accessories (official — Collections, one hat + one glasses)
- https://support.khanacademy.org/hc/en-us/articles/45128558403341-How-do-I-use-Gem-Jam-with-my-students-in-Khan-Academy-Reimagined (official — Gem Jam team race, Racermigo)
- https://www.fastcompany.com/3041180/w_750 (iPad app design — 2-tap access, grid breadth/depth, confetti, friendly monster, handwriting)
- https://tecnobits.com/en/what-does-khan-academy-app-UI-mean/ (mobile app UI — bottom nav Home/Course/Workbook/Profile)
- https://www.twisha.work/chatbot (Khan chatbot UI study — confetti at 100%, tiles, progress tracking)
- https://github.com/robertwilczynski/awesome-skills/blob/HEAD/skills/enterprise/khan-academy/SKILL.md (mastery framework — Not Started→Mastered, badges)
- https://alyssafoote.com/Khan-Academy (brand refresh — custom illustration system, avatars, unit icons, Financial Literacy Theater)
- https://www.facebook.com/reel/2335191556884372/ (Reimagined launch video — "10 gems earned!", accessory reveals, "More sparkle. More fun.")
