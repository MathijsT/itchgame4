# Terra Endurance

An open-world, long-distance endurance rally through living landscapes, with the
emphasis on nature (fauna and flora) and the physics of the environment.
Four worlds are planned: **Atlas & Sahara (Morocco)** — playable now —
followed by Siberian taiga & tundra, the Canadian Shield & North Pole, and
Chile's salt flats & Andes.

It runs in the browser (WebGL2), with no build step and no third-party code:
the renderer, physics, terrain generation, audio and UI are all written from
scratch, so the folder can be zipped and uploaded to itch.io as an HTML5 game.

## Play

```sh
npm start            # python3 -m http.server 8080, then open http://localhost:8080
```

Any static file server works (ES modules and web workers need `http://`, not
`file://`). Choose **Start the rally** for four timed stages, or **Free roam**
to explore and fill the field journal.

| Key | Action | Gamepad |
| --- | --- | --- |
| W / ↑ · S / ↓ | Throttle · brake (reverse when stopped) | RT · LT |
| A D / ← → | Steer | Left stick |
| Space | Handbrake | A |
| 1 · 2 · 3 | Tyre pressure presets: sand 0.9 · mixed 1.5 · road 2.2 bar | D-pad ↓ ↑ |
| Z / X | Deflate / inflate 0.1 bar | |
| E | Refuel & repair at bivouacs and fuel trucks | X |
| F | Fit a spare tyre | D-pad → |
| R | Recover the car (+30 s in rally) | B |
| C · drag mouse | Camera · look around | Y · right stick |
| H · T | Headlights · traction assist | D-pad ← · RB |
| J · M · Esc | Field journal · map · pause | LB · Back · Start |

## The Atlas & Sahara world

A 50 km north→south transect inspired by the real journey across Morocco:

1. **Middle Atlas** — cedar and holm-oak forest on a limestone plateau (~1,600 m).
2. **High Atlas** — asphalt switchbacks to a 2,300 m pass; peaks near 4,000 m carry snow.
3. **Draa valley** — red Anti-Atlas ridges, kasbahs, river fords and date-palm oases.
4. **Hamada & erg** — a stony plateau with mesas, then dunes over 100 m tall with no track.

Thirty-odd species are modelled with their habitat, daily activity and
behaviour (Barbary macaques by the track, aoudad on rocky slopes, dorcas
gazelles that sprint at dusk, fennec foxes only at night, eagles and storks
circling in thermals that drift with the wind, goats up argan trees, storks
nesting on kasbah towers…). Spotting a species adds it to the field journal
with a short note on its natural history.

## Environmental physics

- **Terramechanics**: tyres sink according to contact pressure (≈ tyre
  pressure) and load, and dig in when they spin; sinkage adds bulldozing
  resistance. Deflating widens the footprint — like a dromedary's footpads.
- **Dunes** are built from wind-aligned profiles whose lee **slip faces stand
  at the angle of repose (~33°)**: you can descend them but not climb them.
- **Air**: temperature follows the standard lapse rate (6.5 °C/km) and a
  day/night cycle per region; air density sets engine power and radiator
  cooling, so the pass and the midday desert both cost performance.
- **Engine heat** balances shaft power against airflow and ambient
  temperature — crawling up hot dunes at full load overheats the engine.
- **Wind** (with gusts) drives aerodynamic drag and crosswind, sand ripples,
  dust plumes, thermals and occasional dust storms.
- Fords, punctures on rough ground at low pressure, suspension damage from
  hard landings, collisions with trees and boulders, fuel.

## Rendering

HDR pipeline with a physically based atmosphere (Rayleigh, Mie and ozone
scattering in sky-view/transmittance LUTs, aerial perspective, airborne dust,
valley mist), raymarched cumulus and cirrus with cloud shadows, moonlit nights
with stars, cascaded soft shadows, MSAA, bloom, god rays, eye adaptation,
ACES tone mapping with time-of-day grading, heat shimmer and desert mirages.
Terrain is streamed in LOD chunks by web workers, with horizon-based ambient
occlusion and tiling material textures; plants use procedurally drawn foliage
cards with leaf translucency. The **Settings** menu offers Low / Medium / High.

## Code map

```
src/core/       math, seeded noise
src/gfx/        WebGL helpers, shaders, atmosphere, post-processing, textures, meshes
src/world/      route splines, terrain streaming worker, environment, fauna, structures
src/worlds/     world definitions (morocco/: terrain, geography, flora, fauna, climate)
src/vehicle/    vehicle physics and model
src/race/       stages, waypoints, penalties, rival times
src/ui/ audio/  HUD, journal, procedural sound
tests/          node:test suites for terrain, physics and world data
```

New worlds plug in through `src/worlds/registry.js`: a world provides a
terrain sampler, geography (route, rivers, places, stages), flora and fauna
lists, and a climate model.

## Develop

```sh
npm test             # terrain, vehicle physics and world-data tests
npm run build        # dist/terra-endurance.zip for itch.io
```
