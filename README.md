# Descent Protocol

A **DOOM-style raycaster FPS that runs entirely in the browser** — no build step, no
dependencies, no binary assets — plus a built-in **autoplay agent** that pathfinds,
fights, loots and clears the whole campaign on its own.

Everything you see is generated in code: the engine, the maps, the textures, the
creature sprites and the sound. This is an original game inspired by the 1993
raycaster era; it contains no assets, data or code from any commercial title.

```bash
git clone https://github.com/vasu-devs/DOOM_Opus5.5.git
cd DOOM_Opus5.5
npm start            # → http://localhost:8123
```

Then press **P** and watch the agent play it for you.

---

## What's in it

| | |
|---|---|
| **Engine** | DDA raycaster, textured walls, perspective floor **and ceiling** casting, flickering torchlight, z-buffered alpha sprites, depth fog, sliding doors |
| **Resolution** | Full-bleed viewport at the window's own aspect, with an adaptive quality ladder (300p-1000p) that walks up or down to hold your frame rate |
| **Combat** | 4 weapons (hitscan pellets + a splash-damage arc bolt), 4 enemy types with telegraphed attacks, crossfire between enemies, dodgeable projectiles, armour model |
| **Feel** | Acceleration-based movement, view bob, weapon fire animations with brass ejection, muzzle flashes, blood and spark particles, screen shake, damage-direction indicator |
| **Presentation** | Classic bottom status bar with a reactive diver portrait, fog-of-war minimap, three difficulty tiers, settings panel (sensitivity, resolution, volumes) persisted to localStorage |
| **Audio** | Fully synthesised: per-weapon reports, positional enemy sounds, footsteps, doors, plus a procedural score that gets busier when you are in trouble |
| **Autoplay** | A* navigation, threat scoring, weapon selection, projectile dodging, stuck recovery - driving the same input struct a human does |
| **Quality** | 69 unit/integration tests including a headless run where the agent completes the campaign; zero runtime dependencies |

**Controls** — `WASD` move · mouse aim · click/`Space` fire · `1`–`4` weapons ·
`Shift` run · `E` doors · `Tab` map · `P` autoplay · `F` fullscreen · `O` settings ·
`Esc` pause · `R` restart. Touch controls appear automatically on coarse-pointer
devices.

**Mouse feel** — the default is a calm ~0.0014 rad/px (a 400px flick turns about
32°). The Settings panel (`O`) scales that from 0.25x to 3x and remembers it.

---

## The autoplay agent

The agent is a **player, not a cheat**. It cannot see through walls, it does not
snap-aim, and it moves by filling in the exact same `Intent` object the keyboard
produces — so anything it does, you could do.

```
every AGENT.THINK_INTERVAL_MS (90ms):
  sense   → enemies with real line of sight, reachable items, distance to exit
  score   → survival > combat > resupply > progress
  plan    → A* route to the chosen goal
  equip   → best weapon it can actually feed at that range
every frame:
  steer toward the plan, strafe while fighting, sidestep incoming projectiles,
  open doors ahead, and shake out of any stall
```

Its priority ladder, highest first:

1. **HEAL** — below 45 HP it will break off and route to a medkit.
2. **FIGHT** — engages what can see it, holding ~2.6 tiles with the shotgun or
   ~5.5 with the chaingun, strafing the whole time.
3. **LOOT** — detours up to 14 tiles of path for something it actually needs
   (it will not pick up a medkit at full health).
4. **ADVANCE** — routes to the exit.
5. **UNSTICK** — escalating recovery when its position stops changing.

The HUD panel shows the live mode, the current goal and its decision counters,
and the minimap draws its planned path in green.

### Measured performance

`npm run bench:agent` plays full campaigns headlessly across different seeds:

```
runs           : 8
campaigns won  : 8 (100%)
avg sim time   : 74.3s of in-game time per winning run
avg accuracy   : 93.4%
avg kills      : 19.5
```

---

