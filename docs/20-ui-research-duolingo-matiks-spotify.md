# Candle UI Research — Duolingo, Matiks, Spotify, Brilliant, Headspace, Khan Academy

> **Purpose.** Round 1 of the Candle web UI redesign was rejected by Nishu outright:
> it looked like the most common ERP dashboard / software UI — grey cards, sidebar,
> tables — not attractive at all. This document is the research that round 2 is built
> on. Every pattern below was verified against real product pages, screenshots, or
> design writeups, with a source URL for every claim. Where a number comes from a
> reconstruction rather than an official spec, it is flagged.
>
> **Correction recorded 2026-11-13:** Matiks' mascot is **Sero**, not "Siro".
> Earlier Candle docs used "Siro" as the Matiks reference name. That was wrong;
> use Sero from here on. (Candle's own mentors Mira/Kabir/Tara/Dev/Anaya/Rey are
> unaffected — they are Candle-original characters.)
>
> **Date:** 2026-11-13. **Status:** research complete; redesign in progress.
> Companion doc: [19-web-ui-design-system.md](./19-web-ui-design-system.md) (updated
> for round 2 — see §10).

---

## 1. The one-line verdict per reference

| Reference    | What it teaches Candle, in one line                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Duolingo     | Home is a **winding game path**, not a dashboard; one next action; characters are the scenery; failure is safe.                                              |
| Matiks       | The **Arena**: sport framing, 60-second live duels, one visible rating number you protect; mascot = identity + celebration, not a tutor.                     |
| Spotify      | **One accent, rationed to one verb**; tonal depth, not borders; imagery is the colour system; a living layer (art-derived gradients, Canvas loops, Wrapped). |
| Brilliant    | Adult, premium, restrained: one canvas + one storied accent, thin always-visible progress, forgiveness over punishment, manipulable content.                 |
| Headspace    | **Aliveness at low amplitude**: breathing sphere, 120-second star drift, illustrated scenes as places; restraint is a feature.                               |
| Khan Academy | **Mastery visualisation**: mastery dots with progress arcs, Learner Queue / Daily Missions, effort currency kept separate from skill.                        |

---

## 2. Duolingo — the path, the ledge button, the character layer

### 2.1 Home is a path, not a dashboard

- In Nov 2022 Duolingo replaced the branching "skill tree" with a single linear,
  step-by-step winding path; one circle = one level, lessons ordered (spaced
  repetition, mixed new + review), Stories and practice built _into_ the path.
  The old tree "left learners paralysed by choice and skipping foundational
  material"; the path removes choice paralysis.
  Source: https://blog.duolingo.com/new-duolingo-home-screen-design/?lang=en
- Each unit is headed by a **full-width coloured banner** (e.g. `SECTION 1, UNIT 1
— Order at a café`, with a `GUIDEBOOK` button). Banner colour changes per unit
  (green, purple, teal, blue, pink, orange observed).
  Sources: https://screenrove.com/duolingo/design ;
  https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/duolingo-mobile/DESIGN.md
- Nodes (reconstruction values, not official): 80pt circles, 96pt centre-to-centre
  vertical spacing, alternating left/right offset ±60pt in a wave; connected by an
  8pt dashed/dotted `#E5E5E5` line; current node grows to 96pt with a pulsing ring;
  a "JUMP HERE" arrow / bouncing `START` bubble sits beside the current node.
  Source: https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/duolingo-mobile/DESIGN.md
- **Node states — colour _is_ the state:** completed `#58CC02` + white icon +
  darker `#58A700` ledge + crown count; current = same green + pulse ring;
  locked `#E5E5E5` + `#AFAFAF` lock, desaturated; maxed/gold `#FFC800` +
  `#E29F03` ledge; Legendary (Super) `#CE82FF` + sparkle.
  Source: https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/duolingo-mobile/DESIGN.md
- **Landmarks break the monotony:** treasure chest mid-path, trophy at unit/section
  end, special node icons (star, headphones, book, dumbbell, video camera).
  Tapping a node opens a small popover — _not_ a new page — e.g. "Order at a café /
  Lesson 2 of 3" + white `START +10 XP` button.
  Sources: https://screenrove.com/duolingo/design ;
  https://blog.duolingo.com/new-duolingo-home-screen-design/?lang=en
- **Density:** 8–12 nodes visible per viewport — enough to feel momentum.
  Source: https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/duolingo-mobile/DESIGN.md
- **Web layout (measured):** fixed 256px left sidebar with 2px `#E5E5E5` right
  border; central winding path under the coloured unit banner; right rail of
  2px-bordered, 16px-radius cards (course, streak, gems, hearts, Daily Quests,
  Unlock Leaderboards, Create-a-profile). Mobile collapses both rails into a top
  HUD + bottom tab bar. Source: https://screenrove.com/duolingo/design
- If you scroll away from your current spot, a floating arrow button jumps you back.
  Source: https://blog.duolingo.com/new-duolingo-home-screen-design/?lang=en

**Transferable:** one guided road, not a catalogue; progress = position on the
road; landmarks (chest/trophy) as sub-goals; popover-to-start, never a dead list row.

### 2.2 Gamification — HUD first, numbers as heroes

- Top HUD always visible on Home: streak / gems / hearts chips (pills, 32pt tall,
  icon 20pt + number in display face 18pt). Colour = mechanic, one colour per
  currency: streak flame Fox Orange `#FF9600`; gems blue diamond `#1CB0F6`;
  hearts Cardinal Red `#FF4B4B`; leagues/premium Beetle Purple `#CE82FF`.
  Sources: https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/duolingo-mobile/DESIGN.md ;
  https://blakecrosley.com/guides/design/duolingo
- Streak: fire icon + plain integer; detail screen shows a huge number (56pt
  display face) + Mon–Sun week row; milestones at 7/30/100/365 days unlock
  rewards; Streak Freeze buyable with gems.
  Sources: https://blakecrosley.com/guides/design/duolingo ;
  https://github.com/angel225588/vox-langauge-app/blob/HEAD/docs/research/DUOLINGO_UI_PATTERNS.md
- Hearts: start at 5, each mistake costs 1, at 0 you are blocked until refill.
  Sources: https://github.com/angel225588/vox-langauge-app/blob/HEAD/docs/research/DUOLINGO_UI_PATTERNS.md
- XP: daily XP goal as a circular ring (48pt, 4pt stroke, `#E5E5E5` track,
  `#58CC02` fill, number in centre); XP counter animates upward on earn.
  Weekly leagues: **30 users per league, ranked by weekly XP**, top promoted /
  bottom demoted, own row highlighted `#DDF4FF` with blue border; tiers
  Bronze → Diamond. Sources: (same Vox doc + Axhub reconstruction above)
- **Layered progress (never one bar):** micro = lesson progress bar; meso = daily
  XP goal + weekly league; macro = path position + crown/legendary status.
  Always visible, never buried in menus.
  Source: https://github.com/angel225588/vox-langauge-app/blob/HEAD/docs/research/DUOLINGO_UI_PATTERNS.md
- Numbers are stars: streak/gem/XP counts set in the display face at ~2× the
  surrounding UI size.

### 2.3 Colour, buttons, typography

- Measured palette (live DOM): Feather Green `#58CC02` (primary), button lip
  `#58A700`, Macaw Blue `#1CB0F6`, Iceberg `#DDF4FF`, Eel `#4B4B4B` (text, never
  pure black), Wolf `#777777`, Hare `#AFAFAF`, Snow `#FFFFFF`, Swan `#E5E5E5`,
  Whale/deep navy `#100F3E` / `#131F24` (dark canvas — blue-black, not true black).
  Sources: https://tastekit.dev/gallery/apps/duolingo ; https://screenrove.com/duolingo/design
- **Ratios — the discipline:** canvas ~white throughout; green _reserved_ for
  primary CTAs, big display headlines, logo, footer — "green is the hero colour…
  structure is whitespace + colour, never hairline borders or blurred shadows."
  No gradients anywhere; every fill is flat solid.
  Sources: https://tastekit.dev/gallery/apps/duolingo ;
  https://www.canny-creative.com/atlas/brand/duolingo/
- **The 3D "ledge" button (signature component):** primary 50px high (web) /
  56pt (mobile), 12–16px radius, `#58CC02` face, `box-shadow: 0 4px 0 #58A700`
  (hard, un-blurred offset, **not** a blur shadow), white UPPERCASE 15–17px /
  700–800 label, +0.8px tracking. Pressed: ledge disappears, button translates
  down 4px (80ms), brightness ~0.95; release springs back ~250ms. Answer tiles
  use the same language smaller: white face, 2px `#E5E5E5` border + 2pt ledge;
  selected `#DDF4FF` + `#84D8FF` border; correct `#D7FFB8` + `#58CC02`;
  wrong `#FFDFE0` + `#FF4B4B`.
  Sources: https://tastekit.dev/gallery/apps/duolingo ; https://screenrove.com/duolingo/design ;
  https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/duolingo-mobile/DESIGN.md
- **Typography:** Feather Bold (bespoke display face, letterforms echo Duo's
  wings) for display/headlines **only, lowercase, short (≤ ~10 words), never
  <30px**; DIN Next Rounded Pro (rounded geometric sans) for _everything else_.
  Never mix the two in one sentence. Free stand-ins: Varela Round (display),
  Fredoka / Nunito / Baloo 2 (body).
  Sources: https://www.canny-creative.com/atlas/brand/duolingo/ ;
  https://screenrove.com/duolingo/design
- Measured sizes (web): section display 48–62px/700; hero 32px; body 17px/24px,
  weight 500; button label 15px/700, +0.8px, UPPERCASE.
  Source: https://screenrove.com/duolingo/design

### 2.4 Characters — the emotional layer

- Duo is "the most important visual aspect of our brand" and "not a logo… the
  emotional layer of the entire application", with dozens of expressions mapped
  to user states: happy (correct), sad (missed day), frustrated (repeated wrong),
  celebrating (lesson complete), sleeping (not opened today), crying (streak
  about to break), proud (course complete).
  Sources: https://blog.duolingo.com/building-character/ ;
  https://blakecrosley.com/guides/design/duolingo
- **Cast:** 10 recurring characters with distinct personalities/backstories,
  designed over 18 months to resemble Duo (geometric body + wings, big eyes,
  detached feet, 2–3 colours, simple shapes) so they feel like one world; they
  "speak" the sentence being translated, each with a unique correct-answer
  animation and a distinct TTS voice.
  Source: https://blog.duolingo.com/building-character/
- **Placement:** Duo stands _beside_ the path (waving, blinking, looking around
  — idle animation), peeks in at lesson intro (~80pt, speech bubble with a tip),
  appears ~200pt tall on empty states, ~280pt dancing on celebration overlays.
  Characters communicate via short **speech bubbles, not paragraphs**.
  Sources: https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/duolingo-mobile/DESIGN.md ;
  https://screenrove.com/duolingo/design
- **Streak milestone = character transformation:** "Fire Duo" (phoenix) —
  Duo himself physically changes, treated "like power-ups in a video game".
  Source: https://blog.duolingo.com/streak-milestone-design-animation/

### 2.5 Motion, lesson screen, result screen

- **Four channels at once:** every correct/wrong answer pairs colour + sound +
  haptic + animation. Correct = chime/applause; wrong = gentle "oops" tone,
  never a harsh buzzer.
  Source: https://github.com/angel225588/vox-langauge-app/blob/HEAD/docs/research/DUOLINGO_UI_PATTERNS.md
- Timings (reconstruction): button press 80ms down / 250ms spring back; correct
  checkmark pops scale 0→1.2→1.0 in 300ms; wrong tile shakes ±6pt for 400ms;
  feedback banner slides up 200ms; confetti 1.2s; XP ring fills 800ms ease-out.
  Source: https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/duolingo-mobile/DESIGN.md
