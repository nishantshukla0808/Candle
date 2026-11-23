#!/usr/bin/env node
/**
 * Candle Lottie generator — authors every Lottie JSON in
 * apps/web/public/lottie/ programmatically so the artwork is precise,
 * reproducible and reviewable. No assets are downloaded or copied:
 * every shape is drawn from scratch in this file.
 *
 * Run:  node tools/lottie/generate.mjs
 * Output: apps/web/public/lottie/*.json
 *
 * Lottie format notes (Bodymovin / lottie-web, spec v5.12):
 * - Top level: v, fr, ip, op, w, h, nm, ddd, assets, layers.
 * - Shape layer: ty 4, ks {o, r, p, a, s}, shapes[], ip, op, st.
 * - A group ("gr") is an array of shape items; its LAST item must be
 *   the transform ("tr"). Items are listed FRONT-TO-BACK in Lottie
 *   JSON (Bodymovin / AE timeline order): layers[0] is the foreground
 *   layer, and the first item of a group paints on top. The player
 *   paints the last item first. This generator's helpers take items in
 *   paint order (back first) and reverse them — see group(),
 *   shapeLayer() and comp(). Verified against lottie-web 5.12.2
 *   (2026-11-13): a layer [red, blue] paints blue-then-red in the DOM.
 * - Colours are normalised [r, g, b, a] in 0..1.
 * - Animated property: {a: 1, k: [{t, s, e, i, o}]} where s = value at
 *   this keyframe, e = value at the next keyframe, i/o = cubic-bezier
 *   easing handles for the segment. The last keyframe carries s only.
 * - Hold keyframe: {t, s, h: 1} (value steps, no interpolation).
 * - Group transform: p = position, a = anchor point, s = scale %,
 *   r = rotation degrees, o = opacity. Rotation pivots around the
 *   anchor when p == a.
 * - Looping files must end where they start: the keyframe at t == op
 *   carries the same value as t == 0, so the wrap is seamless.
 * - ONE STYLE PER GROUP (lottie-web SVG quirk, verified 2026-11-13):
 *   the renderer duplicates every geometry into ALL later styles of
 *   the same group (a 3-fill test gave blue:3, green:2, red:1
 *   subpaths). A group must therefore hold exactly one fill OR one
 *   stroke; split multi-style artwork into subgroups. Group and layer
 *   boundaries stop the duplication. This generator follows the rule
 *   everywhere; verify.mjs checks it structurally.
 * - The player (not the file) decides looping: idles loop, reactions
 *   play once (loop: false). See public/lottie/README.md.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'apps',
  'web',
  'public',
  'lottie'
);

// ---------------------------------------------------------------- colours
// Candle palette (docs/19). Ink + gold is the primary grade. The other
// themes in exploration (emerald/deep-green, teal/charcoal, midnight
// blue/electric sky, plum/warm amber) are the reason every character
// carries a 2.5px ink outline + a faint white halo disc: the artwork
// must read on any of those backgrounds. See README "Theme notes".
// Kabir's sky is deliberately deepened from #5AA9FF to #3E8FE8: the
// documented sky washes out on the midnight-blue + electric-sky theme;
// the deeper value still reads as sky blue on ink and survives there.
const hex = (h) => {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const C = {
  ink: hex('#0B1120'),
  gold: hex('#E9B44C'),
  goldPale: hex('#FBE3A7'), // tint of gold, used for the flame core
  mint: hex('#3ED598'),
  rose: hex('#F26D6D'),
  sky: hex('#3E8FE8'), // deepened from #5AA9FF — see note above
  paper: hex('#F7F3E9'),
  white: [1, 1, 1],
};
const col = (rgb, a = 1) => [...rgb, a];

// ------------------------------------------------------------ keyframes
const easeInOut = (dims) => ({
  o: { x: Array(dims).fill(0.42), y: Array(dims).fill(0) },
  i: { x: Array(dims).fill(0.58), y: Array(dims).fill(1) },
});
const easeOut = (dims) => ({
  o: { x: Array(dims).fill(0), y: Array(dims).fill(0) },
  i: { x: Array(dims).fill(0.58), y: Array(dims).fill(1) },
});
const easeIn = (dims) => ({
  o: { x: Array(dims).fill(0.42), y: Array(dims).fill(0) },
  i: { x: Array(dims).fill(1), y: Array(dims).fill(1) },
});
const dimsOf = (v) => (Array.isArray(v) ? v.length : 1);

/** frames: [[t, value], ...]; ease: 'inOut' | 'out' | 'in' | 'linear' */
function anim(frames, ease = 'inOut') {
  const eases = { inOut: easeInOut, out: easeOut, in: easeIn };
  // lottie-web requires keyframe values as ARRAYS even for 1-D
  // properties (rotation, opacity): scalar s/e is misread (verified
  // 2026-11-13 — a scalar 0->90 rotation rendered as a constant
  // 77.8°, while [0]->[90] animates correctly). Wrap scalars.
  const arr = (v) => (Array.isArray(v) ? v : [v]);
  return {
    a: 1,
    k: frames.map(([t, v], idx) => {
      const kf = { t, s: arr(v) };
      if (idx < frames.length - 1) {
        kf.e = arr(frames[idx + 1][1]);
        if (ease !== 'linear') {
          const d = dimsOf(v);
          Object.assign(kf, eases[ease](d));
        }
      }
      return kf;
    }),
  };
}
const stat = (v) => ({ a: 0, k: v });

