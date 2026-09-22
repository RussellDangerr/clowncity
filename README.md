# Clown City

Poko the Clown on a unicycle — a momentum-based **auto-runner**. Poko is always
rolling; you only steer (swipe) and jump (tap). Reverse into monsters to whack
them with the unicycle wheel, or stomp them from above, across a lean
platforming track.

Play it live at [clowncity.russelldangerr.com](https://clowncity.russelldangerr.com).

## Status

v0.5.0 — three levels (The Big Top, The Catwalk, The Big Drop) with rideable
slopes, wall-jump climbs, and a big-top finale. Plays on phones held upright
(on-screen controls) or sideways (swipe and tap), and on desktop.

## Play

Open `index.html` in a browser. No build step required.

## Controls

| Action | Phone, upright | Phone, sideways | Keyboard |
|--------|----------------|-----------------|----------|
| Steer / reverse | ◀ ▶ buttons | Swipe left / right | ← → or A / D |
| Jump | JUMP button | Tap | Space / ↑ / W |
| Spray confetti | Press the arrow you're heading | Swipe the way you're heading | Press the arrow you're heading |
| Pause (restart, levels, sound) | ❚❚ button | ❚❚ corner button | Esc / P |

Reversing is a **weighty** turnaround: Poko decelerates, pauses, then accelerates
the other way. The braking lunge — the wheel kicking out in the *old* direction —
is an attack, and pressing the way you're already heading sprays confetti that
kills whatever it lands on (it costs speed). You can also **stomp** enemies from
above. A pit fall, or touching an enemy from the side, is fatal.

## Features

- Bidirectional auto-runner with weighty unicycle momentum and a start-of-level speed ramp
- Phone-first controls: an on-screen deck when held upright, swipe / tap when sideways,
  full keyboard parity, and a tappable pause menu
- Brake-lunge, confetti-spray and stomp combat
- Treadmill surfaces that cap speed at 0.5 and bleed momentum
- Rideable 45° slopes — bomb downhill to bank "overspeed" that powers a bigger jump
- Wall-slide / wall-jump shafts and an elevated catwalk traverse
- Moving + one-way platforms, gaps, and patrol monsters
- Coyote time + input buffering, squash & stretch, particles, screen shake/flash
- Centralized design tokens in [`js/tokens.js`](js/tokens.js) — see [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md)

## Project layout

Vanilla JS, no build step. Singleton-object modules loaded via `<script>` tags in
`index.html` (order matters; `tokens.js` first, `game.js` last). Fixed-timestep
loop at 120 Hz. See `CLAUDE.md` for architecture notes.
