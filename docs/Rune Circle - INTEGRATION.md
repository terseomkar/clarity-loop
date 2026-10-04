# Rune Circle (entry title) — Integration Handoff

A decorative, slowly-rotating golden rune circle superimposed behind the **Clarity Loop**
title on the entry/welcome screen. Purely presentational — no JS state, no backend, no
protocol changes. Port it exactly; do not redesign.

Source of truth: the welcome screen in `Oshi Survey & Retrospective.dc.html` (§4.1 `welcome`).

---

## 1 · Paste manifest — what lands where

| Source (this handoff) | Destination in `clarity-loop/` | Action |
|---|---|---|
| `assets/rune-circle.png` | `frontend/img-rune-circle/rune-circle.png` | **Copy.** This is the finished, keyed, transparent, square master. Use THIS one. |
| `Rune Circle - INTEGRATION.md` (this file) | `docs/oshi/` | Reference only. |

**Already in the repo, do NOT use for the app:**
`frontend/img-rune-circle/rune_circle.png` and `rune_circle_crop.png` are the *raw AI
sources* (opaque black / checkerboard background, off-center, non-square). They are kept
for provenance only. The keyed square master above is what the page loads. Safe to delete
the two raw files once the master is in place.

**Do NOT copy:** `support.js`, `doc-page.js`, `_ds/`, `screenshots/`, or any other `.dc.html`.

**Files Claude Code edits:** the entry-screen markup + `frontend/css/main.css`. No new
files, no backend edits.

---

## 2 · About the asset (why it's pre-processed — don't regenerate)

`rune-circle.png` is **638×638, real alpha transparency**, produced from the black-background
source by:

1. **Luminance keying** — alpha derived from perceived brightness so the black field drops to
   fully transparent while the golden glow keeps a soft, natural falloff (no hard matte edge).
2. **Caption crop** — the "ethereal forest runes" watermark band was removed.
3. **Exact-square recenter** — cropped to a square centered on the ring's true optical center
   (alpha centroid). **This is load-bearing:** the image rotates, and the rotation origin is
   the image center. If the ring is not dead-center in the square, it visibly wobbles/orbits
   as it spins. Do not re-crop, pad, or letterbox — any change reintroduces the wobble.

If the asset is ever regenerated, it MUST stay a square with the ring centroid at the exact
center.

---

## 3 · Where it goes on screen

Behind the entry title block, centered on the **"clarity loop"** wordmark (not on the whole
block — the vertical anchor is the title line, ~38% from the top of the block), sitting under
the eyebrow / title / tagline / Enter button. It is decorative and non-interactive.

Layering:
- Rune image: `position:absolute`, behind the text, `pointer-events:none`, `aria-hidden="true"`.
- Text + button: `position:relative` so they render above the ring and stay clickable.

---

## 4 · Markup + CSS (port verbatim)

The welcome block becomes the positioning context. In the prototype it is:

```html
<div class="entry-welcome">           <!-- position: relative -->
  <img src="/static/img-rune-circle/rune-circle.png" alt="" aria-hidden="true"
       class="rune-circle">
  <div class="entry-title-group">     <!-- position: relative -->
    <div class="entry-eyebrow">with grandmaster oshi</div>
    <div class="entry-title">clarity loop</div>
    <div class="entry-tagline">a moment on the branch, before you play</div>
  </div>
  <button class="entry-enter">enter</button>   <!-- position: relative -->
</div>
```

```css
.entry-welcome { position: relative; display: flex; flex-direction: column;
                 align-items: center; justify-content: center; }

.rune-circle {
  position: absolute;
  top: 38%; left: 50%;
  width: min(609px, 81vw);          /* square asset → height follows automatically */
  transform: translate(-50%, -50%);  /* rotation origin = image center = ring center */
  opacity: 0.92;
  pointer-events: none;
  filter: drop-shadow(0 0 24px rgba(255,180,90,0.25));
  animation: rune-rot 90s linear infinite;
}

/* keep the rotation transform's translate in the keyframe, or it will snap to 0,0 */
@keyframes rune-rot {
  from { transform: translate(-50%,-50%) rotate(0deg); }
  to   { transform: translate(-50%,-50%) rotate(360deg); }
}

.entry-title-group { position: relative; display: flex; flex-direction: column;
                     align-items: center; }
.entry-eyebrow, .entry-title, .entry-tagline, .entry-enter { position: relative; }
```

**Gotcha:** the `translate(-50%,-50%)` centering offset MUST be repeated inside the
`@keyframes` (both `from` and `to`). A keyframe that animates only `rotate(...)` overwrites
the whole `transform`, dropping the centering — the circle jumps to the top-left corner and
orbits. This is the single most likely thing to get wrong.

Adjust `top: 38%` only if the app's title block has a different height distribution than the
prototype; the goal is the ring centered on the title line.

---

## 5 · System prompt for Claude Code

> Add the decorative rune circle behind the **Clarity Loop** title on the entry/welcome
> screen. It is presentational only — no JS, no state, no backend.
>
> Copy `assets/rune-circle.png` to `frontend/img-rune-circle/rune-circle.png` and load THAT
> file (a 638×638 pre-keyed transparent square). Ignore the two raw `rune_circle*.png`
> sources already in that folder — they are opaque/off-center provenance files.
>
> Add the markup + CSS from §4 verbatim: make the welcome block `position:relative`, drop in
> the `<img class="rune-circle" aria-hidden pointer-events:none>` behind the text, and set the
> title/tagline/button to `position:relative` so they stay above it. Center the ring on the
> title line (`top:36%`) at `width:min(609px,81vw)`, `opacity:.92`, with the `rune-rot` 90s
> linear infinite spin.
>
> CRITICAL: repeat `translate(-50%,-50%)` inside BOTH `@keyframes rune-rot` frames alongside
> `rotate(...)` — a rotate-only keyframe wipes the centering and the circle orbits off-center.
> Do not re-crop or pad the PNG; it is an exact square centered on the ring so rotation stays
> wobble-free.