// ------------------------------------------------------------ shape items
const MN = {
  el: 'ADBE Vector Shape - Ellipse',
  rc: 'ADBE Vector Shape - Rect',
  sh: 'ADBE Vector Shape - Group',
  sr: 'ADBE Vector Shape - Star',
  fl: 'ADBE Vector Graphic - Fill',
  st: 'ADBE Vector Graphic - Stroke',
  gr: 'ADBE Vector Group',
  tr: 'ADBE Vector Graphic - Transform',
};
const fill = (rgb, opacity = 100, animated = null) => ({
  ty: 'fl',
  c: animated ?? { a: 0, k: col(rgb) },
  o: { a: 0, k: opacity },
  r: 1,
  bm: 0,
  nm: 'Fill',
  mn: MN.fl,
  hd: false,
});
const stroke = (rgb, width, cap = 2, opacity = 100) => ({
  ty: 'st',
  c: { a: 0, k: col(rgb) },
  o: { a: 0, k: opacity },
  w: { a: 0, k: width },
  lc: cap, // 2 = round
  lj: 2,
  ml: 4,
  bm: 0,
  nm: 'Stroke',
  mn: MN.st,
  hd: false,
});
const ellipse = (cx, cy, rx, ry) => ({
  ty: 'el',
  p: { a: 0, k: [cx, cy] },
  s: { a: 0, k: [rx * 2, ry * 2] },
  nm: 'Ellipse',
  mn: MN.el,
  hd: false,
});
const rect = (cx, cy, w, h, r = 0) => ({
  ty: 'rc',
  p: { a: 0, k: [cx, cy] },
  s: { a: 0, k: [w, h] },
  r: { a: 0, k: r },
  nm: 'Rect',
  mn: MN.rc,
  hd: false,
});
/** points: [[x,y],...]; handles: {i: [[x,y],...], o: [[x,y],...]} (optional) */
const path = (points, { closed = false, i = null, o = null } = {}) => ({
  ty: 'sh',
  ks: {
    a: 0,
    k: {
      i: i ?? points.map(() => [0, 0]),
      o: o ?? points.map(() => [0, 0]),
      v: points,
      c: closed,
    },
  },
  nm: 'Path',
  mn: MN.sh,
  hd: false,
});
const star = (cx, cy, outerR, innerR, points = 4, rotation = 0) => ({
  ty: 'sr',
  p: { a: 0, k: [cx, cy] },
  r: { a: 0, k: rotation },
  pt: { a: 0, k: points },
  or: { a: 0, k: outerR },
  os: { a: 0, k: 0 },
  ir: { a: 0, k: innerR },
  is: { a: 0, k: 0 },
  sy: 1,
  nm: 'Star',
  mn: MN.sr,
  hd: false,
});
const prop = (v) => (Array.isArray(v) || typeof v === 'number' ? stat(v) : v);
const tr = ({ p = [0, 0], a = [0, 0], s = [100, 100], r = 0, o = 100 } = {}) => ({
  ty: 'tr',
  p: prop(p),
  a: prop(a),
  s: prop(s),
  r: prop(r),
  o: prop(o),
  sk: { a: 0, k: 0 },
  sa: { a: 0, k: 0 },
  nm: 'Transform',
  mn: MN.tr,
});
const group = (items, name, transform = {}) => {
  // Lottie lists items front-to-back (Bodymovin/AE timeline order) and
  // the player paints the last item first: callers pass items in paint
  // order (back first), we reverse so the JSON follows the convention.
  // BUT a fill/stroke only styles the geometries BEFORE it in the same
  // group, so the reversal must not move a style ahead of its shapes:
  // only subgroup (gr) children change places; leaf geometry/style
  // items keep their original relative order. A group is therefore
  // either all subgroups (a container) or one style with its shapes
  // (a leaf) — never a mix with a style after a subgroup.
  const out = [...items];
  const slots = items.map((it, i) => (it.ty === 'gr' ? i : -1)).filter((i) => i >= 0);
  const subs = slots.map((i) => items[i]).reverse();
  slots.forEach((idx, k) => {
    out[idx] = subs[k];
  });
  // `ix` must be unique per sibling (1-based position in the parent):
  // lottie-web keys cached DOM nodes by it, and duplicate ix values
  // make it apply one group's transform/path to another. The transform
  // stays last in `it` — it must never be reversed away.
  const withIx = out.map((it, i) => ({ ...it, ix: i + 1 }));
  withIx.push({ ...tr(transform), ix: out.length + 1 });
  return {
    ty: 'gr',
    nm: name,
    np: withIx.length,
    cix: 2,
    bm: 0,
    ix: 0,
    mn: MN.gr,
    hd: false,
    it: withIx,
  };
};