- **Wrong answers still advance progress slightly** — "something always moves
  forward", so failure never feels like being stuck.
  Source: https://github.com/angel225588/vox-langauge-app/blob/HEAD/docs/research/DUOLINGO_UI_PATTERNS.md
- **Lesson screen (full-screen, no nav):** top row = X (close, left) + rounded
  green progress bar (centre, 12pt tall, `#E5E5E5` track, `#58CC02` fill +
  `#89E219` top highlight) + hearts (right). Bottom = fixed footer bar with one
  primary action (`CHECK` → `CONTINUE`/`GOT IT`, same position every time for
  muscle memory). `CHECK` stays disabled grey until an answer is selected.
  Source: https://screenrove.com/duolingo/design
- **Feedback banner:** full-width footer sheet rising from the bottom — light
  green `#D7FFB8` with green check + "Nice job!" / light red `#FFDFE0` with red
  X + "Correct solution: …" — plus `Too easy / Too difficult / Report` links
  and a Continue button recoloured to match.
  Source: https://screenrove.com/duolingo/design
- **Result screen:** centred illustration (Duo + a character, looping sparkle),
  yellow "Lesson Complete!" headline, stat cards with coloured header strips
  (`TOTAL XP 15` yellow + `GREAT! 92%` green), `REVIEW LESSON` + `CONTINUE`.
  Then a separate streak screen: big orange flame + large number + week row.
  Full-screen takeover variant: `#58CC02` background, Duo cheering 280pt,
  "LESSON COMPLETE!" 28pt white, "+10 XP" 22pt with yellow glow, confetti.
  Sources: https://screenrove.com/duolingo/design ;
  https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/duolingo-mobile/DESIGN.md
- **Empty states:** fun illustration with the brand character + short encouraging
  copy + what will appear when filled — never a blank table or grey "No data" box.
  Source: https://github.com/angel225588/vox-langauge-app/blob/HEAD/docs/research/DUOLINGO_UI_PATTERNS.md

### 2.6 What makes Duolingo premium (not just "more polish")

1. **A bespoke, owned visual language, built for the long term even at
   short-term cost.** The 2018 "Juicy" rebuild (brighter colours, rounder corners,
   cuter Duo) was purely for long-term brand building, _expecting zero
   short-term metric improvement_. Quality bar = "Four Elements of Excellence":
   every feature must be Useful, Intuitive, Delightful, _and_ Polished — and they
   ship "V1s, not MVPs" (polished but minimal; MVPs excuse subpar work).
   Source: https://www.danielscrivner.com/the-duolingo-handbook-summary/
2. **Type and colour derive from the mascot.** Feather Green is "the colour the
   world associates with Duolingo"; Feather Bold's letterforms echo Duo's body;
   the 352 CSS variables are _animal-named_ (owl, macaw, cardinal, fox, bee,
   koala, beetle) instead of numeric grey scales.
   Sources: https://www.canny-creative.com/atlas/brand/duolingo/ ;
   https://www.shadcn.io/design/duolingo
3. **One productive contradiction, held everywhere:** a serious behavioural-science
   product rendered in a Saturday-morning-cartoon vocabulary — pure-white canvas,
   no gradients, no stock photos, no blurred shadows; depth from illustration and
   colour alone. The mascot _replaces_ the decoration layer (gradients, mesh
   backgrounds, stock photography) that every other ed-tech brand uses.
   Source: https://www.shadcn.io/design/duolingo
4. **Characters as a moat, not decoration:** "a crucial moat… someone could clone
   the app but not the emotional connection to Duo", modelled on Nintendo
   ("serious fun"), not on education companies.
   Source: https://www.danielscrivner.com/the-duolingo-handbook-summary/

### 2.7 Layered backgrounds / ambient life — honest correction

Duolingo's home path sits on a mostly **plain white** canvas — it does _not_ use
a rich photographic/scenery background behind the nodes. Its aliveness comes from
_layered flat illustration and living characters placed around a quiet centre_:

1. **Characters as the scenery layer.** Duo and cast stand _beside_ the path at
   intervals (waving, holding a globe, in martial-arts uniform…), each unit's
   characters changing with the unit — scrolling feels like travelling through
   populated places. Duo performs idle animation beside the path: blinking,
   looking around, slight body movements.
   Sources: https://blog.duolingo.com/new-duolingo-home-screen-design/?lang=en ;
   https://www.instagram.com/reel/DLPl7voRnVS/
2. **Colour-field zoning per unit.** Each unit banner is a different saturated
   colour (green → purple → teal → blue → pink → orange as you scroll), so the
   _world changes colour_ as you progress even though the canvas stays white.
   Source: https://www.instagram.com/reel/DLPl7voRnVS/
3. **Depth via overlap + ledges, not lighting.** Illustration rules: only rounded
   rectangle / circle / rounded triangle; ~15 shapes per illustration (6 = too
   abstract, 30+ = cluttered); depth via overlap, never 3D shading; shadows are
   pill-shapes below the subject, never ovals; backgrounds behind illustrations
   are pastels, never grey.
   Sources: https://github.com/floweralicee/doulingo-art-generator/blob/HEAD/duolingo-art/SKILL.md ;
   https://github.com/virgiliojr94/duolingo-ux-reference/blob/HEAD/SKILL.md
4. **Landmarks as 3D objects on the road:** chest and trophy nodes drawn as chunky
   illustrated objects with their own ledge/shadow.
   Source: https://screenrove.com/duolingo/design
5. **Ambient motion is always on, even when idle:** characters blink/breathe/nod;
   the current node pulses continuously; the streak flame idles at a 2s pulse;
   celebration sparkles loop continuously on the result screen. Nothing on the
   home screen is fully static.
6. **Full-bleed scene changes mark transitions:** lesson-complete = full green
   takeover; streak screen = orange flame world; Super = full navy band. The
   _background itself changes_ to signal "you are somewhere new", rather than a
   modal on top of the same screen.
7. **The Creedo lesson (a Duolingo-style lesson-map app, 2026):** a beautiful desk
   scene _competed_ with the lesson nodes once buttons/labels/nav were layered on
   top. Their fix, directly applicable to Candle: **"a quieter middle, with the
   details that tell you where you are arranged around the sides"** — keep
   scenery at the edges, leave open space behind the path, keep landmarks
   recognisable but small, and check every background _with the map on it_, on
   small phones through desktop. Too much painted detail simplified into flat
   shapes felt like "a vector poster"; the winning version brought back rounded
   scenery + gentle shading with _fewer_ small details.
   Source: https://www.creedo.faith/blog/making-room-on-the-lesson-map.html

**Candle translation:** quiet centre corridor for the node road; world-building
(The Exchange district scenery, mentor characters, ambient props) at the
left/right edges and in the unit banner colour; one palette shift per zone; idle
life everywhere; scene-change takeovers for celebrations; parallax only on the
edge scenery, never under tappable nodes.

### 2.8 Caveats

- Logged-in learn screen, leaderboards, shop, quests and paid flows were **not**
  directly readable (login wall; `duolingo.com/learn` returns marketing when
  logged out). Those sections rely on the Screenrove guest capture + teardowns.
  Sources: https://www.duolingo.com/learn ; https://screenrove.com/duolingo/design
- Node/button point sizes and motion millisecond values come from the Axhub iOS
  reconstruction and Vox research doc, not Duolingo's published specs — treat as
  close reconstructions, re-measure against screenshots before building.
- Gems icon colour differs between sources (blue diamond on current mobile vs
  yellow in some teardowns) — verify against a current screenshot before locking
  Candle's currency colours.

---

## 3. Matiks — the Arena (mascot: Sero, not Siro)

### 3.1 Overall visual language

- **Dark-first UI.** Screen recordings consistently show a dark-theme app: black
  splash screen, dark home, dark duel screens.
  Sources: https://www.facebook.com/reel/3102594389932637/ ;
  https://www.instagram.com/reel/Db2YlMJTt89/
- **Black + electric green is the core brand pairing.** Black splash with the green
  "o/o" Matiks logo and wordmark "MATIKS — play it smart"; merch uses bold
  lime-green "MATIKS SQUAD" lettering on black; World Cup card screen uses a
  green radiating background.
  Sources: https://www.facebook.com/reel/3102594389932637/ ;
  https://www.instagram.com/p/DdJKmcnSqqP/ ;
  https://www.instagram.com/reel/DaPLhPEzEBW/
- **Purple is the secondary accent.** The mascot is purple in merch/posters
  (sunglasses, headband versions); World Cup player cards are "cartoonish purple
  card characters". Sources: https://www.instagram.com/p/DdJKmcnSqqP/ ;
  https://www.instagram.com/p/DaC45hps5WC/
- **Positioning language is e-sport, not school.** Official store copy: "Matiks
  isn't your usual math learning app; it's where cool math games meet real-time
  brain challenges, and brain training feels more like an e-sport than a study
  session"; "Step into the Matiks Arena"; tagline "play it smart".
  Source: https://play.google.com/store/apps/details?id=com.matiks.app&hl=en_US
- **No ads.** AppBrain lists "Ads: No ads" — a major premium-feel decision for a
  free app with 7.2M installs. Source: https://www.appbrain.com/app/matiks/com.matiks.app
- **Typography:** no font name is published. Observable: bold, condensed, all-caps
  display type for headers ("MATIKS", "DAILY CHALLENGES", "VICTORY"/"DEFEAT"),
  with large numerals for problems, scores and ratings. Hierarchy is _one huge
  number + one short label_, never dense paragraphs.
- **Copy tone is short, punchy, second-person, status-driven:** "Forget boring
  solo puzzles", "Every tap, every calculation, every win makes your brain
  faster", "grab your phone, flex your brain, and step into the arena".
  Source: https://play.google.com/store/apps/details?id=com.matiks.app&hl=en_US

### 3.2 The character: Sero — identity + celebration, not a tutor

- **Sero is a blue, smiling, blob-like character** — "a small square cake decorated
  to look like the blue Matiks character — a smiling face with closed eyes and
  blush marks" (100-day streak cake unboxing). Community hashtags #matiks #sero.
  Sources: https://www.instagram.com/reel/Ddjpqu2tZ-f/ ;
  https://www.instagram.com/reel/DeKFroouRxK/
- **The mascot exists mainly as merch and milestone ritual, not as an in-game
  speaking coach.** Verified appearances: purple variant with sunglasses on a
  "60 DAY STREAK DONE" card and "MATIKS SQUAD" merch; purple variant with a white
  headband on league posters; blue Sero face on the physical 100-day streak cake
  with a gold acrylic topper reading "THE 100 ON MATIKS".
  Sources: https://www.instagram.com/p/DdJKmcnSqqP/ ;
  https://www.instagram.com/p/DaC45hps5WC/ ;
  https://www.instagram.com/reel/DeKFroouRxK/
- **No evidence was found of Sero speaking, giving hints, reacting to answers,
  or appearing inside duel screens.** Gameplay recordings show no mascot in the
  duel HUD — just problems, keypad, timer and scores. The character's job is
  _identity + celebration_, not tutoring. Transferable lesson: a mascot can carry
  brand and reward emotion without cluttering the learning moment.
- **Transferable pattern:** one simple, ownable face → repeated identically across
  merch, physical rewards, and event posters → becomes a status symbol users
  post unboxing videos of. The cake is the proof: users film themselves cutting
  a cake shaped like the mascot.

### 3.3 The Arena model — levels, challenges, matches

