// ─── Design tokens: the single source of truth for Clowncity's visual language ───
// Plain global singleton (matches the no-module, script-tag architecture).
// Loaded FIRST in index.html so every other module can read Tokens.*.
//
// Colours are stored as either:
//   • a hex string  → opaque fills (ctx.fillStyle = Tokens.color.ink)
//   • an [r,g,b]    → translucent fills via Tokens.rgba(triple, alpha)
const Tokens = {
  color: {
    // ── Surfaces / backgrounds ──
    bgDeep:   '#0a0a12',   // app background + title/select/win gradient base
    bgCircus: '#1a0a20',   // title gradient tail
    bgSelect: '#120a18',   // level-select gradient tail
    bgWin:    '#14100a',   // win-screen gradient tail
    overlay:  [0, 0, 0],   // pause dim + scene transition
    panel:    [12, 6, 8],  // backing panel behind overlay text (the pause menu's oxblood-black)

    // ── Text / ink ──
    ink:      '#e8e0d0',        // primary headings (warm bone)
    dust:     [200, 190, 170],  // body copy, HUD, run-dust particles (parchment)
    inkWarm:  [200, 180, 150],  // subtitles, level-complete stats
    inkDim:   [150, 140, 130],  // hints / instruction lines
    disabled: [100, 100, 100],  // locked / unavailable menu items

    // ── Brand / accent ──
    gold:       [255, 215, 100], // primary accent: prompts, goal, win text
    goldBright: '#ffd764',       // win title fill
    goldShade:  '#b07a1e',       // marquee gold extrusion (upper step)
    goldDeep:   '#6e4a12',       // marquee gold extrusion (lower step)
    goldFlag:   [255, 215, 50],  // checkpoint flag + checkpoint burst
    charged:    [255, 240, 150], // overspeed "charged" tell (speedometer + launch spray)

    // ── Feedback ──
    danger:   [255, 80, 80],    // death, death-counter
    flashRed: [255, 60, 60],    // hurt screen-flash
    success:  [100, 255, 150],  // "COMPLETE" label
    kill:     [255, 120, 80],   // enemy-defeat burst

    // ── Entities ──
    enemy:      '#cc4444',
    enemyLight: '#dd6666',
    enemyDark:  '#aa3333',
    eyeWhite:   '#fff',
    eyePupil:   '#111',

    // ── Player ──
    playerBody: '#e8e8f0',
    playerEye:  '#1a1a2e',
    trailGhost: [180, 200, 255],
    trailDot:   [200, 220, 255],
    wheel:      '#2a2230',      // unicycle tyre
    frame:      '#c0a050',      // brass frame / rim / spokes (echoes the gold family)
    clownNose:  '#e23b30',      // clown-nose accent (clear carnival red)
    partyHat:   '#3b82d6',      // carnival party hat (blue)
    partyHatDot:'#ffe066',      // party-hat dots + pom-pom (warm gold)
    carnival:   ['#e23b30', '#ffd764', '#3b82d6', '#4cc77a', '#e056b0'], // attack-spray hues (multicolour sand)

    // ── World / materials ──
    white:     [255, 255, 255],
    belt:      [150, 210, 255],                 // treadmill chevrons + belt dust
    treadmill: ['#2a3a4a', '#34495e', '#46627e'], // treadmill tile [dark, mid, light]
    tentRed:   '#b5202a',  // circus tent stripe (red)
    tentCream: '#f3e2b8',  // circus tent stripe (cream)
    tentMouth: '#140a16',  // dark tent entrance
  },

  // ── Typography ── monospace scale for the game UI, plus the marquee faces ──
  font: {
    family:  'monospace',
    title:   'bold 52px monospace',
    heading: 'bold 28px monospace',
    cardNum: 'bold 20px monospace',
    hud:     'bold 18px monospace',
    lg:      '18px monospace',
    md:      '16px monospace',
    prompt:  '15px monospace',
    body:    '14px monospace',
    sm:      '13px monospace',
    xs:      '12px monospace',
    lock:    '20px monospace',          // level-select LOCKED label
    display: '58px Ewert, monospace',   // marquee display face (win title); loaded by index.html
    serif:   'bold 20px Cinzel, serif', // marquee serif (win subtitle)
  },

  // ── Spacing / layout (px on the fixed 960×540 canvas) ──
  space: {
    hudMargin: 16,   // HUD inset from screen edges
    hudTop:    24,   // HUD text baseline from top
    cardW:    180,   // level-select card
    cardH:    140,
    cardGap:   30,
  },

  // ── Motion / feel ──
  motion: {
    flashDecay:  6,    // screen-flash fade rate
    shakeDecay:  8,    // camera-shake fade rate
    parallaxX:   3200, // background dot tiling width
    parallaxY:   1000, // background dot tiling height
    stripeW:     120,  // circus tent-stripe width
    diamondSize: 80,   // harlequin diamond size
    grain:       40,   // puppet wood-grain spacing
  },

  // [r,g,b] + alpha → 'rgba(r, g, b, a)'
  rgba(c, a) { return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`; },
};