// ------------------------------------------------------------ composition
let layerInd = 0;
const shapeLayer = (name, shapes, op) => ({
  ddd: 0,
  ind: ++layerInd,
  ty: 4,
  nm: name,
  sr: 1,
  ks: {
    o: { a: 0, k: 100 },
    r: { a: 0, k: 0 },
    p: { a: 0, k: [0, 0] },
    a: { a: 0, k: [0, 0] },
    s: { a: 0, k: [100, 100, 100] },
  },
  ao: 0,
  // Same front-to-back convention as groups: callers pass shapes in
  // paint order (back first); reverse for the JSON. Each shape gets a
  // unique 1-based ix (see group(): lottie-web keys DOM nodes by it).
  shapes: [...shapes].reverse().map((s, i) => ({ ...s, ix: i + 1 })),
  ip: 0,
  op,
  st: 0,
  bm: 0,
});
const comp = (name, op, layers) => {
  layerInd = 0;
  return {
    v: '5.7.4',
    fr: 30,
    ip: 0,
    op,
    w: 200,
    h: 200,
    nm: name,
    ddd: 0,
    assets: [],
    // Layers are also front-to-back in Lottie JSON (layers[0] is the
    // foreground); callers pass them back-first, so reverse here.
    layers: [...layers].reverse(),
    markers: [],
  };
};