- **Home is organised by skill category, not by curriculum:** four top-level
  categories — **MATH, MEMORY, PUZZLE, LOGIC** — each containing named duel modes
  (Sprint Duels, Fastest Finger, Flash Anzan, Sudoku, Cross Math, KenKen, Ability
  Snap, Mind Snap, Pin Ball Recall…).
  Sources: https://www.facebook.com/reel/3102594389932637/ ;
  https://www.instagram.com/reel/Db2YlMJTt89/
- **Daily Challenges are the solo spine:** 4 daily puzzles (Math Maze, Cross Math,
  Mini Sudoku, KenKen), each in Easy + Hard, resetting at **12:00 AM IST**; the
  full set takes "under 8 minutes". Home shows a progress counter ("DAILY
  CHALLENGES 1/6 complete").
  Sources: https://www.matiksguide.in/tips/matiks-streak-guide/ ;
  https://www.instagram.com/reel/Db2YlMJTt89/
- **The duel loop is ruthlessly short: 60 seconds.** Tap play → instant
  matchmaking → 3-2-1 countdown → 60-second arithmetic race → "Calculating
  result…" → result screen. Problems are single-line (e.g. `35 ÷ 5`), answered
  on a large on-screen numeric keypad.
  Sources: https://www.facebook.com/reel/3102594389932637/ ;
  https://www.instagram.com/reel/DfVGE-TBzsA/
- **Matchmaking is presented as a live event, not a form:** the app "searches for
  an opponent", then shows both usernames with their ratings side by side
  (observed: 899 vs 950; 1116 vs 1126), then counts down from 3.
  Sources: https://www.facebook.com/reel/3102594389932637/ ;
  https://www.instagram.com/reel/DfVGE-TBzsA/
- **Live score tension is the core mechanic:** during the duel you see your score
  vs the opponent's score updating live; one recording notes "the opponent's
  score leads" mid-match.
  Source: https://www.facebook.com/reel/3102594389932637/
- **Ratings, not grades or percentages.** A Chess.com-like **ELO rating** (entry
  ~800–1000; 1200–1400 = consistent daily solver; 1600+ = top tier) rises/falls
  with wins/losses; a victory screen shows the rating increase (observed:
  "rating increase to 996"). One rating is shared across games of a type.
  Sources: https://www.facebook.com/reel/1683650696803719/ ;
  https://www.matiksguide.in/community/
- **Onboarding is calibrated to get you into a duel in session one:** sign-up →
  skill calibration → first duel → Arena rating. "First duel happens in session
  one", "Live duels create real social stakes".
  Source: https://ishitajhunjhunwala.github.io/assets/matiks-teardown.pdf
- **Progression is by rating tiers + leagues, not chapters:** Open Division →
  Master League (Elo >1800); private leagues; Creators Programme.
  Sources: https://www.matiksguide.in/community/ ;
  https://bhaskarranjankarn.medium.com/why-people-are-solving-math-problems-for-fun-at-2-am-41d4bbf4c9d4

### 3.4 Rewards — coins, streaks, physical prizes

- **Currency is called "Pi" (π), not "coins" generically.** Home header shows a
  Pi balance (observed: 195, 125, 3568 in different recordings). Pi is spent on
  boosts, streak restoration, streak shields, custom puzzle themes, tournament
  entry tokens and leaderboard badges.
  Sources: https://www.instagram.com/reel/DPdzuqUDTgt/ ;
  https://matiksguide.in/matiks-referral-code/
- **Streaks are the central retention mechanic, shown as a flame + day count**
  (observed: "356 flame streak", "163-day streak"). Rules (community-reported):
  complete all 4 daily puzzles before midnight IST; coin multipliers rise with
  streak (1× days 1–6, 2× from day 7, 3× from day 100).
  Sources: https://www.instagram.com/reel/Db2YlMJTt89/ ;
  https://www.matiksguide.in/tips/matiks-streak-guide/
- **Streak Shields (freeze tokens)** are a purchasable/earnable shield: one shield
  = one missed day forgiven; must be active _before_ midnight; max 2 held.
  This is a premium-feeling "insurance" product, not a penalty screen.
  Source: https://www.matiksguide.in/tips/matiks-streak-guide/
- **Milestone rewards are physical, not just digital — the most distinctive
  Matiks pattern:** 50-day streak → T-shirt; 100-day → a real cake delivered
  (Sero-face cake, "THE 100 ON MATIKS" topper); 200-day → limited-edition hoodie
  - merch box shipped pan-India. Users post unboxing videos; retention becomes
    social content. Caveat: fulfilment is a real complaint (users report waiting
    60+ days for shirts), so the pattern is powerful but operationally risky.
    Sources: https://www.matiksguide.in/community/ ;
    https://www.instagram.com/reel/Ddjpqu2tZ-f/
- **Leaderboards are global + friend-based + event-based**, and profiles are
  public stat sheets: per-mode ratings (observed: 1794 Blitz, 1514 Classical),
  max streak (163), total games (916).
  Source: https://www.instagram.com/reel/DPdzuqUDTgt/
- **"Flex" is a named feature:** Matiks Pro unlocks "unlimited Flex" alongside
  Game Insights, unlimited Post Duel Reviews, and an extra streak shield slot —
  showing off is a first-class, monetised feature, not an afterthought share button.
  Source: http://itunes.apple.com/app/id6738620563
- **Seasonal collection events:** the World Cup campaign (Jun 29–Jul 20, 2026) —
  play 5 brain games to earn a collectible player card; collect all 11 to
  complete a starting XI (soccer formation grid with a "WORLD CUP 4/11" progress
  tracker) for a chance at an official jersey.
  Sources: https://www.instagram.com/reel/DaPLhPEzEBW/ ;
  https://www.facebook.com/reel/1009278461971960/
- **Social streaks:** a "buddy streak" — two people maintain a shared streak
  together (observed: a 100-day buddy streak).
  Source: https://www.instagram.com/reel/DbwmjwwvhU5/

### 3.5 Home screen layout & navigation

- **Top status strip:** profile avatar/username + Pi balance + flame streak count
  - XP (observed together: "3568 coins, 356 flame streak, 94 XP"). The user's
    _status_ is the header — not a menu, not a greeting.
    Sources: https://www.instagram.com/reel/Db2YlMJTt89/ ;
    https://www.instagram.com/reel/DPdzuqUDTgt/
- **Opponent/social strip:** a row of circular avatars labelled "YOU",
  "ALAMIN143", "OMKARRA…", "BLUEWIN…" — other players are present on the home
  screen itself, making it feel inhabited.
  Source: https://www.instagram.com/reel/Db2YlMJTt89/
- **Daily Challenges section with an explicit progress fraction** ("1/6
  complete") sits above the game categories.
  Source: https://www.instagram.com/reel/Db2YlMJTt89/
- **Category sections (MATH / MEMORY / PUZZLE / LOGIC)** each list their duel
  tiles by name. Tapping a mode starts matchmaking immediately.
- **No bottom-nav / tab structure could be verified** from the sources available —
  do not assume one. What is verifiable is the _vertical scroll of sections_
  (status → people → daily → categories) rather than a dashboard grid of widgets.
- **Splash/loading is branded, not blank:** black splash ("MATIKS play it smart",
  "GAMES – Unrivaled Performance") → "Getting things ready" loader. Even waiting
  is on-brand. Source: https://www.facebook.com/reel/3102594389932637/

### 3.6 Motion, celebration, aliveness

- **Rive is the animation backbone (verified technically).** matiks.com's own
  storage keys show cached Rive animation files (`device:rive_cache_*`,
  `RiveAnimationCache#files`) — vector, state-machine-driven character/UI
  animation, not GIFs or video. Source: https://matiks.com/
- **Ritualised transitions:** 3-2-1 countdown into every duel; "Calculating
  result…" with an hourglass animation; full-screen **VICTORY** (with rating
  gain) / **DEFEAT** (red screen) result cards. One reviewer complains the
  result screen "disappears in a microsecond" — Matiks arguably _under_-
  celebrates; a premium redesign should let the result breathe.
  Sources: https://www.facebook.com/reel/3102594389932637/ ;
  https://www.appbrain.com/app/matiks/com.matiks.app
- **Sound + pace:** "upbeat electronic background music" during play; the whole
  loop is designed to feel like a 60-second sportscast, not a lesson.
  Source: https://www.facebook.com/reel/3102594389932637/
- **Layered backgrounds (evidence is thin — marked honestly):** the World Cup card
  screen is "bold white text over a green radiating background with a stylized
  card graphic" — a radial burst + layered card graphic, not a flat colour; the
  "My Team" view is a soccer **formation grid** with cartoon player cards
  positioned on it — a _scene_ (a pitch) rather than a list. Branded transitional
  scenes (black splash, 3-2-1 countdown, hourglass) replace blank spinners.
  **Not verified:** ambient background motion on the home screen, parallax, or
  interactive mascot reactions. Matiks' "aliveness" comes from _live humans_
  (opponent presence, live scores, countdowns, events) and _state-change
  rituals_, not from decorative ambient animation.
  Sources: https://www.instagram.com/reel/DaPLhPEzEBW/ ;
  https://www.facebook.com/reel/1009278461971960/

### 3.7 Why it feels like a game, not an ERP dashboard

From the founder interview and analysis: "Instead of treating math like a
subject, we built a game that people love to play"; "we designed Matiks to give
users the same dopamine hit they get from winning a game or solving a puzzle";
"Math has always been taught as something you _endure_. Matiks turns it into
something you _compete in_."
Sources: https://youngandcalculated.blog/why-so-many-people-fear-math-and-how-matiks-is-making-it-fun-again-calculated-conversations-27-with-mohan-kumar/ ;
https://bhaskarranjankarn.medium.com/why-people-are-solving-math-problems-for-fun-at-2-am-41d4bbf4c9d4

1. **Sport framing everywhere:** "Arena", "duels", "battles", "leagues", "World
   Cup", "rating" — the vocabulary of sport replaces the vocabulary of school.
2. **A human opponent, not a progress bar.** Every session is a live match
   against a named person with a visible rating; losing _status_ (rating,
   streak) is the retention engine. "Once your rating starts going up, you're
   not just learning anymore. You're protecting a rank."
3. **Sessions are 60 seconds, not 30 minutes.** The unit of play fits a queue,
   a break, a scroll-replacement moment.
4. **Status is public and comparable.** Ratings, streaks, leaderboards, profiles
   with per-mode ratings, and the social feed create ambient social pressure.
5. **Rewards escalate from digital to physical to social.** Pi → shields →
   badges → cake → hoodie → jersey; each tier is rarer, more tangible, and
   more shareable.
6. **No lectures, no theory, no passive content.** "That's it. No lectures. No
   theory. No passive learning. Just pure, competitive problem-solving."

### 3.8 Gaps / what could not be verified

- No font names, colour hex codes, spacing scale, or component specs are public.
  Do not invent them.
- Bottom navigation / tab structure, settings screens, and exact home-screen
  section order beyond §3.5 could not be verified from text sources.
- Whether Sero appears inside the app at all (vs only merch/cakes/posters) is
  **unverified** — all confirmed mascot sightings are outside gameplay.
- Coin/XP earn rates and multiplier tiers are community-reported
  (matiksguide.in), not official; treat numbers as directional.
- matiks.com/apps fetch timed out; matiks.com returned only cookie-consent text.

---

## 4. Spotify — one accent, tonal depth, imagery as colour

### 4.1 The core idea

Spotify is a **content-first dark interface**: the chrome is deliberately
achromatic and recessive so that _imagery supplies all the colour_. One vivid
accent is rationed to the single most important action (Play). Depth comes from
stepping surface lightness, not from borders. "We were also an early dark mode
app, long before dark mode became as popular" and the green was "a very
intentional choice… Choosing this really bold, bright green was about standing
apart immediately" — Nicole Burrow (VP Product Design) & Lauren Solomon,
Spotify Newsroom, 2026.
Source: https://newsroom.spotify.com/2026-04-23/spotify-design-history/

### 4.2 Dark immersive UI — exact layers, ratios, accent discipline

**Surface stack (lightness steps, not borders):**

| Layer                 | Hex                   | Role                                                  |
| --------------------- | --------------------- | ----------------------------------------------------- |
| Shell / pure black    | `#000000`             | Outer shell, sidebar rail, now-playing bar            |
| Base canvas           | `#121212`             | Page background everywhere — _never_ pure black       |
| Card / surface        | `#181818`             | Playlist/album cards, dialogs, panels                 |
| Interactive fill      | `#1f1f1f`             | Pill buttons, search input, icon-button circles       |
| Hover / elevated card | `#252525` – `#282828` | Card hover state, dropdown menus, active sidebar item |
| Popover / modal floor | `#2a2a2a`             | Menus, modals                                         |

**Why `#121212`, not `#000000`:** "a deliberate `#121212` (slightly warmer than
pure 0), because every album cover… is in that colour-rich, mid-luminance band,
and a true black would suck the saturation out of the artwork; the slight lift
gives covers a luminous edge." Panels are separated by **black gutters and 8px
panel corners, not borders** — "No visible border between sidebar and main
content — separation is achieved through the surface tier alone."
Sources: https://www.shadcn.io/design/spotify ; https://www.webdesignhot.com/design.md/spotify/

