#!/usr/bin/env node
/**
 * Verify every Lottie JSON in apps/web/public/lottie/:
 *  1. Structural checks (required fields, keyframe ordering, colour
 *     ranges, no external assets, loop cleanliness for looping files).
 *  2. Real playback with lottie-web 5.12.2 inside jsdom (SVG renderer):
 *     load, step through every frame, confirm no errors and that SVG
 *     nodes are actually produced at each sampled frame.
 *  3. Render key frames to PNG (via the SVG lottie-web emits + sharp)
 *     into /tmp/lottie-frames/ for visual inspection.
 *
 * Run:  node verify.mjs          (from this directory)
 *         LOTTIE_FRAMES_DIR=/tmp/frames node verify.mjs
 * Requires: npm install in this directory (lottie-web, jsdom, sharp).
 * Note: the animationData passed to lottie-web MUST be parsed inside
 * the jsdom realm (window.JSON.parse). lottie-web checks
 * `x.constructor === Array` while interpolating, and objects parsed
 * in Node's realm fail that check inside jsdom, which makes every
 * 2-D keyframe interpolate to NaN and freeze at its first value.
 * That is a harness quirk, not a file bug — see README.md.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import sharp from "sharp";

const HERE = dirname(fileURLToPath(import.meta.url));
const LOTTIE_DIR = join(HERE, "..", "..", "apps", "web", "public", "lottie");
const FRAMES_DIR = process.env.LOTTIE_FRAMES_DIR || "/tmp/lottie-frames";
const LOTTIE_WEB = join(HERE, "node_modules", "lottie-web", "build", "player", "lottie_svg.js");
const LOOP_FILES = new Set(["mira-idle", "kabir-thinking", "tara-shield", "streak-flame"]);
const ONCE_FILES = new Set(["mira-wave", "mira-celebrate", "xp-countup"]);

mkdirSync(FRAMES_DIR, { recursive: true });

// ------------------------------------------------------- structural checks
function checkStructure(name, data) {
  const problems = [];
  const req = ["v", "fr", "ip", "op", "w", "h", "layers"];
  for (const k of req) if (!(k in data)) problems.push(`missing top-level "${k}"`);
  if (data.v !== "5.7.4") problems.push(`unexpected version ${data.v}`);
  if (data.fr !== 30) problems.push(`fr=${data.fr}, expected 30`);
  if (data.w !== 200 || data.h !== 200) problems.push(`size ${data.w}x${data.h}, expected 200x200`);
  if (data.assets?.length) problems.push(`has ${data.assets.length} external assets (must be 0)`);
  if (data.ip !== 0) problems.push(`ip=${data.ip}, expected 0`);
  if (!Array.isArray(data.layers) || !data.layers.length) problems.push("no layers");

  const walk = (node, path) => {
    if (Array.isArray(node)) return node.forEach((n, i) => walk(n, `${path}[${i}]`));
    if (node && typeof node === "object") {
      if (node.ty === "fl" || node.ty === "st") {
        const c = node.c?.k;
        if (Array.isArray(c)) {
          if (c.length < 3 || c.some((v) => typeof v !== "number" || v < 0 || v > 1))
            problems.push(`${path}: colour out of 0..1 range: ${JSON.stringify(c)}`);
        }
      }
      if (node.a === 1 && Array.isArray(node.k)) {
        let prevT = -1;
        for (const kf of node.k) {
          if (typeof kf.t !== "number" || kf.t < prevT) problems.push(`${path}: keyframe times not increasing (${kf.t} after ${prevT})`);
          if (kf.t !== undefined && kf.s === undefined) problems.push(`${path}: keyframe at t=${kf.t} has no s`);
          prevT = kf.t;
        }
        // loop cleanliness: first and last keyframe values must match
        if (LOOP_FILES.has(name) && node.k.length > 1) {
          const first = JSON.stringify(node.k[0].s);
          const last = JSON.stringify(node.k[node.k.length - 1].s);
          if (first !== last) problems.push(`${path}: loop not clean — first ${first} != last ${last}`);
        }
      }
      for (const [k, v] of Object.entries(node)) walk(v, `${path}.${k}`);
    }
  };
  (data.layers ?? []).forEach((layer, i) => {
    if (layer.ip === undefined || layer.op === undefined || layer.st === undefined)
      problems.push(`layer ${i}: missing ip/op/st`);
    if (layer.op !== data.op) problems.push(`layer ${i}: op=${layer.op} != comp op=${data.op}`);
    // One style per group (lottie-web SVG renderer duplicates geometries
    // into every later style of the same group). Count direct fl/st
    // children of each group and of the layer itself.
    const checkGroup = (items, path) => {
      const styles = items.filter((it) => it.ty === "fl" || it.ty === "st").length;
      if (styles > 1) problems.push(`${path}: ${styles} styles in one group (max 1 — renderer duplicates geometries)`);
      items.forEach((it, j) => {
        if (it.ty === "gr") checkGroup(it.it, `${path}.gr${j}(${it.nm})`);
      });
    };
    checkGroup(layer.shapes, `layer${i}`);
    walk(layer.shapes, `layer${i}.shapes`);
  });
  return problems;
}

// ------------------------------------------------------- jsdom + lottie-web
const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, {
  pretendToBeVisual: true,
  runScripts: "dangerously",
});
const { window } = dom;
window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 16);
window.cancelAnimationFrame = (id) => clearTimeout(id);
// lottie-web probes a canvas 2d context during feature detection; jsdom
// has no canvas implementation, so stub one that absorbs all calls.
window.HTMLCanvasElement.prototype.getContext = function () {
  const ctx = new Proxy(
    {},
    {
      get: (t, p) => {
        if (p === "canvas") return this;
        if (p === "measureText") return () => ({ width: 0 });
        if (typeof p === "string") return () => ({ width: 0, height: 0, data: [] });
        return undefined;
      },
      set: () => true,
    },
  );
  return ctx;
};
window.HTMLCanvasElement.prototype.toDataURL = () => "";
// lottie-web UMD expects a browser global; evaluate it inside the jsdom window.
const lottieSrc = readFileSync(LOTTIE_WEB, "utf8");
window.eval(lottieSrc);
const lottie = window.lottie;
if (!lottie || typeof lottie.loadAnimation !== "function") {
  console.error("FATAL: lottie-web did not initialise in jsdom");
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function playTest(name, data) {
  const problems = [];
  const container = window.document.createElement("div");
  window.document.body.appendChild(container);
  let anim;
  try {
    // Parse the JSON inside the jsdom realm: lottie-web checks
    // `x.constructor === Array` in its interpolator, and arrays built
    // in Node's realm fail that check inside jsdom (2-D keyframes then
    // interpolate to NaN and freeze at their first value). Passing
    // Node-parsed objects is a harness bug, not a file bug — verified
    // 2026-11-13: same file interpolates correctly once parsed here.
    const realmData = window.JSON.parse(JSON.stringify(data));
    anim = lottie.loadAnimation({
      container,
      renderer: "svg",
      loop: LOOP_FILES.has(name),
      autoplay: false,
      animationData: realmData,
    });
  } catch (e) {
    return [`loadAnimation threw: ${e.message}`];
  }
  await sleep(50);
  if (anim.totalFrames !== data.op) problems.push(`totalFrames=${anim.totalFrames}, expected ${data.op}`);
  if (!anim.isLoaded) problems.push("isLoaded false after load");

  // Step through every frame: any render error surfaces here.
  const frames = [];
  try {
    for (let f = 0; f < data.op; f++) {
      anim.goToAndStop(f, true);
      const svg = container.querySelector("svg");
      if (!svg) { problems.push(`no <svg> at frame ${f}`); break; }
      const nodes = svg.querySelectorAll("*").length;
      if (nodes < 5) problems.push(`only ${nodes} SVG nodes at frame ${f}`);
      if (f === 0 || f === Math.floor(data.op / 2) || f === data.op - 1) frames.push({ f, svg: svg.outerHTML, nodes });
    }
  } catch (e) {
    problems.push(`goToAndStop threw: ${e.message}`);
  }

  // Playback advances the frame counter (rAF-driven).
  try {
    anim.goToAndPlay(0, true);
    const before = anim.currentFrame;
    await sleep(350);
    if (anim.currentFrame <= before && !anim.isPaused) problems.push(`play() did not advance frames (${before} -> ${anim.currentFrame})`);
    anim.pause();
  } catch (e) {
    problems.push(`play() threw: ${e.message}`);
  }

  // Render sampled frames to PNG for visual inspection.
  for (const { f, svg } of frames) {
    try {
      const png = await sharp(Buffer.from(svg), { density: 144 })
        .flatten({ background: "#0B1120" }) // as it appears in the app
        .png()
        .toBuffer();
      writeFileSync(join(FRAMES_DIR, `${name}-f${f}.png`), png);
    } catch (e) {
      problems.push(`PNG render failed at frame ${f}: ${e.message}`);
    }
  }
  try { anim.destroy(); } catch { /* ignore */ }
  container.remove();
  return { problems, midNodes: frames[1]?.nodes ?? null };
}

// ------------------------------------------------------------------- main
const results = {};
for (const file of readdirSync(LOTTIE_DIR).sort()) {
  if (!file.endsWith(".json")) continue;
  const name = file.replace(/\.json$/, "");
  const raw = readFileSync(join(LOTTIE_DIR, file), "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    results[name] = { size: Buffer.byteLength(raw), problems: [`invalid JSON: ${e.message}`] };
    continue;
  }
  const problems = checkStructure(name, data);
  const play = await playTest(name, data);
  if (Array.isArray(play)) problems.push(...play);
  else {
    problems.push(...play.problems);
    results[name] = {
      size: Buffer.byteLength(raw),
      frames: data.op,
      fps: data.fr,
      layers: data.layers.length,
      loop: LOOP_FILES.has(name) ? "loop" : "once",
      svgNodesAtMid: play.midNodes,
      problems,
    };
    continue;
  }
  results[name] = { size: Buffer.byteLength(raw), frames: data.op, problems };
}

console.log(JSON.stringify(results, null, 2));
const failed = Object.entries(results).filter(([, r]) => r.problems.length);
console.log(`\n${Object.keys(results).length} files checked, ${failed.length} with problems.`);
if (failed.length) process.exitCode = 1;