// ------------------------------------------------------------ mentor figure
// Original Candle mentors, drawn flat and geometric: round head + capsule
// body in the mentor's role colour, ink outline, identity mark on the
// chest (Mira compass rose, Kabir bars, Tara shield — same marks as the
// web prototype), ink eyes + smile, rose cheeks. Canvas is 200x200;
// the figure is centred on x = 100. Arms are separate groups pivoted
// at the shoulders so wave / celebrate / thinking can rotate them.
// Chest marks. Each mark is one or more single-style groups: lottie-web's
// SVG renderer duplicates every geometry into ALL later styles of the
// SAME group (verified 2026-11-13 with a 3-fill test), so a group must
// never mix two fills / a fill and a stroke. Group boundaries stop it.
const MARK = {
  mira: () => [group([star(100, 132, 13, 4.5, 4, 0), fill(C.ink)], 'Compass rose')],
  kabir: () => [
    group(
      [rect(86, 143, 7, 10, 2), rect(97, 140, 7, 16, 2), rect(108, 137, 7, 22, 2), fill(C.ink)],
      'Bars'
    ),
  ],
  tara: () => [
    group(
      [
        path(
          [
            [100, 120],
            [114, 125],
            [114, 139],
            [100, 159],
            [86, 139],
            [86, 125],
          ],
          { closed: true }
        ),
        fill(C.ink),
      ],
      'Shield mark'
    ),
    group(
      [
        path(
          [
            [94, 139],
            [98, 143],
            [107, 134],
          ],
          {}
        ),
        stroke(C.paper, 2.5),
      ],
      'Shield check'
    ),
  ],
};

// Straight arm, drawn hanging at rest. One style per subgroup (see the
// renderer note on MARK): ink outline, colour core, hand fill, hand
// outline. The outer group pivots at the shoulder; `trExtra` carries
// an animated rotation for wave / celebrate / thinking.
function arm(side, bodyColor, trExtra = {}) {
  const sx = side === 'left' ? 73 : 127; // shoulder x
  const hx = side === 'left' ? 62 : 138; // hand x
  const line = () =>
    path(
      [
        [sx, 108],
        [hx, 150],
      ],
      {}
    );
  return group(
    [
      group([line(), stroke(C.ink, 13)], 'Arm outline'),
      group([line(), stroke(bodyColor, 9)], 'Arm core'),
      group([ellipse(hx, 152, 6.5, 6.5), fill(bodyColor)], 'Hand'),
      group([ellipse(hx, 152, 6.5, 6.5), stroke(C.ink, 2)], 'Hand outline'),
    ],
    side === 'left' ? 'Arm L' : 'Arm R',
    { p: [sx, 108], a: [sx, 108], ...trExtra }
  );
}

// Eyes live in their own group so a blink is a scale-y squash around
// the eye line. `blinkAt` = [startFrame, endFrame] of the squash.
function eyesGroup(blinkKeyframes) {
  return group([ellipse(88, 63, 3.5, 4.5), ellipse(112, 63, 3.5, 4.5), fill(C.ink)], 'Eyes', {
    p: [100, 63],
    a: [100, 63],
    s: blinkKeyframes,
  });
}

function headGroup(bodyColor, { blink = null, tilt = null, glasses = false } = {}) {
  const items = [
    group([ellipse(100, 50, 29, 20), fill(C.ink)], 'Hair'),
    group([ellipse(100, 64, 27, 27), fill(bodyColor)], 'Head fill'),
    group([ellipse(100, 64, 27, 27), stroke(C.ink, 2.5)], 'Head outline'),
    eyesGroup(blink ?? stat([100, 100])),
    group(
      [
        path(
          [
            [93, 75],
            [107, 75],
          ],
          {
            // Smile arc: control points pull the curve down between the ends.
            // o[i] = out-handle of vertex i, i[i] = in-handle of vertex i.
            i: [
              [0, 0],
              [-4, 5],
            ],
            o: [
              [4, 5],
              [0, 0],
            ],
          }
        ),
        stroke(C.ink, 2.5),
      ],
      'Smile'
    ),
    group([ellipse(79, 73, 4.5, 3), ellipse(121, 73, 4.5, 3), fill(C.rose, 55)], 'Cheeks'),
  ];
  if (glasses) {
    items.push(
      group(
        [
          ellipse(88, 63, 8, 8),
          ellipse(112, 63, 8, 8),
          path(
            [
              [96, 63],
              [104, 63],
            ],
            {}
          ),
          stroke(C.ink, 2),
        ],
        'Glasses'
      )
    );
  }
  return group(items, 'Head', { p: [100, 64], a: [100, 64], r: tilt ?? 0 });
}