**Text scale:** white `#ffffff` (primary) · silver `#b3b3b3` (secondary) ·
subdued `#a7a7a7` (metadata) · muted `#727272` (tertiary) · disabled `#535353`.
Contrast AAA: white on `#121212` = 17.4:1; `#a7a7a7` on `#121212` = 6.6:1.

**Accent green — rationed, functional, never decorative:**

- Brand green `#1ed760` (marketing; legacy `#1db954` 2015–2023). In-app Encore
  green sampled from production screens is `#1CD05E` — the marketing green
  "never appears in product UI" per one pixel-sampled analysis.
- Appears **only** on: play/pause controls, active nav, primary CTAs, Liked
  heart, equalizer indicator, progress fill, toasts. "Used exactly once or twice
  per viewport — never decoratively." Hover `#1fdf64`, pressed `#169c46`.
- **Green always pairs with BLACK text/icons, never white** — 13.5:1 contrast,
  AAA, "one of Spotify's strongest brand signals: AAA contrast, plus a
  confident, almost neon-sign feel."
- Semantic colours muted for dark legibility: error `#f3727f` (soft pink-red),
  warning `#ffa42b`, info `#539df5`. Success _reuses_ the brand green.
- **Colour ratio (the transferable rule):** ~95% achromatic charcoal + white/grey
  text, ~5% single accent, and all other colour comes from content imagery.
  "The complete brand palette is green plus a stack of achromatic charcoals —
  album artwork is expected to provide all other color on the page."

**Caveat:** the hex/token values are drawn from multiple independent
reconstructions of the live web player that corroborate each other (and one
source documents direct verification against open.spotify.com); they are not
from official Spotify documentation, which does not publish Encore tokens.
Sources: https://www.shadcn.io/design/spotify ;
https://www.webdesignhot.com/design.md/spotify/ ;
https://styles.refero.design/style/cc59e195-fed0-4928-96d1-303752786073 ;
https://www.m--k.me/design-systems/spotify.html

### 4.3 Navigation — a quiet utility rail

- **Three-pane chrome, unchanged since 2014:** 240px pure-black `#000000` left
  sidebar · `#121212` main panel · 90px pinned now-playing bar across the bottom.
- **Sidebar:** logo top-left, nav below, library list fills the rest. Active item
  = **weight contrast only** (white, 700) vs inactive (silver `#b3b3b3`, 400);
  hover → white text, background stays transparent. No coloured fill, no left
  border indicator — restraint is the signal.
- **2023 redesign:** sidebar became "Your Library" — artwork thumbnails beside
  every playlist/artist, filter chips, search _inside_ the library, drag-to-
  resize, collapse to an **icon-only vertical strip of artwork**.
  Source: https://newsroom.spotify.com/tag/user-experience/
- **Top bar (64px, inside main panel):** back/forward arrows, search, profile
  menu. Background **scrolls from transparent over the hero gradient to solid
  `#121212`** — it dissolves into content rather than sitting on a bar.
- **Search is the only white surface in the system:** white `#ffffff` pill
  (9999px radius, 40px tall), black magnifier — "the only white surface,
  intentional foregrounding."
- **Mobile collapse:** sidebar → bottom-tab nav (Home / Search / Library only);
  now-playing bar condenses to a 64px mini-player, tap expands to full-screen.
  The bar is **never removed** — internal regions collapse instead.
- **Transferable principle:** navigation is a quiet utility rail that _gets out
  of the way_; the content panel owns the screen. Wayfinding = typography weight
  - one accent, not coloured pills or borders.

### 4.4 Cards — imagery-first, pill-and-circle geometry

- **Album tile (canonical content unit):** `#181818` fill, **8px radius**, 16px
  padding, **1:1 cover art on top**, 8px gap, title 18px/700, artist 14px/400
  `#a7a7a7` beneath. **No shadow at rest.** Tile widths 168–220px; grid 5 cols
  (desktop >1280px) → 4 → 3 → 2 → 1 (mobile).
- **Hover (the signature interaction):** background lightens `#181818 → #282828`
  (200ms); cover art gains `0 8px 24px rgba(0,0,0,0.5)`; a **56px circular
  green Play FAB pops in over the cover's bottom-right** with a spring ease
  (200ms, 100ms delay). Hero Play FAB is 72×72, scales 1.06× on hover; primary
  pill scales 1.04×.
- **Shape language is pill-and-circle:** primary buttons 500–9999px radius (full
  pill), play controls 50% circle, search 500px pill, cards tight 6–8px, panels
  10–20px. "There is essentially no square corner on any interactive surface —
  pill-and-circle geometry is the system's tactile identity."
- **Imagery-first:** the card _is_ the artwork — text is two lines max, metadata
  in grey. Artist cards use full-circle portraits. Feature cards (Daily Mix,
  Wrapped) use a gradient sampled from the cover art:
  `linear-gradient(135deg, var(--cover-color), #181818)`.
- **Track rows:** transparent fill, 8×16px padding, hover lifts to `#272727`;
  number left, title/artist centre, album/duration right; times use tabular
  numerals (`tnum`) so columns align.
- **Familiar vs discovery sizing:** small dense tiles for recently-played/familiar
  content (no header needed); large image-heavy cards for unfamiliar discovery
  content, because novelty needs a pitch. The intentionally cut-off card at a
  row's edge cues horizontal scrolling.

### 4.5 Typography, spacing, collections

- **Font:** SpotifyMixUI (body) + SpotifyMixUITitle (display) — proprietary,
  from the CircularSp family. Open substitute: **Inter**, tightening uppercase
  letter-spacing from 1.4px to 1.2px.
- **Binary weight system:** almost everything is **700 or 400**; 600 reserved for
  feature headings/badges. "Hierarchy comes from weight contrast more than
  size." No 500 in routine production.
- **In-app range is compact: 10–24px** ("an app, not a magazine"). Display scale
  runs 24–96px only for heroes/Wrapped: section title 24px/700 · feature heading
  18px/600 · body 16px/400 · caption 14px/400 · small 12px/400 · badge 10.5px/600.
- **Display voice:** 700–900 weight at 32–96px with **aggressive negative
  tracking −0.03em to −0.04em** (−0.05em on Wrapped 96px stats). Line-height
  tight: 0.96–1.25 on display.
- **Button labels are a separate "label voice":** 14px/700, **uppercase,
  1.4–2px letter-spacing** — "the single most distinctive typographic move in
  the system."
- **Sentence case everywhere except badges** ("Made for you", not "Made For You");
  uppercase belongs only to small badges (NEW, EXPLICIT, PREMIUM).
- **Spacing:** 4px base, scale 4/8/12/16/20/24/32/40/48/64/80/96/128. Section gap
  32px between carousels (48px major modules); tile gap 24px desktop / 16 tablet
  / 12 mobile; card padding 16px; content max-width 1440px.
  Philosophy: **"dark compression"** — "the dark `#121212` background provides
  visual rest between elements without needing large gaps."
