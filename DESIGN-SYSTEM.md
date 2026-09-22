# Clowncity Design System

A small, canvas-rendered game has a design system too — it's just expressed in
`ctx.fillStyle` strings and `ctx.font` literals instead of CSS. This document is
both the **reference** for that system and the **audit** that produced it.

Single source of truth: [`js/tokens.js`](js/tokens.js) — a plain global
`Tokens` singleton, loaded **first** in `index.html` so every other module can
read it.

```js
ctx.fillStyle = Tokens.color.ink;                 // opaque hex
ctx.fillStyle = Tokens.rgba(Tokens.color.gold, 0.7);  // translucent [r,g,b] + alpha
ctx.font      = Tokens.font.heading;
```

---

## Tokens

### Color

Stored as hex strings (opaque fills) or `[r,g,b]` triples (use `Tokens.rgba(c, a)`).

| Token | Value | Used for |
|-------|-------|----------|
| `bgDeep` | `#0a0a12` | app background + every screen-gradient base |
| `bgCircus` / `bgSelect` / `bgWin` | `#1a0a20` / `#120a18` / `#14100a` | screen-gradient tails |
| `overlay` | `[0,0,0]` | pause dim, scene transition |
| `panel` | `[12,6,8]` | backing panel behind finale / level-complete text (matches the pause menu) |
| `ink` | `#e8e0d0` | primary headings (warm bone) |
| `dust` | `[200,190,170]` | body copy, HUD, run-dust particles |
| `inkWarm` | `[200,180,150]` | subtitles, level-complete stats |
| `inkDim` | `[150,140,130]` | hints / instruction lines |
| `disabled` | `[100,100,100]` | locked / unavailable menu items |
| `gold` | `[255,215,100]` | **primary accent** — prompts, goal, win text |
| `goldBright` | `#ffd764` | win title fill |
| `goldFlag` | `[255,215,50]` | checkpoint flag + burst |
| `danger` | `[255,80,80]` | death, death-counter |
| `flashRed` | `[255,60,60]` | hurt screen-flash |
| `success` | `[100,255,150]` | "COMPLETE" label |
| `kill` | `[255,120,80]` | enemy-defeat burst |
| `enemy` / `enemyLight` / `enemyDark` | `#cc4444` / `#dd6666` / `#aa3333` | patrol enemy body/middle/legs |
| `eyeWhite` / `eyePupil` | `#fff` / `#111` | enemy googly eyes |
| `playerBody` / `playerEye` | `#e8e8f0` / `#1a1a2e` | Poko rect-fallback |
| `trailGhost` / `trailDot` | `[180,200,255]` / `[200,220,255]` | motion trail + speed lines |
| `white` | `[255,255,255]` | landing/jump dust, platform sparkles, flash |
| `belt` | `[150,210,255]` | treadmill chevrons + belt dust |
| `treadmill` | `['#2a3a4a','#34495e','#46627e']` | treadmill tile `[dark, mid, light]` |

**Theme palettes** (`Level.themes`) are a deliberately separate, per-level token
group — `bg[]`, `tile[]`, `accent`, `dotColor`, `goalColor[]` for circus /
harlequin / puppet. They are already centralized as data and intentionally
*not* folded into `Tokens` (they vary per level; `Tokens` holds the shared UI palette).

### Typography

A `monospace` scale for the game UI, plus the two marquee faces (loaded by
`index.html`) for the moments that should match the splash. Every `ctx.font`
reads from here.

| Token | Value | Used for |
|-------|-------|----------|
| `display` | `58px Ewert` | "CONGRATULATIONS" (shrunk to fit narrow views) |
| `serif` | `bold 20px Cinzel` | win subtitle |
| `title` | `bold 52px` | "CLOWN CITY" |
| `heading` | `bold 28px` | screen titles (SELECT / COMPLETE) |
| `cardNum` | `bold 20px` | level-card number |
| `lock` | `20px` | level-card LOCKED label |
| `hud` | `bold 18px` | in-game level name |
| `lg` | `18px` | start prompt, win body |
| `md` | `16px` | subtitle, win prompt |
| `prompt` | `15px` | level-complete prompt |
| `body` | `14px` | stats, pause options |
| `sm` | `13px` | level-card name, instructions, timer |
| `xs` | `12px` | level number, mute, hints |

### Spacing & Motion

| Group | Token | Value | Used for |
|-------|-------|-------|----------|
| `space` | `hudMargin` / `hudTop` | 16 / 24 | HUD insets |
| `space` | `cardW` / `cardH` / `cardGap` | 180 / 140 / 30 | level-select cards |
| `motion` | `flashDecay` / `shakeDecay` | 6 / 8 | screen-flash & camera-shake fade |
| `motion` | `parallaxX` / `parallaxY` | 3200 / 1000 | background dot tiling |
| `motion` | `stripeW` / `diamondSize` / `grain` | 120 / 80 / 40 | circus / harlequin / puppet bg effects |

---

## Components