function bodyGroup(bodyColor, mark) {
  return group(
    [
      group([rect(100, 133, 66, 74, 30), fill(bodyColor)], 'Body fill'),
      group([rect(100, 133, 66, 74, 30), stroke(C.ink, 2.5)], 'Body outline'),
      ...MARK[mark](),
    ],
    'Body'
  );
}

// Whole mentor: halo disc (theme-proofing) + feet + body + arms + head.
// `charAnim` animates the outer group (bob / jump). Arm/head overrides
// are passed in as ready-made groups via `armL`, `armR`, `head`.
function mentor(bodyColor, mark, { charAnim = null, armL = null, armR = null, head = null } = {}) {
  return group(
    [
      // Faint halo disc — keeps the figure readable on any theme bg.
      group([ellipse(100, 108, 76, 76), fill(C.white, 10)], 'Halo'),
      group([ellipse(84, 170, 11, 5.5), ellipse(116, 170, 11, 5.5), fill(C.ink)], 'Feet'),
      bodyGroup(bodyColor, mark),
      armL ?? arm('left', bodyColor),
      armR ?? arm('right', bodyColor),
      head ?? headGroup(bodyColor),
    ],
    'Mentor',
    charAnim ? { p: charAnim } : {}
  );
}

// A blink that fits a looping file of `frames` frames: squash the eyes
// around `at`, and return to full height at the loop point.
function blinkKF(frames, at) {
  return anim(
    [
      [0, [100, 100]],
      [at, [100, 100]],
      [at + 3, [100, 12]],
      [at + 6, [100, 100]],
      [frames, [100, 100]],
    ],
    'inOut'
  );
}

// ============================================================ animations
// All files: 200x200, 30fps, no external assets, flat vector only.

function miraIdle() {
  const FR = 60; // 2.0 s loop
  const bob = anim(
    [
      [0, [0, 0]],
      [30, [0, -5]],
      [60, [0, 0]],
    ],
    'inOut'
  );
  const m = mentor(C.gold, 'mira', {
    charAnim: bob,
    head: headGroup(C.gold, { blink: blinkKF(FR, 40) }),
  });
  return comp('mira-idle', FR, [shapeLayer('Mira', [m], FR)]);
}

function miraWave() {
  const FR = 60; // 2.0 s, plays once (player may loop it 2x)
  const wave = anim(
    [
      [0, 0],
      [10, -150],
      [14, -136],
      [18, -164],
      [22, -136],
      [26, -164],
      [30, -136],
      [34, -164],
      [38, -150],
      [48, -150],
      [56, 0], // fully down by 56 so the last frames are a clean rest pose
      [60, 0],
    ],
    'inOut'
  );
  const tilt = anim(
    [
      [0, 0],
      [10, -5],
      [48, -5],
      [56, 0],
      [60, 0],
    ],
    'inOut'
  );
  const bob = anim(
    [
      [0, [0, 0]],
      [30, [0, -3]],
      [60, [0, 0]],
    ],
    'inOut'
  );
  const m = mentor(C.gold, 'mira', {
    charAnim: bob,
    armR: arm('right', C.gold, { r: wave }),
    head: headGroup(C.gold, { blink: blinkKF(FR, 30), tilt }),
  });
  return comp('mira-wave', FR, [shapeLayer('Mira', [m], FR)]);
}