## Architecture

Layered, DOM-free below the shell, so the whole simulation is testable in Node:

```
src/
  core/        constants (all tuning), math, seeded RNG, structured logger
  world/       grid + collision + line of sight, doors, level parser, maps, A*
  render/      procedural textures, raycaster, software renderer, viewmodel,
               minimap, HUD controller
  game/        player, enemies, combat/projectiles, pickups, game orchestrator
  agent/       the autoplay agent
  audio/       WebAudio synthesis (no audio files)
  input.js     keyboard/mouse/touch → Intent
  main.js      the only file that touches the DOM directly
```

Two rules hold the design together:

- **Nothing below `main.js` imports the DOM.** `Game` takes its texture bank,
  audio and logger by injection, which is why the agent tests can run a full
  campaign with a stub texture bank and no canvas.
- **Human and agent are indistinguishable downstream.** Both produce an
  `Intent`; `Game.update()` cannot tell them apart.

### Rendering notes

Walls are cast per column with a DDA and drawn into an `ImageData` buffer sized
to the window's aspect at the current quality rung, then upscaled with smoothing
off. The floor/ceiling pass exploits the fact that every screen row below the
horizon shows floor at a constant distance, so one divide per row gives a
world-space step per pixel — perspective-correct planes without a per-pixel
divide — and the mirrored row above it is the ceiling at that same distance, so
both are filled from one walk. Sprites are billboarded, alpha-blended and
clipped against the wall z-buffer. Cost is O(width × height) per frame,
independent of map size.

Two things keep that affordable at a million-plus pixels a frame: torchlight is
evaluated once per 16-pixel span and interpolated across it (lighting is
low-frequency, so this is invisible and removes a per-pixel light loop), and it
uses a squared-distance falloff so there is no `sqrt` on the hot path. Colour
packing is inlined in the pixel loops rather than going through a helper.

If your machine can't hold the frame rate, **AUTO** resolution walks down the
ladder; pinning a rung in Settings overrides it.

Doors are drawn as slabs that retract sideways: a ray hitting the retracted
portion simply carries on, which is what gives the sliding look.

---

## Testing

```bash
npm test               # 69 tests
npm run bench:agent    # full-campaign autoplay benchmark
```

The suite covers the pure simulation: collision and wall sliding, line of sight
through doors, A* (including refusing to cut wall corners), map validity (every
shipped level is parsed, sealed, fully connected and winnable), hitscan and
projectile rules, splash falloff and enemy crossfire, the damage/armour/ammo
model, settings persistence and the sensitivity mapping, particle lifetimes,
attack telegraphs and death sequences, level progression — and a set of agent
tests that run it headlessly and assert it clears the campaign, never walks
through a wall, and never holds a weapon it cannot feed.

Two of those tests are regressions for a real bug found during development: a
door could auto-close on top of the player, after which collision rejected every
move and wedged them permanently. Doors now refuse to close on an occupant, and
collision has an escape hatch for anything already inside blocking geometry.

### Performance

`AUTO` starts mid-ladder and climbs, sampling real tick cost (not the vsync
wait) over a 30-frame window with hysteresis so it settles instead of
oscillating. The FPS and current internal resolution are shown top-right.

### Caching strategy

There is no server-side cache and no service worker; the dev server sends
`Cache-Control: no-cache` so edits are picked up on reload. In-process, the
things that are expensive to build are computed once and reused for the session:
textures and sprites are baked into `ImageData` at boot, the minimap's vignette
gradient is rebuilt only when the canvas size changes, and the HUD diffs every
value before touching the DOM. The agent caches its A* route and re-plans on its
think tick rather than per frame.

---

## Deploying

The repo is a static site — `index.html` at the root, ES modules, no build. The
included GitHub Actions workflow runs the tests and publishes to GitHub Pages on
every push to `main`. Enable it under *Settings → Pages → Source: GitHub Actions*.

## License

MIT — see [LICENSE](LICENSE).
