# Candle Lottie animations

Original, from-scratch Lottie animations for Candle's mentors. Every shape
is drawn by the generator in `tools/lottie/generate.mjs` — nothing here was
downloaded, copied, or traced from LottieFiles or anywhere else. All
artwork is our own mentor designs (Mira, Kabir, Tara), in Candle's flat
ink + gold palette. Matiks' mascot is **Sero**, not "Siro" — don't repeat
that error in any new artwork or copy.

All files: 200×200, 30 fps, shape layers only, **zero external assets**
(`assets: []`), no text layers, no fonts. The player renders them with
lottie-web's SVG renderer.

## Files

| File                  | What it does                                                                             | Length       | Playback                  | Size    |
| --------------------- | ---------------------------------------------------------------------------------------- | ------------ | ------------------------- | ------- |
| `mira-idle.json`      | Mira bobs gently and blinks; seamless loop                                               | 60 f / 2.0 s | loop                      | 15.7 KB |
| `mira-wave.json`      | Mira raises her right arm and waves, head tilted                                         | 60 f / 2.0 s | once (player may loop 2×) | 16.9 KB |
| `mira-celebrate.json` | Both arms up, a small jump, 5 spark stars pop                                            | 45 f / 1.5 s | once                      | 23.6 KB |
| `kabir-thinking.json` | Kabir's hand rests at his chin, small tap wobble, head sways, 3 gold thought dots appear | 72 f / 2.4 s | loop                      | 21.3 KB |
| `tara-shield.json`    | Tara's shield pulses, she nods, a gold ring expands and fades                            | 72 f / 2.4 s | loop                      | 21.3 KB |
| `streak-flame.json`   | Flame flickers (outer + inner flame out of phase) with rising embers                     | 48 f / 1.6 s | loop                      | 6.0 KB  |
| `xp-countup.json`     | Centre star pops, 6 stars burst outwards, ring expands — XP gain burst                   | 30 f / 1.0 s | once                      | 9.8 KB  |

Size budget: **< 50 KB per file** (compact JSON; the generator is the
readable source, the JSON is the deliverable). All seven are currently
6–24 KB.

## How to play them

```js
import lottie from 'lottie-web';

const anim = lottie.loadAnimation({
  container, // element the SVG goes into
  renderer: 'svg', // SVG renderer (not canvas/html)
  loop: true, // idles only — see table; reactions use false
  autoplay: true,
  path: '/lottie/mira-idle.json',
});
```

Looping is a **player setting, not a file setting**: the JSON only defines
`ip`/`op`. Idles (`mira-idle`, `kabir-thinking`, `tara-shield`,
`streak-flame`) loop; reactions (`mira-wave`, `mira-celebrate`,
`xp-countup`) play once (`loop: false`). `mira-wave` may be looped 2× by
the caller if a longer greeting is wanted. One-shot files end in a clean
rest pose (arms down, sparks faded) so freezing on the last frame is safe.

## Mood-tag → file mapping

Doc 08 §2: a host reacts with a short line + a **mood tag**, and the tag
maps to a Lottie file with no duel-logic change. The mapping:

| Host       | Mood                             | File                  |
| ---------- | -------------------------------- | --------------------- |
| Mira       | `calm`, `idle`, default          | `mira-idle.json`      |
| Mira       | `happy`, `proud`, win            | `mira-celebrate.json` |
| Mira       | `encouraging`, greeting, `hello` | `mira-wave.json`      |
| Mira       | `cautious`                       | `mira-idle.json`      |
| Kabir      | `thinking`, `calm`, default      | `kabir-thinking.json` |
| Tara       | `calm`, `reassuring`, default    | `tara-shield.json`    |
| — (system) | streak HUD                       | `streak-flame.json`   |
| — (system) | XP gain                          | `xp-countup.json`     |

Dev, Anaya and Rey have no files yet — same pipeline, new mentor in the
generator, when their moments are designed.

## Reduced motion (must-follow rule)

Respect `prefers-reduced-motion`: **never autoplay** when it is on.
Instead show a static frame — every file supports it, because a Lottie
animation is just frames:

```js
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const anim = lottie.loadAnimation({
  container,
  renderer: 'svg',
  loop: false,
  autoplay: false,
  path,
});
if (reduceMotion) {
  anim.goToAndStop(0, true); // static first frame, no motion
} else {
  anim.play();
}
```

For looping idles under reduced motion, `goToAndStop(0, true)` shows
Mira/Kabir/Tara at rest. For one-shot reactions, show the static frame
and rely on the accompanying text line instead of the motion.

## Authoring a new animation

Do **not** hand-write Lottie JSON. Edit the generator and regenerate:

```bash
cd tools/lottie
npm install          # once: lottie-web, jsdom, sharp (dev-only, gitignored)
node generate.mjs    # writes apps/web/public/lottie/*.json
node verify.mjs      # structural checks + real lottie-web playback + PNG frames
```

- Generator: `tools/lottie/generate.mjs` (Node, no dependencies).
  Helpers build shapes (`ellipse`, `rect`, `path`, `star`), fills,
  strokes, groups and keyframes. Add a mentor with `mentor(color,
mark, {...})`, add a file with a builder function + an entry in
  `BUILDERS`.
- Verifier: `tools/lottie/verify.mjs`. Checks required fields, frame
  rate, size, colour ranges, zero external assets, keyframe ordering,
  loop cleanliness, and one-style-per-group (below); then loads every
  file in lottie-web 5.12.2 (SVG renderer, inside jsdom), steps through
  **every frame**, plays it, and renders first/mid/last frames to PNG
  in `$LOTTIE_FRAMES_DIR` (default `/tmp/lottie-frames`) for visual
  inspection. Exit code is non-zero if any file has a problem.