function miraCelebrate() {
  const FR = 45; // 1.5 s, plays once
  const jump = anim(
    [
      [0, [0, 0]],
      [10, [0, -2]],
      [18, [0, -14]],
      [26, [0, 0]],
      [32, [0, -4]],
      [38, [0, 0]],
      [45, [0, 0]],
    ],
    'inOut'
  );
  const armUpL = anim(
    [
      [0, 0],
      [12, 150],
      [28, 150],
      [40, 0], // down by 40 so the last frames are a clean rest pose
      [45, 0],
    ],
    'inOut'
  );
  const armUpR = anim(
    [
      [0, 0],
      [12, -150],
      [28, -150],
      [40, 0],
      [45, 0],
    ],
    'inOut'
  );
  const m = mentor(C.gold, 'mira', {
    charAnim: jump,
    armL: arm('left', C.gold, { r: armUpL }),
    armR: arm('right', C.gold, { r: armUpR }),
    head: headGroup(C.gold, { blink: blinkKF(FR, 20) }),
  });
  // Five spark stars pop around the head, staggered, then fade.
  const sparkSpots = [
    [58, 38, C.gold, 10],
    [142, 38, C.mint, 14],
    [50, 82, C.rose, 18],
    [150, 82, C.sky, 22],
    [100, 20, C.gold, 26],
  ];
  const sparks = sparkSpots.map(([x, y, color, t0], i) =>
    group([star(x, y, 12, 4.5, 4, 0), fill(color)], `Spark ${i + 1}`, {
      p: [x, y],
      a: [x, y],
      s: anim(
        [
          [t0, [0, 0]],
          [t0 + 5, [115, 115]],
          [t0 + 9, [90, 90]],
          [45, [90, 90]],
        ],
        'out'
      ),
      o: anim(
        [
          [t0, 0],
          [t0 + 3, 100],
          [36, 100],
          [42, 0], // fully faded by 42 — last frames are a clean rest pose
          [45, 0],
        ],
        'inOut'
      ),
    })
  );
  return comp('mira-celebrate', FR, [
    shapeLayer('Mira', [m], FR),
    shapeLayer('Sparks', sparks, FR),
  ]);
}

function kabirThinking() {
  const FR = 72; // 2.4 s loop
  // Right hand rests at the chin the whole loop; a small tap wobble
  // (±4°) is the "thinking" motion. Head sways slowly side to side.
  const tap = anim(
    [
      [0, 135],
      [12, 131],
      [24, 135],
      [36, 131],
      [48, 135],
      [60, 131],
      [72, 135],
    ],
    'inOut'
  );
  const sway = anim(
    [
      [0, -4],
      [36, 5],
      [72, -4],
    ],
    'inOut'
  );
  const m = mentor(C.sky, 'kabir', {
    armR: arm('right', C.sky, { r: tap }),
    head: headGroup(C.sky, { blink: blinkKF(FR, 50), tilt: sway, glasses: true }),
  });
  // Three thought dots appear one by one above the head, then fade
  // out together just before the loop wraps. Gold, not ink: the dots
  // sit outside the halo disc, where ink would vanish on the ink
  // background. Scale holds at 100 while visible and only shrinks
  // during the final fade (60-72), so the loop wraps cleanly.
  const dots = [
    [126, 26, 3, 8],
    [138, 16, 4.5, 20],
    [150, 8, 6, 32],
  ].map(([x, y, r, t0], i) =>
    group([ellipse(x, y, r, r), fill(C.gold)], `Thought dot ${i + 1}`, {
      p: [x, y],
      a: [x, y],
      s: anim(
        [
          [t0, [0, 0]],
          [t0 + 6, [110, 110]],
          [t0 + 10, [100, 100]],
          [60, [100, 100]],
          [72, [0, 0]], // back to 0 while invisible (opacity 0) — clean loop
        ],
        'out'
      ),
      o: anim(
        [
          [t0, 0],
          [t0 + 4, 100],
          [60, 100],
          [72, 0],
        ],
        'inOut'
      ),
    })
  );
  return comp('kabir-thinking', FR, [
    shapeLayer('Kabir', [m], FR),
    shapeLayer('Thought dots', dots, FR),
  ]);
}