- **Section cadence (home):** top bar → time-aware greeting hero ("Good evening,
  [name]") → "Made For You" rail → "Recently Played" rail → 4–8 personalised
  rails → genre rails → compact footer. **6–8 carousel rows above the fold on a
  1080p display** — "the page reads as a content wall."
- **Playlist page hero:** the page **samples the dominant colour from the cover
  art and gradient-washes the top 232px**
  (`linear-gradient(180deg, var(--cover-color) 0%, transparent 232px), #121212`),
  fading into the canvas. 232×232 cover left, title/creator/stats right, large
  green Play FAB anchored at the bottom of the cover area. "The album you opened
  defines the atmosphere of the room."
- **Progress:** scrubber is a 4px rail (`#535353`), white fill by default,
  **turning green on hover** with a hover-revealed handle; time labels 12px/400
  `#a7a7a7` in `tnum`. A **green animated 3-bar equalizer** marks the currently-
  playing row (1.4s loop, pauses on hover, static under reduced motion). Liked
  heart fills green with a 1.2× scale pop.
- **Discovery is personalisation-as-interface:** home feed is a stack of
  personalised shelves (Discover Weekly, Release Radar, Daily Mixes, mood/genre
  rows), "different for almost every user."

### 4.6 Motion

| Moment                           | Spec                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Easing — standard / out / spring | `cubic-bezier(0.4,0,0.2,1)` / `(0.3,0,0.4,1)` / `(0.34,1.56,0.64,1)`                                                |
| Durations                        | fast 100ms · standard 200ms · slow 400ms · tile hover 300ms                                                         |
| Tile hover                       | bg `#181818→#282828` (200ms) + cover shadow fade (300ms) + FAB `scale(0)→scale(1)` spring, 200ms, 100ms delay       |
| Primary CTA hover                | `#1ed760→#1fdf64` + `scale(1.04)`, 200ms; pressed `#169c46`, scale back to 1.0                                      |
| Liked heart                      | scale 1.0→1.2→1.0 over 300ms spring, colour flips to green at midpoint                                              |
| Modal in                         | 200ms ease-out, scale 0.96→1.0 + opacity 0→1                                                                        |
| Toast                            | slide down + opacity 200ms; auto-dismiss after 2s                                                                   |
| Page change                      | 100ms opacity fade of content only — sidebar + player bar persist; hero gradient regenerates from the new cover art |
| Equalizer                        | 3 bars, sine-wave, 1.4s loop                                                                                        |

- **Speed is a feature:** "The interaction is faster than Netflix's deliberate
  0.75s dwell — Spotify's tiles respond on hover-enter, not on dwell, because
  audio is more disposable than video and users browse faster."
- **Reduced motion is honoured:** tile hover collapses to opacity-only colour
  shift, FAB fades instead of popping, equalizer halts to a static SVG, toasts
  appear instantly.
- **Playback bar:** `#000000`, 90px, pinned full-width at every breakpoint.
  Layout: 64×64 cover thumb + title/artist + Liked heart (left) · transport +
  scrubber (centre) · queue/devices/volume (right). Buttons 40×40 circular;
  primary play ≥48×48.

### 4.7 Layered backgrounds, ambient elements, scene depth

1. **Cover-art-derived atmosphere (the master trick).** Every playlist/album page
   washes its top 232px in a gradient sampled from the cover art, fading into
   `#121212`. On mobile Now Playing, the whole screen is a vertical gradient
   from the track's dominant colour (100% opacity, top) to canvas black (bottom)
   over ~60% of viewport height, recalculated per track at playback time.
   _The content colours the room; the chrome never does._
2. **Scrims, not overlays.** Legibility over imagery uses gradient scrims:
   `linear-gradient(180deg, rgba(0,0,0,0.6), transparent)` (top) and
   `linear-gradient(0deg, rgba(0,0,0,0.7), transparent)` (card bottom) — soft
   light falloff, never a flat dark panel or a hard box.
3. **Canvas — ambient looping visuals.** A 3–8 second seamless 9:16 looping video
   (or still) that _replaces static album art_ on the Now Playing screen,
   autoplaying for the whole song. Spotify's own data: +5% streams, +145%
   shares, +20% saves for tracks with Canvas. The rules are instructive:
   "ambient and complementary… Mood, not story" — slow drift, abstract textures
   (smoke, water, ink), one repeating cyclical motion, no titles/CTAs in frame,
   first and last frames must match so the loop is invisible. Canvas is "album
   artwork, for the streaming age." Source: https://artists.spotify.com/en/canvas
4. **Wrapped — the annual immersive set-piece.** Once a year the restraint
   inverts: full-screen gradient backgrounds per slide, oversized gradient-filled
   numerals (96px, 900-weight, −0.05em tracking) used _as pattern_, condensed
   type, flat bold colour fields with clean text kept on flat areas for
   legibility. Wrapped "set a standard in the industry… inspired many copycats"
   and turned personal data into a shareable visual story (73.7B views in 2023).
   The lesson: **restraint all year earns one loud moment.**
   Source: https://medium.com/designright/three-design-elements-that-made-spotify-wrapped-2024-great-0a8e2b133b72
5. **Living indicators.** The animated green equalizer on the playing row, the
   scrubber that turns green on hover, the heart pop — small continuous motion
   signals "this is alive right now" without animating the whole page.
6. **Easter eggs & personality as depth.** The Now Playing view once flipped
   upside-down for _Stranger Things_; artist-specific Easter eggs (Taylor Swift
   2024, Bad Bunny 2025); a hidden "Eat This Playlist" game; time-aware
   greetings ("Good evening, Richard"). "There are so many things you don't
   instantly see, but you feel."
7. **Elevation through heavy neutral shadows:** on `#121212`, shadows must be
   0.3–0.5 opacity to read at all — `rgba(0,0,0,0.5) 0 8px 24px` for hovered
   cards, two-layer modal shadows. Shadows are **never brand-tinted**; green is
   reserved for the brand, not for elevation.

### 4.8 What makes it premium rather than a grey ERP dashboard

Seven decisions, all the _opposite_ of dashboard defaults:

1. **One accent, rationed to one verb** (Play). ERP dashboards spray 4–6 status
   colours; Spotify has exactly one, and it means "the action."
2. **Imagery is the colour system.** The UI is achromatic by design; every splash
   of colour is _content_ (cover art), so the screen always feels rich without
   the chrome trying.
3. **Depth = lightness steps + heavy neutral shadows**, not borders, dividers and
   boxes. Panels touch; separation is tonal.
4. **A custom typeface doing double duty** — heavy, tight-tracked display +
   modest body — with hierarchy from weight contrast (700/400), not size soup.
5. **Tactile geometry** — everything you touch is a pill or a circle; everything
   you read is a tight-radius card. It feels like a device, not a form.
6. **Density with intent** — 6–8 content rows above the fold; whitespace
   separates rows, it doesn't "breathe." The one generous space is the
   atmospheric hero, which earns its air.
7. **A living layer** — art-derived gradients, Canvas loops, equalizer, Wrapped —
   the screen is never a static grey slab; something is always subtly moving or
   personal.

### 4.9 Candle translation (Spotify → Candle)

| Spotify pattern                                     | Candle translation                                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Green rationed to Play                              | Gold `#E9B44C` rationed to Start Duel / primary CTA, active nav, streak, progress — nothing else                          |
| `#121212 → #181818 → #1f1f1f → #282828` tonal stack | Ink `#0B1120` base, stepped card surfaces; no bordered boxes                                                              |
| Album tile = artwork + 2 lines                      | Lesson/duel tile = mentor/lesson art + title + meta; hover reveals circular gold "Play" FAB                               |
| Cover-art-derived hero gradient (232px fade)        | Duel/lesson hero gradient sampled from that lesson's art or mentor colour                                                 |
| Shelves: Made For You / Recently Played / Daily Mix | "Continue learning" / "Daily Duel" / "Made for you" / league rails; small tiles for familiar, large feature cards for new |
| Now-playing bar (persistent, 90px)                  | Persistent "now learning" bar: current lesson/duel, progress scrubber, streak — never hidden, collapses on mobile         |
| Scrubber: white fill → accent on hover              | Lesson progress: dark rail, white fill, gold on hover                                                                     |
| Equalizer on playing row                            | Animated live indicator on the active duel/quest row                                                                      |
| Wrapped (annual stat spectacle)                     | Season-end recap: oversized 96px gold numerals, gradient stat slides, shareable                                           |
| Canvas (3–8s ambient loop)                          | Looping ambient background on duel lobby / lesson hero — mood, not story                                                  |
| Time-aware greeting                                 | "Good evening, Nishu" + streak nudge in the greeting slot                                                                 |
| Encore token system (22 systems → 1)                | One token layer: surfaces, one accent, type scale, radii, motion — before building screens                                |

---

## 5. Brilliant — adult, premium, restrained

**Positioning:** "Duolingo for logical thinking" but adult, premium, restrained.
"Its design language reads as _education that respects your intelligence —
premium, structured, never cute._"
Source: https://www.webdesignhot.com/design.md/brilliant-org/

### 5.1 Home, loop, navigation

- **Mobile home = continuation, not catalogue:** a single active course resumes
  front and centre. Top strip holds reward currencies (keys, discount, coin,
  lightning bolt); bottom nav is just **Home / Courses / Premium / Profile**.
  Source: https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/
- **Core loop:** each lesson opens with a **2–4 sentence concept intro +
  illustration**, then a **chain of interactive problems** — "learn by doing",
  not lecture-first. Wrong answers are **not penalised**: UI shows the correct
  answer and explains the reasoning. Immediate per-problem feedback with worked
  explanations.
  Sources: https://math.kilowatto.com/en/research/mc-14-competitive-products/ ;
  https://understandtutor.com/blog/brilliant-review
- **Learning Paths:** guided sequences from core ideas to advanced, with practice
  checkpoints; 40+ courses, elementary→graduate.
  Source: http://brilliant.org/help/features/
- **Inside problems:** sliders, draggable diagrams, multi-step reveals;
  **tap-to-select instead of typing**; guided code field; speaker button reads
  tasks aloud; "Check" button to consciously commit; visual hints instead of
  full solutions when stuck.
  Source: https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/
- **Discovery is path-led, not search-led. Ask Koji from the Home tab:** type a
  question in your own words and it routes you to the covering concept —
  discovery via the tutor, not a search box.
  Source: http://brilliant.org/help/features/

### 5.2 Colour, typography, cards, buttons (note the split — do not conflate)

- **Marketing site (brilliant.org):** near-black canvas **`#0c0e16`** (never pure
  black), single accent **"Brilliant Coral" `#fc6e51`** for CTAs, white body copy.
  Diagram accents (yellow `#ffd44d`, cyan `#5ac3e5`, purple `#b582ff`) appear
  **only inside illustrations, never as CTA palette**. Headings in custom
  **Brilliant Sans** at **56–88px**.
  Source: https://www.webdesignhot.com/design.md/brilliant-org/
- **In-app UI:** black-and-white first, single action green **`#29cc57`** for
  CTAs/affirmative states, paper-white `#ffffff` cards, hairline borders
  `#e4e4e4`, **fully pill-shaped buttons (9999px)** — "avoid sharp corners".
  Headings in CoFo Robert (serif) + CoFo Brilliant sans, body 16px/1.5;
  **green progress bar at the top of every lesson**.
  Sources: https://designmunk.com/brilliant/ ;
  https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/
- **Premium lesson:** one canvas + one accent voltage, and the accent has a
  _story_ (coral evokes warm orange of physics-textbook diagrams) — not a
  default palette pick.

### 5.3 Gamification

- **XP** from concepts/problems; **weekly XP sets standing in Leagues**: weekly
  competitions between **30 learners**, **10 league levels named after elements,
  Hydrogen → Einsteinium**.
  Sources: http://brilliant.org/help/features/ ;
  https://understandtutor.com/blog/brilliant-review
- **Streak:** extend by solving **3 problems or finishing 1 concept/day**.
  **Streak Charges** auto-protect a missed day, max **2** held. Free users get
  **2 keys/day**, each opening one lesson. Also coins, lightning bolts, daily
  goals, **iOS widget showing streak + practice prompts**.
  Sources: http://brilliant.org/help/features/ ;
  https://understandtutor.com/blog/brilliant-review
- **Presentation:** currencies sit in a quiet top strip, never a flashing HUD.
  Progress is a **thin green bar atop every lesson** plus narrow bars between
  sections — ambient, always visible.

### 5.4 Motion, celebration, character

- **Koji transition animation between learning steps**, flanked by narrow
  progress bars — "the app thus continuously makes visible that you have
  completed a section and have arrived at the next step. This constant small
  feedback is the actual motivational engine."
  Source: https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/
- **Rive state machines, GPU rendering, 60 FPS constant** — rated 5/5 visual
  quality in competitive analysis.
  Source: https://github.com/overclockedbrains/insyte/blob/HEAD/.planning/research/canvas-renderer/agent-c-competitive-trends.md
- **Celebration (observed in app footage):** "Lesson complete!" + XP + score
  (e.g. 3/3) + "You started a streak!" — small, specific, immediate.
  Source: https://www.instagram.com/reel/DdFZaKqxd9h/
- Respects `prefers-reduced-motion: reduce` (geometry animations disable).
  Source: https://www.webdesignhot.com/design.md/brilliant-org/
- **Character — Koji (AI tutor, launched 29 May 2026):** sees what you're working
  on, walks you through thinking step by step **without giving the answer**, can
  highlight/rearrange on-screen interactives. **Speaks first by default** — talks
  at the start of every lesson page — reacts to correct answers, signals when
  help is available. A _functional_ character (tutor + hints + router), not
  decoration. **Validates Candle's existing host rule:** hosts speak
  before/after, never during a rated question.
  Sources: http://brilliant.org/help/features/ ;
  https://understandtutor.com/blog/brilliant-review

### 5.5 Layered backgrounds / ambient depth

- **Marketing hero: full-bleed animated geometry** — circles morphing to spheres,
  triangles tiling into hexagons, isometric grids in coral/white on near-black.
  The geometry _is_ the background layer; it moves slowly and structurally, like
  a living diagram. Source: https://www.webdesignhot.com/design.md/brilliant-org/
- **In-app, the "scene" is the problem itself:** draggable diagrams, balance
  scales, area models — manipulable mini-scenes, not static question cards.
  Depth comes from _manipulable_ visuals, not background layers.
- **Honest limit:** the app interior is deliberately flat and minimal ("the focus
  is on the problem. No distractions"). Brilliant earns immersion from the
  _content_ animating, not ambient backgrounds — copy its discipline, not its
  flatness, if Candle wants an immersive world.
  Source: https://free-apps-android.com/brilliant/

---

## 6. Headspace — aliveness at low amplitude (strongest on ambient)

**Positioning:** "a children's storybook re-rendered with platform-grade UI
scaffolding". Apple Design Award + Webby laurels.
Sources: https://www.shadcn.io/design/headspace ; https://www.floow.design/aso-screens/headspace

### 6.1 Home / learn screen

- **"Today" tab = personalised home.** Observed in-app: sky-and-clouds header,
  **"Recents" / "Favorites" pill toggles**, "Your essentials" led by one hero
  card — **"Today's Meditation"** (yellow-orange card, 3–20 min, streak counter,
  e.g. 355) — then a short list ("Wind down for bed • 4 min", "Fall asleep •
  45 min").
  Source: https://www.facebook.com/annmariewalts1/posts/pfbid0Gp21ZDTtVAzh6orfg3XfcyiLyTh7s6CcmAjqajPfAbirQNuLkQnokjGjQozsoCkSl
- **2025 redesign:** Today is a scroll of **2-minute Micro-Moments** (mindful
  tooth-brushing, breathing while queueing, 60-sec compassion bursts); a
  **Movement tab** pairs breath with low-impact workouts in pastel studios.
  Source: https://www.successconsciousness.com/blog/tips-for-life/beyond-meditation-7-well-being-apps-that-actually-rewire-your-daily-habits/
- **Content organised by feeling/state** (stress, sleep, focus, anxiety,
  relationships, fitness), not taxonomy; courses are 10–30 short sessions with
  one teacher; **SOS sessions** for panic/anxiety.
  Source: https://www.canmindful.top/blog/best-cute-meditation-apps
- **Marketing page anatomy (measured):** white 80px nav under a yellow strip;
  centred two-line bold H1; two side-by-side warm `#F9F4F2` cards; **six-tile
  category grid** (16px radius) before any real UI; inset radius-16 colour cards;
  full-bleed yellow ticker; giant pill CTA on yellow.
  Source: https://www.unfairly.ai/brand-guidelines/headspace/

### 6.2 Colour, typography, cards, buttons

- **Measured colour ratio on headspace.com (1440px): white 59% · yellow 24% ·
  CTA blue 9% · sky blue 8%.** Orange covers almost no area — logo and
  illustrations only. Source: https://www.unfairly.ai/brand-guidelines/headspace/
- **Tokens:** page floor **warm off-white `#f9f4f2`**; text **warm charcoal
  `#2d2c2b`** (pure black only in form inputs); **single saturated voltage blue
  `#0061ef`** living _only_ on the primary CTA pill + a few accent dots;
  **character orbs** — saffron `#ffce00`, pink `#ffa1cc`, aqua `#00a4ff`, grass
  `#02873e`, ultraviolet `#3b197f`; logo orange dot `#f47d31`; deep indigo
  `#3b197f` for contemplative moments.
  Sources: https://www.shadcn.io/design/headspace ;
  https://styles.refero.design/style/035a098b-5a27-48a3-8a3a-c68a698e3eab
- **Typography:** single custom family **Headspace Apercu**, 400/500/700, 12 levels
  from **12px nav meta to 64px / 700 / −1.92px-tracked hero**; negative tracking
  tightens with size — headlines "sculpted rather than shouted". No serif/italic/
  second family. Source: https://www.shadcn.io/design/headspace
- **Shape:** radii **16px cards, 24px feature plates, 32px CTA, 800px full pill**;
  primary CTA **48px tall, 700/14px**. **No box-shadow tier at all** — depth from
  1px warm hairlines (`#e2ded9`) + rounding. Spacing on 4/8/24/32/48px.
  Source: https://www.shadcn.io/design/headspace
- **App Store screenshots:** yellow→orange gradient wave (`#FCE356` → `#FF6A00`)
  repeated across 6 of 8 frames; two-tone captions (near-black `#1F2937` + burnt
  orange `#FF5F00`); deep purple (`#5B2E8C`) and cobalt (`#2563EB` + pink) frames
  used sparingly to signal different verticals.
  Source: https://www.floow.design/aso-screens/headspace

### 6.3 Gamification — deliberately minimal (the anti-pattern reference)

- Tracks exactly **two things: minutes practiced (today/week/month) + streak**
  (shown, not emphasised). **No XP. No levels. No badges. No quests.** Breaking
  a streak triggers **no loss messaging** — "a gentle nudge to return, not a
  source of anxiety".
  Source: https://www.themasterly.com/blog/progression-systems-that-build-daily-habits
- **Transferable lesson:** restraint is a feature — one quiet consistency metric
  can carry retention better than a loud XP economy, and never makes home look
  like a game dashboard.

### 6.4 Navigation / discovery

- Mobile bottom tab bar: **Today / Explore / Ebb / Care / (profile)**. Ebb = AI
  companion; Care = therapy/coaching.
  Source: https://www.facebook.com/annmariewalts1/posts/pfbid0Gp21ZDTtVAzh6orfg3XfcyiLyTh7s6CcmAjqajPfAbirQNuLkQnokjGjQozsoCkSl
- Chrome minimal on purpose: search icon top-left, account top-right, **no
  typical nav bar** on web — single-page design. Discovery is **state-led**
  ("how are you feeling?"), and Today's first action is a _next step_, not a
  browse grid. Sources: https://squeezegrowth.com/headspace-review/ ;
  https://www.g2.com/products/headspace-headspace/reviews

### 6.5 Motion / celebration — the signature

- **The breathing circle.** The play button **breathes in/out, expanding/
  contracting like lungs**; measured at **scale 1.0 → 1.04 → 1.0 over 8s**
  (one implementation: 12s cycle — 4s inhale, 2s hold, 4s exhale, 2s hold).
  On the Play screen the sphere fills **~60% of the screen** on butter-cream
  canvas, guidance text above, thin progress arc at top. Nothing else.
  Sources: https://www.duaa.design/headspace ;
  https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/headspace-mobile/DESIGN.md
- **Motion rules:** button-press **150ms**; **"animate characters, not layouts"**;
  transitions **400–800ms** (slower = calmer); session-complete = **subtle
  overshoot (1.02 scale)** — gentle "well done", no confetti; ambient stars on a
  **120-second cycle, "so slow it's barely perceptible"**; loading screen morphs
  the Headspace circle through breathing forms.
  Sources: https://www.unfairly.ai/brand-guidelines/headspace/ ;
  https://www.duaa.design/headspace
- **Onboarding motion case study:** breathing animation + gentle dissolves + soft
  circular progress raised activation **34% → 64% (+89%)**, completion +73%.
  Source: https://www.uxstalwarts.com/case-study/headspace-inc/
- Celebration is deliberately quiet: gentle affirmation + progress
  acknowledgement + breathing option.

### 6.6 Character / mascot

- **Orange-beanie mascot is a cultural icon; broader cast = hand-drawn character
  orbs** — round, flat-colour, face-led, floating between sections and inside
  feature chips. They **replace stock photography, gradients, and mesh
  backgrounds entirely**. Since the 2024 refresh, faces express **stress,
  sadness, contentment — not only joy**, matching the emotional topic.
  Illustration kit: **3840×2160 scenes in 8 themes** (Evergreen, Work, Education,
  Mindful Eating, Seasonal, Sleep, Stress/Anxiety, Hard Topics). Rules: **flat
  colour, no outlines, no gradients inside shapes; no realistic people; no stock
  3D or clip art.** Sources: https://www.shadcn.io/design/headspace ;
  https://www.unfairly.ai/brand-guidelines/headspace/
- Characters appear as companions on empty states, milestone reveals, completion
  screens — never as pop-ups.
  Source: https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/headspace-mobile/DESIGN.md

### 6.7 Layered backgrounds / ambient / scene depth — STRONGEST of the six

- **Sleepcasts are immersive _audio scenes_:** placed in a scene — **a slow
  train, a rainy day in a bookshop, a desert campfire, a moonlit garden, a drift
  over a sleepy shoreline**. 45–55 min, **remixed nightly** to prevent
  memorisation; layered ambient sounds (rain, wind, fire) under narration.
  Sources: https://inthemoment.app/articles/calm-vs-headspace ;
  https://www.mobileappdaily.com/product-review/headspace
- **Visual scene depth:** full illustrated scenes (not photos) built from
  circles/soft shapes in bold flat colour; App Store wave gradient and in-app
  sky-and-clouds header give each screen a _place_. **Ambient motion as a
  layer:** barely-perceptible star drift, breathing orbs, slow fades — never
  fully static, never demanding attention. Key transferable idea: **aliveness at
  low amplitude**.
- **Why it feels premium:** "Earns its warmth by **refusing the visual shortcuts
  most peers depend on — no nature photography, no soft-serif gestures, no
  eucalyptus-green wash, no lotus illustration. Just cream canvas, warm charcoal
  ink, one blue pill, and a cast of character orbs.**" One typeface, one CTA
  voltage, flat surfaces, hairlines instead of shadows.
  Source: https://www.shadcn.io/design/headspace
- **Transferable:** (a) warm off-white canvas + one gold voltage validates
  Candle's ink+gold ratio discipline; (b) one signature ambient element
  (breathing sphere → Candle could have a living "Exchange" scene: ticker glow,
  ambient market pulse); (c) characters with _emotional range_ as companions;
  (d) state-led discovery ("what do you want to do today?" — learn / duel /
  trade); (e) celebration at low amplitude.

---

## 7. Khan Academy — mastery visualisation (weakest on ambient, deliberately)

**Positioning:** "warm-not-corporate", mission-driven warmth, free-for-everyone,
volunteer-tutor voice.
Sources: https://www.webdesignhot.com/design.md/khan-academy/ ;
https://blog.khanacademy.org/meet-the-new-khan-academy-classroom-experience/

### 7.1 Home / learn screen

- **Learner Home + Learner Queue (Reimagined 2026):** instead of an assignment
  list, **a focused path through what comes next**. **Daily Missions** (due
  today/tomorrow/overdue), **Weekly Missions**, **Unit Missions** (replace old
  Mastery Goals). Two views: list and a **"Path" view** (visual, direct). "More
  visible progress indicators throughout the platform."
  Sources: https://support.khanacademy.org/hc/en-us/articles/46056261189773-What-s-changing-for-students-on-the-reimagined-Khan-Academy ;
  https://blog.khanacademy.org/meet-the-new-khan-academy-classroom-experience/
- **Learning tree (signature pattern):** units → lessons → skills, with a
  **mastery dot next to every skill**. Subject illustrations are SVG with
  `currentColor` tinting. Source: https://www.webdesignhot.com/design.md/khan-academy/
- **Mobile:** bottom nav **Home / Course / Workbook / Profile**; Home = recent
  activity + recommendations; Workbook = practice with immediate feedback.
  Source: https://tecnobits.com/en/what-does-khan-academy-app-UI-mean/
- **iPad precedent:** grid with **subjects (breadth) vertical, topics (depth)
  horizontal** — cut content access from **8 taps to 2 taps or less**.
  Source: https://www.fastcompany.com/3041180/w_750

### 7.2 Colour, typography, cards, buttons

- **Tokens:** canvas paper-white `#ffffff` (alt bands `#f7f8fa`); **brand mint
  `#14bf96`** on wordmark, CTA, mascot, mastery dots; text warm near-black
  `#21242c`; cream `#fef9e9` for tip/encouragement bands; mint promo band
  `#e3f9f1`. Source: https://www.webdesignhot.com/design.md/khan-academy/
- **Typography:** **Lato** throughout (since 2012), 400/700/900; hero
  **56px/900/1.1/−0.02em**; course title 32px/700; body **16px/400/1.5**;
  uppercase eyebrow 13px/700/+0.08em; points display 16px/700 tabular numerals.
- **Buttons:** primary = **pill (9999px), 48px tall, 12×24px padding, mint
  `#14bf96`, white text, 16px/700**; hover `#0e9a78` ("darker mint shift, **no
  shadow lift, no scale**"); active `#0a7d63`. Secondary = white, 2px `#0a7d63`
  outline. Donate CTA deliberately uses signal blue `#1865f2` to separate the
  nonprofit ask from learning actions.
- **Cards:** course card **8px radius**, 24px padding, **1px border `#d6d8de`**,
  shadow `0 1px 3px rgba(33,36,44,0.06)`; hover deepens shadow only, **no
  scale/translate**. Skill row: mastery dot left, title centre, "Practice"/
  "Mastered" tag right. Lesson tile: **soft mint-tinted bg `#f0fcf7`** + type
  icon + runtime. Encouragement card: cream `#fef9e9`, 12px radius, **1px
  `#f4cf3e` border**, mascot top-left.
- **Radii:** 2/4/6/8/12/9999 — friendly default **8px**; 4px-base spacing scale to
  128px; header 64px, sidebar 280px, content max 1240px.

### 7.3 Gamification — mastery system (the core, most transferable pattern)

- **Mastery system:** skills progress **Not Started → Attempted → Familiar →
  Proficient → Mastered**. Each stage = **colour-coded mastery dot with a
  progress arc**: attempted grey `#a8aab2` · familiar blue `#1865f2` ·
  proficient purple `#9059ff` · mastered deep green `#0a7d63`; matching pill
  badges. You **don't advance until you master the prerequisite** — "no gaps".
  Sources: https://www.webdesignhot.com/design.md/khan-academy/ ;
  https://support.khanacademy.org/hc/en-us/articles/202487710-What-are-energy-points-badges-and-avatars
- **Energy Points (classic):** measure **effort, explicitly not mastery** — shown
  as a yellow pill **"⚡ 2,340"** (`#f4cf3e` border). **Badges in 5 rarity tiers:
  Meteorite → Moon → Earth → Sun → Black Hole**. Avatars level up.
  Source: https://support.khanacademy.org/hc/en-us/articles/202487710-What-are-energy-points-badges-and-avatars
- **Gems (Reimagined 2026 — replaces Energy Points, Avatars, LearnStorm):**
  earned by completing assignments/building skills. **Every 50 Gems = one
  surprise Khanmigo accessory** (hats, glasses — one hat + one pair of glasses
  worn at a time). **Gem total sits upper-right** on Learner Home and every
  lesson; click → **Achievements modal → "Customize Khanmigo" → Collections**.
  **Gem Challenges** (class-level; teacher-set rewards). **Gem Jam** team race:
  each gem moves the team's **Racermigo** mascot up a track in real time.
  Sources: https://support.khanacademy.org/hc/en-us/articles/42456050422157-How-can-my-students-customize-Khanmigo ;
  https://support.khanacademy.org/hc/en-us/articles/45128558403341-How-do-I-use-Gem-Jam-with-my-students-in-Khan-Academy-Reimagined ;
  https://blog.khanacademy.org/five-ways-khan-academy-is-making-student-practice-more-motivating/
- **Streak:** orange fire `#e07c2c`; "Persistence" badge for 5-day streak.

### 7.4 Navigation, motion, character

- Guided, not browsed: Queue + Missions tell you what to do next; the tree shows
  where you are. The two persistent anchors are _help_ (Khanmigo Assistant, top)
  and _progress_ (Gem total, upper-right) — not menus.
  Source: https://blog.khanacademy.org/meet-the-new-khan-academy-classroom-experience/
- **Rainbow confetti erupts on correct answers**; a **friendly monster guides
  lessons**; iPad **handwriting recognition** + scratch-work area beside each
  problem. Source: https://www.fastcompany.com/3041180/w_750
- **Gem-earn moment (launch video):** on-screen **"10 gems earned!"** + unlocked-
  item reveal ("Oval Glasses", "VR Headset", "Ranger Hat") — the reward is a
  _visible thing for your character_, not just a number. Tagline: "More sparkle.
  More fun." Source: https://www.facebook.com/reel/2335191556884372/
- **Character — Khanmigo (owl AI tutor):** customisable via Gems (Collections;
  one hat + one glasses). During Gem Jam each team's Khanmigo becomes a
  **Racermigo** that visibly races as the team earns Gems — **the mascot _is_
  the progress bar**.
  Source: https://support.khanacademy.org/hc/en-us/articles/45128558403341-How-do-I-use-Gem-Jam-with-my-students-in-Khan-Academy-Reimagined

### 7.5 Layered backgrounds / ambient — HONEST ASSESSMENT: THIN

Khan is **deliberately flat**: paper-white canvas, flat cards, 1px borders, soft
shadows, no gradients, no ambient layers, no scene backgrounds. Warmth comes
from the illustration system, cream encouragement bands, mint-tinted tiles —
colour _fields_, not depth. Its "alive" quality is in micro-moments: mastery
arcs filling, confetti, Racermigo racing, gem-earn reveals. **Verdict for
Candle:** take Khan's mastery visualisation and Mission/queue structure; do
**not** take its backgrounds. For immersion, Headspace and Brilliant are the models.

### 7.6 Why it feels premium

"Mission-driven warmth": one mint, one humanist sans (Lato since 2012), generous
16px/1.5 body, encouraging plain-spoken voice. It never looks like a dashboard
because **there is no dashboard grid** — there is a _tree_ and a _queue_.
**Transferable:** (a) **mastery dots with progress arcs** as skill-progress
language (directly mappable to Candle's per-topic/per-duel mastery); (b)
**Learner Queue / Daily Mission** as home structure; (c) **effort currency vs
mastery kept separate** (validates Candle's XP-vs-Ratings split); (d) **reward =
visible thing on your character** (accessory per 50 gems → mentor/avatar
customisation); (e) **team race where the mascot IS the progress bar**
(Racermigo → mentor climbing the Exchange tower as a league progresses).

---

## 8. Cross-reference synthesis — patterns to STEAL

| Pattern                                              | From                                                            | Candle mapping                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------- |
| One canvas + one accent voltage + one display family | All six                                                         | Ink + gold already; protect the ratio                                       |
| Home = "what's next", not a catalogue                | Brilliant resume; Khan Queue/Missions; Headspace Today          | Learn screen opens on next lesson/duel                                      |
| Progress always visible, ambiently                   | Brilliant thin green bar; Khan mastery dots; Headspace minutes  | Thin progress bar + per-topic mastery dots everywhere                       |
| Effort currency ≠ skill signal                       | Khan; Brilliant (XP vs Leagues)                                 | XP vs Ratings — already correct, keep it                                    |
| Forgiveness > punishment                             | Brilliant Streak Charges (max 2); Matiks Streak Shields (max 2) | Streak freeze/charge, never loss-shaming                                    |
| Leagues of 30, themed level names                    | Brilliant (elements); Duolingo (30/ league)                     | Finance-themed league tiers                                                 |
| Tutor speaks before/after, never during              | Brilliant Koji; Duolingo cast                                   | Already a Candle rule — validated                                           |
| Reward = visible thing on your character             | Khan (50 gems → accessory)                                      | Mentor/avatar customisation unlocks                                         |
| Mascot IS the progress bar                           | Khan Racermigo                                                  | Mentor climbing a tower / market chart as league progresses                 |
| One signature ambient element                        | Headspace breathing sphere; Brilliant animated geometry         | A living Exchange scene (ambient ticker glow / market pulse), low amplitude |
| Celebration frequent, specific, low-amplitude        | Brilliant lesson-complete; Headspace 1.02 overshoot             | Small specific win screens, not confetti spam                               |
| State-led discovery                                  | Headspace ("how are you feeling?")                              | "What do you want to do today?" — learn / duel / trade                      |
| One guided road, not a catalogue                     | Duolingo path; Khan Path view                                   | The Exchange path: zones as units on a winding road                         |
| Node states as colour                                | Duolingo                                                        | Completed gold / current pulsing / locked muted                             |
| 3D-ledge chunky buttons                              | Duolingo                                                        | Gold primary with a hard darker-gold ledge, press = down 4px                |
| Sport framing, live opponent                         | Matiks Arena                                                    | Duel lobby as a live event: vs cards, 3-2-1 countdown, live scores          |
| One visible rating number you protect                | Matiks; Duolingo league                                         | Ratings as the hero number on profile/duels                                 |
| Rationed accent = one verb                           | Spotify                                                         | Gold = Start Duel / primary CTA only                                        |
| Tonal depth, not borders                             | Spotify                                                         | Ink stepped surfaces; no bordered grey boxes                                |
| Imagery is the colour system                         | Spotify; Headspace orbs                                         | Mentor/lesson art supplies colour; chrome stays ink+gold                    |
| Art-derived hero gradient                            | Spotify (232px fade)                                            | Duel/lesson hero gradient from that lesson's art or mentor colour           |
| Persistent "now learning" bar                        | Spotify now-playing bar                                         | Current lesson/duel + progress, never hidden, collapses on mobile           |
| Canvas ambient loop — mood, not story                | Spotify                                                         | Looping ambient background on duel lobby / lesson hero                      |
| Season-end recap spectacle                           | Spotify Wrapped                                                 | Oversized 96px gold numerals, gradient stat slides, shareable               |
| Quiet centre, scenery at the edges                   | Duolingo + Creedo lesson                                        | Map corridor quiet; world-building at edges; parallax only on edges         |
| Characters as scenery, idle life always on           | Duolingo; Headspace                                             | Mentors blink/breathe/react beside the path; current node pulses            |
| Full-bleed scene-change takeovers                    | Duolingo; Spotify Wrapped                                       | Celebrations change the whole background, not just a toast                  |
| Mastery dots with progress arcs                      | Khan                                                            | Per-topic / per-duel mastery on Learn + Profile                             |
| No ads, ever                                         | Matiks                                                          | Premium feel = no interruptions (already Candle's stance)                   |

---

## 9. Patterns to DELIBERATELY AVOID (common/generic — per Nishu's warning)

These are the patterns the research says make a product look like every other
dashboard/template. The round-2 redesign must not slip back into any of them.

1. **The ERP/admin dashboard home** — left sidebar + KPI stat-card grid + data
   tables + chart widgets + "Welcome back" + stats grid. _None_ of the six
   references uses it; fastest way to look generic. If a screen could manage
   inventory, it's wrong. (Duolingo, Matiks, Spotify, Brilliant, Headspace, Khan)
2. **Catalogue-grid home** — wall of identical course cards with stock thumbnails.
   All six lead with _continuation_ (resume / queue / today / path), not browsing.
3. **Multi-accent rainbow UI** — 4–6 saturated colours competing. Each reference
   commits to **one** accent voltage; illustration colours never leak into chrome.
4. **Default system type + default radii** — Inter/system sans at default sizes,
   4–8px radii everywhere = unbranded template. Each reference has a committed
   typeface and deliberate radius system (Duolingo rounded display + ledge
   buttons; Brilliant 9999px pills; Headspace 16/24/32/800; Khan 8px + pills;
   Spotify pill-and-circle).
5. **Gradient-mesh / glassmorphism backgrounds as art-direction substitute** —
   the 2023–25 "premium" cliché. Brilliant uses _animated geometry with a
   story_; Headspace uses _hand-drawn characters_; Khan uses _flat colour
   fields_; Spotify uses _content-derived_ gradients. None uses a generic
   purple-blue mesh.
6. **Emoji-only gamification / confetti spam** — loud badges, flashing streak
   flames on every tap. Brilliant keeps currencies in a quiet top strip;
   Headspace has _no_ XP; Khan's confetti is tied to real mastery. Shouting
   gamification reads as a kids' app, not premium.
7. **Leaderboard as the home screen** — global rank tables front-and-centre.
   Brilliant buries Leagues behind weekly XP; Khan's competition is team-based
   and opt-in; Headspace has none; Duolingo's league is one tab, not home.
8. **Mascot as decoration** — a character slapped on generic UI. In all six the
   character is _functional_: Koji tutors/routes, Khanmigo is the tutor and the
   progress bar, Headspace orbs carry the content's emotion, Duo is the
   emotional layer, Sero is identity + celebration. A mascot with no job is
   clutter.
9. **Modal-heavy flows and menu trees** — Headspace removed the nav bar; Khan cut
   access from 8 taps to 2. Deep menus and pop-up stacks are the ERP tell.
10. **Dark-or-light by default without a reason** — each reference _commits_ to
    one canvas for a reason (Brilliant dark = blackboard/diagram metaphor;
    Headspace cream = storybook; Khan white = paper/workbook; Spotify dark =
    listening at night; Duolingo white = classroom). Candle commits to ink
    (trading floor at night) — don't hedge with a theme toggle as the design.
11. **Copying Duolingo's loudness wholesale** — the most-copied "gamified
    learning" look. Brilliant's verdict is the warning: "premium, structured,
    never cute". For a professional premium finance product, Duolingo-level
    loudness damages trust. Take the game-feel (path, ledge buttons, celebration),
    keep Candle's ink+gold professional identity.
12. **Stock photography / 3D clip-art illustrations** — Headspace's brand rules
    ban both outright. Custom illustration is what makes each reference
    unmistakable.
13. **Muted corporate palette (slate/blue-grey, thin 1px borders, soft blurred
    shadows)** — reads as SaaS, kills game feel. (Duolingo)
14. **Straight vertical checklist / straight list of lessons** — "A straight
    list feels like email" — the curved wave _is_ the recognisable signature.
    (Duolingo)
15. **Harsh red error screens / "Wrong!" + buzzer** — punishes the core loop.
    Gentle banner, "Correct solution:", progress still advances. (Duolingo)
16. **Auto-advancing slides / timers pressuring the user** — breaks flow and
    trust. Manual Continue, user controls pace. (Duolingo)
17. **Grey "No data" empty states** — dead ends. Character + encouraging copy +
    what comes next. (Duolingo)
18. **System-default alerts / modals for celebrations** — feels cheap.
    Full-screen takeover, confetti, character, sound. (Duolingo)
19. **Copying the _surface_ (green + owl + streak) without the system** —
    cloneable in a weekend, no moat. The moat is the character's emotional range
    - the habit loop + the owned type/colour language. (Duolingo)
20. **Generic Duolingo-clone gamification** — cartoon mascot lecturing, XP bars
    everywhere, childish rounded-everything, confetti on every tap. Matiks'
    mascot barely speaks and never tutors; its tone is sporty/adult.
    (Matiks)
21. **Lesson/chapter/module trees as the primary navigation.** Matiks has no
    visible curriculum tree; progression is rating + streak + leagues.
    (Matiks)
22. **Percentage grades and "85% complete" progress bars as the main feedback.**
    Matiks shows a rating number, a flame count, and a win/loss — status, not
    school marks. (Matiks)
23. **Modal/pop-up spam and banner ads for monetisation.** Matiks monetises
    through Pro (insights, reviews, Flex, shield slot) and Pi bundles — purchases
    that _protect or show off status_, not interruptions. (Matiks)
24. **Stock "trophy/coin/star" icon soup with no system behind it.** Matiks' Pi,
    shields, and physical rewards each have exactly one job and one place they
    appear; nothing is decorative-only. (Matiks)
25. **A flat white/light "edtech clean" look.** Matiks commits to dark,
    high-contrast, black-green-purple. (Matiks)
26. **Mid-grey panels (`#2a2a2a`/`#333`) with a blue accent and 1px borders
    everywhere** — the generic "dark dashboard" look. Spotify's borders are tonal
    steps, and its accent is one vivid hue, not default blue. (Spotify)
27. **Pure `#000000` canvas** — crushes imagery saturation; covers/art look
    dead. Use `#121212` (Spotify) / ink `#0B1120` (Candle). (Spotify)
28. **Light mode toggle / light surfaces inside the product** — "Dark-mode-only
    on the consumer surface — no light theme is offered… light backgrounds break
    it." (Spotify)
29. **Square corners on buttons and cards** — "Square corners break the
    identity." Interactive = pill/circle; content = 6–8px. (Spotify)
30. **Default soft shadows** — on near-black, light shadows are invisible;
    Spotify goes to 0.3–0.5 opacity. Default Tailwind/shadcn shadows vanish on
    dark. (Spotify)
31. **Breadcrumbs, H1 page titles, stat-card grids, data tables as the primary
    view** — dashboard chrome. Spotify has no page titles — it has a greeting,
    shelves, and a hero. (Spotify)
32. **Marketing hero sections / stock imagery inside the app** — the app opens
    straight into content; the only "hero" is content-derived. (Spotify)
33. **Long dwell hovers, parallax, decorative animation everywhere** — Spotify
    responds on hover-enter in 100–300ms; motion is functional and fast, with
    one loud moment (Wrapped) per year. (Spotify)
34. **Copying Spotify literally** (green `#1ed760`, SpotifyMix, same layout) —
    take the _system_ (rationed accent, tonal depth, imagery-as-colour, pill
    geometry), not the brand. Candle's gold should be rationed exactly the way
    green is. (Spotify)

---

## 10. What round 2 must do differently (design direction for the rebuild)

1. **Home = the game.** A winding Exchange path through the 6 zones, with the
   learner's avatar, streak flame, XP bar, gems, league position — the game IS
   the home screen. No sidebar + grey card grid + tables as home.
2. **Characters present and alive.** Mira etc. as illustrated-feeling character
   cards with mood, speech bubbles, reactions — geometric marks alone were part
   of what felt corporate. Warm and characterful, non-cartoonish, professional.
   Characters have jobs (host, coach, opponent, celebration) — never decoration.
3. **Duolingo-style delight, Candle identity.** Chunky rounded ledge buttons,
   bold colour blocks, progress path, celebration moments, big readable type,
   generous spacing — while keeping ink + gold professional finance identity.
   Do not turn it into a Duolingo clone; take the game-feel, keep Candle's world.
4. **Alive, not flat.** Rich layered backgrounds, ambient/interactive elements,
   parallax or scene depth, hover/tap responses, animated background frames
   behind the content — per Nishu's added direction. But apply the Duolingo +
   Creedo lesson: **quiet centre corridor, scenery at the edges**; parallax only
   on edge scenery, never under tappable nodes; aliveness at low amplitude
   (Headspace) on calm screens, loud only at celebrations (Spotify Wrapped rule:
   restraint all year earns one loud moment).
5. **Premium, not common.** One canvas (ink), one accent voltage (gold), one
   display family, tonal depth not borders, pill-and-circle tactile geometry,
   weight-contrast typography — and the avoid-list in §9 as a checklist on every
   screen.
6. **All 6 screens rebuilt in the new language** (Home/path, Learn + lesson quiz,
   Duels lobby + playable Speed Quiz, result screen, Simulator, Profile,
   Settings), verified clickable end-to-end on desktop + mobile.

---

## 11. Sources (all URLs used)

**Duolingo:** https://tastekit.dev/gallery/apps/duolingo ·
https://screenrove.com/duolingo/design ·
https://blakecrosley.com/guides/design/duolingo ·
https://github.com/angel225588/vox-langauge-app/blob/HEAD/docs/research/DUOLINGO_UI_PATTERNS.md ·
https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/duolingo-mobile/DESIGN.md ·
https://blog.duolingo.com/new-duolingo-home-screen-design/?lang=en ·
https://blog.duolingo.com/building-character/ ·
https://blog.duolingo.com/streak-milestone-design-animation/ ·
https://www.canny-creative.com/atlas/brand/duolingo/ ·
https://www.danielscrivner.com/the-duolingo-handbook-summary/ ·
https://www.duolingo.com/learn ·
https://www.creedo.faith/blog/making-room-on-the-lesson-map.html ·
https://www.shadcn.io/design/duolingo

**Matiks:** https://matiks.com/ ·
https://play.google.com/store/apps/details?id=com.matiks.app&hl=en_US ·
http://itunes.apple.com/app/id6738620563 ·
https://www.appbrain.com/app/matiks/com.matiks.app ·
https://ishitajhunjhunwala.github.io/assets/matiks-teardown.pdf ·
https://bhaskarranjankarn.medium.com/why-people-are-solving-math-problems-for-fun-at-2-am-41d4bbf4c9d4 ·
https://youngandcalculated.blog/why-so-many-people-fear-math-and-how-matiks-is-making-it-fun-again-calculated-conversations-27-with-mohan-kumar/ ·
https://www.matiksguide.in/tips/matiks-streak-guide/ ·
https://www.matiksguide.in/community/ ·
https://www.facebook.com/reel/3102594389932637/ ·
https://www.instagram.com/reel/Db2YlMJTt89/ ·
https://www.instagram.com/reel/DfVGE-TBzsA/ ·
https://www.instagram.com/reel/Ddjpqu2tZ-f/ ·
https://www.instagram.com/reel/DaPLhPEzEBW/

**Spotify:** https://www.shadcn.io/design/spotify ·
https://www.webdesignhot.com/design.md/spotify/ ·
https://styles.refero.design/style/cc59e195-fed0-4928-96d1-303752786073 ·
https://www.m--k.me/design-systems/spotify.html ·
https://newsroom.spotify.com/2026-04-23/spotify-design-history/ ·
https://artists.spotify.com/en/canvas ·
https://www.figma.com/blog/creating-coherence-how-spotifys-design-system-goes-beyond-platforms/ ·
https://medium.com/designright/three-design-elements-that-made-spotify-wrapped-2024-great-0a8e2b133b72 ·
https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/spotify-mobile/DESIGN.md

**Brilliant:** https://www.webdesignhot.com/design.md/brilliant-org/ ·
https://www.kurslotse.de/en/apps/learning-apps/coding-apps/brilliant/ ·
http://brilliant.org/help/features/ ·
https://designmunk.com/brilliant/ ·
https://understandtutor.com/blog/brilliant-review ·
https://math.kilowatto.com/en/research/mc-14-competitive-products/ ·
https://www.instagram.com/reel/DdFZaKqxd9h/

**Headspace:** https://www.shadcn.io/design/headspace ·
https://www.unfairly.ai/brand-guidelines/headspace/ ·
https://www.floow.design/aso-screens/headspace ·
https://www.duaa.design/headspace ·
https://www.themasterly.com/blog/progression-systems-that-build-daily-habits ·
https://www.uxstalwarts.com/case-study/headspace-inc/ ·
https://github.com/lintendo/axhub-make/blob/HEAD/client/src/themes/headspace-mobile/DESIGN.md

**Khan Academy:** https://www.webdesignhot.com/design.md/khan-academy/ ·
https://blog.khanacademy.org/meet-the-new-khan-academy-classroom-experience/ ·
https://support.khanacademy.org/hc/en-us/articles/46056261189773-What-s-changing-for-students-on-the-reimagined-Khan-Academy ·
https://support.khanacademy.org/hc/en-us/articles/202487710-What-are-energy-points-badges-and-avatars ·
https://support.khanacademy.org/hc/en-us/articles/42456050422157-How-can-my-students-customize-Khanmigo ·
https://support.khanacademy.org/hc/en-us/articles/45128558403341-How-do-I-use-Gem-Jam-with-my-students-in-Khan-Academy-Reimagined ·
https://blog.khanacademy.org/five-ways-khan-academy-is-making-student-practice-more-motivating/ ·
https://www.fastcompany.com/3041180/w_750