- Naming: `<mentor>-<moment>.json` for characters
  (`mira-wave.json`), `<thing>-<moment>.json` for HUD elements
  (`streak-flame.json`). Lowercase, hyphens, no version numbers in the
  filename — the generator is versioned, the file is not.

## Lottie format notes (gotchas found building these)

These are lottie-web 5.12.2 behaviours, verified 2026-11-13 with minimal
reproductions. Future authors must follow them or the render breaks
silently (lottie-web fails without errors).

1. **One style per group.** The SVG renderer duplicates every geometry
   into _all later styles of the same group_ (a 3-fill test gave
   blue:3, green:2, red:1 subpaths). A group must hold exactly one fill
   OR one stroke; split multi-style artwork into subgroups. Group and
   layer boundaries stop the duplication. This is why the halo disc
   once painted as a giant ink circle over Mira — it shared a group
   with the feet. `verify.mjs` checks this structurally.
2. **Front-to-back order.** Lottie lists items front-to-back (Bodymovin
   / AE timeline order): `layers[0]` is the foreground layer, the first
   item of a group paints on top; the player paints the last item
   first. The generator's helpers take items in paint order (back
   first) and reverse them — see `group()`, `shapeLayer()`, `comp()`.
   A fill only styles the geometries _before_ it in the same group, so
   the reversal never moves a style ahead of its shapes.
3. **Keyframe values must be arrays, even for 1-D properties.**
   Rotation/opacity keyframes need `s: [0]`, not `s: 0` — a scalar
   rotation rendered as a constant 77.8° instead of animating.
4. **Unique `ix` per sibling** (1-based position in the parent).
   Duplicate `ix` values make the renderer apply one group's
   transform to another. The generator assigns them.
5. **Verify in the right realm.** `verify.mjs` parses the JSON with
   `window.JSON.parse` inside jsdom. lottie-web checks
   `x.constructor === Array` while interpolating; objects parsed in
   Node's realm fail that check inside jsdom, which makes every 2-D
   keyframe interpolate to `NaN` and freeze at its first value (1-D
   values survive only because single-element arrays coerce to
   numbers). In a real browser this never happens — the JSON is parsed
   in the page's realm — but the verifier must do the same.

## Theme notes (colour identities under exploration)

Primary grade is gold + ink. Four to five alternative themes are being
explored (emerald + deep green, teal + charcoal, midnight blue +
electric sky, plum + warm amber, plus one more) with a theme switcher
in the prototype. Character colours were chosen to survive all of them:

- Every mentor carries a **2.5 px ink outline** on head/body and a
  **faint white halo disc** (`white`, 10% opacity) behind the figure,
  so the character reads on any background, light or dark.
- **Mira gold `#E9B44C`** — the brand anchor, kept as-is. Weakest on
  the plum + warm amber theme (gold on amber is low-contrast); the ink
  outline + halo disc are the mitigation. Do not lighten the gold.
- **Kabir sky — deepened to `#3E8FE8`** (from the documented `#5AA9FF`).
  The documented sky washed out on the midnight-blue + electric-sky
  theme; the deeper value still reads as sky blue on ink and survives
  there. Record this as a deliberate deviation from docs/19.
- **Tara rose `#F26D6D`** — kept as-is. Weakest on the plum theme
  (rose on plum is close in hue, but rose is much brighter, and the
  ink outline separates it). Fine on emerald/deep-green and
  teal/charcoal.
- **Flame gold `#E9B44C` + pale-gold core `#FBE3A7`** — fine on every
  theme; on warm amber it leans on the ink ground shadow.
- **Future warning — Anaya teal `#7EE0D2`:** a teal character on the
  teal + charcoal theme will go muddy the same way Kabir's sky did.
  When Anaya's files are built, deepen her teal the same way (or give
  her a darker teal body with a mint accent), and record it here.

## Verification (2026-11-13)

- Tooling: Node 24.22.1, lottie-web 5.12.2, jsdom 25, sharp (all in
  `tools/lottie/node_modules`, installed via `npm install`).
- `node verify.mjs`: **7 files, 0 problems** — every file loads, plays,
  steps through every frame without errors, produces SVG nodes at
  every sampled frame, and loop files have clean first↔last keyframes.
- Visual check: first/mid/last frames rendered to PNG on the ink
  background and inspected — Mira idle/wave/celebrate, Kabir thinking
  (hand at chin, gold thought dots), Tara shield + pulse ring, flame,
  XP burst all render as designed.
- Three real bugs were caught by this verification (not by eyeballing
  the JSON) and fixed in the generator: the style-duplication rule
  (§1 above), the front-to-back ordering (§2), and scalar 1-D
  keyframes (§3). A fourth — the jsdom realm issue (§5) — was a
  harness bug, not a file bug.
- Known cosmetic notes (not blockers): the flame is angular/flat by
  design — a rounder, more classic flame silhouette is a possible
  polish pass; a stray ~8 px speck appears in librsvg's rasterisation
  of the flame frame only (no path in the file produces it) and does
  not appear in the player's SVG.
- Not done: wiring into the prototype (another agent), Dev/Anaya/Rey
  files, `lottie-react`/`@lottiefiles` wrapper choice for `apps/web`
  (left to the wiring agent — the files work with plain `lottie-web`).