function taraShield() {
  const FR = 72; // 2.4 s loop
  const pulse = anim(
    [
      [0, [100, 100]],
      [18, [108, 108]],
      [36, [100, 100]],
      [54, [108, 108]],
      [72, [100, 100]],
    ],
    'inOut'
  );
  const nod = anim(
    [
      [0, 0],
      [12, 4],
      [24, 0],
      [36, 4],
      [48, 0],
      [60, 4],
      [72, 0],
    ],
    'inOut'
  );
  const bob = anim(
    [
      [0, [0, 0]],
      [36, [0, -3]],
      [72, [0, 0]],
    ],
    'inOut'
  );
  const m = mentor(C.rose, 'tara', {
    charAnim: bob,
    head: headGroup(C.rose, { blink: blinkKF(FR, 30), tilt: nod }),
  });
  // The shield prop: a larger version of Tara's chest mark, held in
  // front of her body. It pulses gently; a soft ring expands and fades
  // around it twice per loop (invisible while shrinking back).
  const shieldPath = () =>
    path(
      [
        [100, 106],
        [124, 114],
        [124, 134],
        [100, 166],
        [76, 134],
        [76, 114],
      ],
      { closed: true }
    );
  const shield = group(
    [
      group([shieldPath(), fill(C.rose)], 'Shield fill'),
      group([shieldPath(), stroke(C.ink, 2.5)], 'Shield outline'),
      group(
        [
          path(
            [
              [90, 136],
              [97, 143],
              [111, 126],
            ],
            {}
          ),
          stroke(C.paper, 3),
        ],
        'Shield check'
      ),
    ],
    'Shield',
    { p: [100, 136], a: [100, 136], s: pulse }
  );
  const ring = group([ellipse(100, 136, 50, 50), stroke(C.gold, 2.5, 2, 100)], 'Pulse ring', {
    p: [100, 136],
    a: [100, 136],
    s: anim(
      [
        [0, [70, 70]],
        [36, [160, 160]],
        [72, [70, 70]],
      ],
      'out'
    ),
    o: anim(
      [
        [0, 0],
        [10, 70],
        [36, 0],
        [72, 0],
      ],
      'inOut'
    ),
  });
  return comp('tara-shield', FR, [
    shapeLayer('Tara', [m], FR),
    shapeLayer('Shield', [shield, ring], FR),
  ]);
}

function streakFlame() {
  const FR = 48; // 1.6 s loop
  const flicker = anim(
    [
      [0, [100, 100]],
      [8, [98, 104]],
      [16, [102, 94]],
      [24, [99, 103]],
      [32, [101, 95]],
      [40, [100, 102]],
      [48, [100, 100]],
    ],
    'inOut'
  );
  const wobble = anim(
    [
      [0, 0],
      [12, -2],
      [24, 1.5],
      [36, -1],
      [48, 0],
    ],
    'inOut'
  );
  const innerFlicker = anim(
    [
      [0, [100, 100]],
      [12, [104, 96]],
      [24, [96, 104]],
      [36, [103, 97]],
      [48, [100, 100]],
    ],
    'inOut'
  );
  const flamePath = [
    [100, 162],
    [62, 112],
    [84, 62],
    [90, 40],
    [112, 76],
    [138, 120],
  ];
  const flameHandles = {
    i: [
      [0, 0],
      [-24, -6],
      [-8, -14],
      [-2, -10],
      [-10, -12],
      [-16, -8],
    ],
    o: [
      [24, 0],
      [14, -26],
      [6, -12],
      [4, -8],
      [12, -10],
      [0, 0],
    ],
  };
  // Outer flame (gold) + inner flame (pale gold), flickering in
  // opposite phase so the flame feels alive without changing shape.
  const flame = group([path(flamePath, { closed: true, ...flameHandles }), fill(C.gold)], 'Flame', {
    p: [100, 110],
    a: [100, 110],
    s: flicker,
    r: wobble,
  });
  // Inner flame gets its own group so it can flicker out of phase.
  const inner = group(
    [
      path(
        [
          [100, 158],
          [77, 126],
          [90, 94],
          [94, 76],
          [110, 104],
          [122, 132],
        ],
        { closed: true }
      ),
      fill(C.goldPale),
    ],
    'Flame core',
    { p: [100, 110], a: [100, 110], s: innerFlicker }
  );
  const sparks = [
    [86, 56, 10],
    [116, 44, 22],
  ].map(([x, y, t0], i) =>
    group([ellipse(x, y, 2.5, 2.5), fill(C.gold)], `Ember ${i + 1}`, {
      p: anim(
        [
          [t0, [x, y]],
          [t0 + 16, [x + 3, y - 12]],
          [48, [x, y]], // back to start while invisible (opacity 0) — clean loop
        ],
        'out'
      ),
      o: anim(
        [
          [t0, 0],
          [t0 + 4, 100],
          [t0 + 16, 0],
          [48, 0],
        ],
        'inOut'
      ),
    })
  );
  return comp('streak-flame', FR, [
    shapeLayer(
      'Flame',
      [
        group([ellipse(100, 168, 20, 5), fill(C.ink, 12)], 'Ground shadow'),
        flame,
        inner,
        ...sparks,
      ],
      FR
    ),
  ]);
}