| Component | Where | Key tokens |
|-----------|-------|-----------|
| HUD (name, timer, deaths, gems) | `game.js drawHUD` | `font.hud/sm/xs`, `dust`, `danger`, theme `goalColor` |
| Title screen | `game.js drawTitle` | `bgDeep/bgCircus`, `ink`, `font.title`, `gold` prompt |
| Level select | `game.js drawLevelSelect` | `font.heading/cardNum/sm`, `disabled`, `success`, `gold` border, `space.card*` |
| Pause / Complete / Win | `game.js` | `overlay`, `ink`, `gold`, `inkWarm`, `dust` |
| Goal / checkpoint / gem | `level.js draw` | theme `goalColor`, `goldFlag` |
| Treadmill | `level.js` + `player.js` | `treadmill[]`, `belt` |
| Enemy (patrol) | `entities.js` | `enemy*`, `eyeWhite/eyePupil`; defeat → `kill`, `white` |
| Player (Poko) | `player.js` | `playerBody/playerEye`, `trail*`, `dust`, `danger` |

---

## Audit

### Summary

**Surfaces reviewed:** 7 JS modules · **Hardcoded values found (pre-refactor):** ~90
(colors, fonts, magic numbers) · **Token-coverage score: 38 → 86 / 100.**

The visual language was sound but had **no single source of truth** — colors,
font sizes, and timing constants were inlined at ~90 call sites, several of them
near-duplicates with inconsistent formatting.

### Naming / consistency issues found

| Issue | Where it lived | Resolution |
|-------|----------------|------------|
| **4–5 near-identical golds** (`rgba(255,215,100)`, `#ffd764`, `rgba(255,215,0)`, `rgba(255,215,50)`, goalColor `[255,215,100]`) | game.js, level.js | `gold` + `goldBright` + `goldFlag` (+ theme `goalColor`) |
| **Parchment beige duplicated 8×** with mixed spacing (`200, 190, 170` vs `200,190,170`) | game.js, player.js | `dust` |
| **Three unnamed text greys** | game.js | `inkWarm` / `inkDim` / `disabled` |
| **Whites scattered** (`255,255,255` @ 6 alphas, `#fff`, near-white `#e8e8f0`/`#e8e0d0`) | all draw code | `white` + `ink` + `playerBody` |
| **Reds conflated** (death vs flash vs enemy) | player/engine/entities | `danger` / `flashRed` / `enemy*` |
| **11 font sizes inlined 30+×**; a 20px-bold vs 20px-non-bold near-dup | game.js | `font.*` scale (see below) |
| **Unnamed magic numbers** (flashDecay, shakeDecay, parallax 3200/1000, stripeW/diamond/grain) | engine/camera/level | `motion.*` |

### Token coverage

| Category | Tokens defined | Hardcoded before | Status |
|----------|---------------:|-----------------:|--------|
| Colors (UI/player/enemy/world) | 24 | ~55 | ✅ routed through `Tokens` |
| Typography | 11 | ~30 | ✅ all but 1 (see below) |
| Motion constants | 7 | 7 | ✅ |
| Spacing | 5 | ~6 | ⚠️ partial (HUD pixel offsets still inline) |
| Theme palettes | — | — | ✅ already centralized in `Level.themes` |

### Priority actions (remaining)

1. **`'20px monospace'` LOCKED label** (`game.js` level-select) — the one font
   left inline; it's a non-bold 20px that near-duplicates `cardNum` (bold 20px).
   Either add a `font.lock` token or make it `cardNum` for consistency. *Flagged, not changed* (would alter the visual).
2. **Level-select card surfaces** (`rgba(40,40,50,.6)` / `rgba(60,50,80,.9)` /
   `rgba(30,28,40,.8)` / locked bar `rgba(60,60,60,.5)`) remain component-local —
   promote to `color.card*` tokens if a second surface ever needs them.
3. **True one-offs left inline (intentional):** confetti tint `rgba(200,150,50,.1)`,
   skull `rgba(10,10,20,.9)`, and the procedural win-screen `hsla()` rainbow. These
   are single-use and don't benefit from a token.
4. **HUD pixel offsets** (skull at 16/12, gem margins) still inline — low value to tokenize.

### Migration log (per file)

| File | Change |
|------|--------|
| `js/tokens.js` | **new** — the token module |
| `index.html` | load `tokens.js` first |
| `js/engine.js` | `flashDecay` + flash fills → `Tokens` |
| `js/camera.js` | `shakeDecay` → `Tokens` |
| `js/entities.js` | enemy colors, eyes, kill burst, platform sparkles → `Tokens` |
| `js/player.js` | death/dust/belt/white/trail particles + body/eye → `Tokens` |
| `js/level.js` | treadmill color (dedup), belt chevrons, parallax/stripe/diamond → `Tokens` |
| `js/game.js` | all fonts + UI palette (ink/gold/dust/inkWarm/inkDim/disabled/danger/success/overlay) → `Tokens` |

*Verified post-refactor: every screen (title, select, HUD, complete, win, pause)
renders with zero exceptions and gameplay is unchanged.*