function xpCountup() {
  const FR = 30; // 1.0 s, plays once
  // Centre star pops in, holds, pops out.
  const centre = group([star(100, 100, 26, 10, 4, 0), fill(C.gold)], 'Centre star', {
    p: [100, 100],
    a: [100, 100],
    s: anim(
      [
        [0, [0, 0]],
        [6, [120, 120]],
        [10, [100, 100]],
        [22, [100, 100]],
        [28, [0, 0]], // fully out by 28 — last frames are clean
      ],
      'out'
    ),
    o: anim(
      [
        [0, 100],
        [22, 100],
        [28, 0],
      ],
      'inOut'
    ),
  });
  // Six small stars burst outwards from the centre and fade.
  const burstColors = [C.gold, C.mint, C.rose, C.sky, C.gold, C.mint];
  const burst = burstColors.map((color, i) => {
    const a = (i * Math.PI) / 3;
    const tx = Math.round(100 + 55 * Math.cos(a));
    const ty = Math.round(100 + 55 * Math.sin(a));
    return group([star(tx, ty, 9, 3.5, 4, 0), fill(color)], `Burst star ${i + 1}`, {
      p: anim(
        [
          [0, [100, 100]],
          [30, [tx, ty]],
        ],
        'out'
      ),
      a: [tx, ty],
      s: anim(
        [
          [0, [0, 0]],
          [8, [100, 100]],
          [30, [40, 40]],
        ],
        'out'
      ),
      o: anim(
        [
          [0, 100],
          [20, 100],
          [28, 0], // fully faded by 28 — last frames are clean
        ],
        'inOut'
      ),
    });
  });
  const ring = group([ellipse(100, 100, 50, 50), stroke(C.gold, 3)], 'Ring', {
    p: [100, 100],
    a: [100, 100],
    s: anim(
      [
        [0, [30, 30]],
        [30, [150, 150]],
      ],
      'out'
    ),
    o: anim(
      [
        [0, 100],
        [27, 0], // fully faded by 27 — last frames are clean
      ],
      'inOut'
    ),
  });
  return comp('xp-countup', FR, [shapeLayer('XP burst', [ring, ...burst, centre], FR)]);
}

// ------------------------------------------------------------------ main
const BUILDERS = {
  'mira-idle': miraIdle,
  'mira-wave': miraWave,
  'mira-celebrate': miraCelebrate,
  'kabir-thinking': kabirThinking,
  'tara-shield': taraShield,
  'streak-flame': streakFlame,
  'xp-countup': xpCountup,
};

mkdirSync(OUT_DIR, { recursive: true });
for (const [name, build] of Object.entries(BUILDERS)) {
  // Compact JSON: the generator script is the readable source; the file
  // is the deliverable, and compact form keeps every file well under
  // the 50 KB budget (pretty-printed, the same files are 2-5x bigger).
  const json = JSON.stringify(build());
  const path = join(OUT_DIR, `${name}.json`);
  writeFileSync(path, json + '\n');
  console.log(`${name}.json  ${Buffer.byteLength(json, 'utf8')} bytes`);
}
console.log(`Wrote ${Object.keys(BUILDERS).length} files to ${OUT_DIR}`);
