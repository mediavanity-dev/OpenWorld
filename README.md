# OpenWorld (prototype)

The real Earth, abstracted. A walking game built from open data: the street you walk every
day, with its wildlife, rock, sky and history made visible. Everything is in its real place;
only real visits count.

**▶ Play: https://mediavanity-dev.github.io/OpenWorld/** (phones and computers, nothing to install)

---

## Quick start

1. **Pick where to start.** *Be here* uses your phone's location (best outdoors). *Roam anywhere*
   lets you visit any place virtually.
2. **Walk.** Get within about 30 m of a place icon to discover it. On a computer, use
   **W A S D**; on a phone in **Present** mode, walk for real.
3. **Follow what turns up.** Animals leave signs (🐾 and five dots that light up as you get
   warmer), three golden finds ✦ are hidden in each area every day, and today's field
   assignment points the way.
4. **Open 📓 Journal** for your species, rocks, records and the ground you've covered, and
   **🔍 This spot** for the geology, sky and history under your feet.

**Only real visits count.** In **Present** you are where your device is. In **Home** you can
roam 600 m around a home base you set once. **Roam** goes anywhere, but finds there are only
*echoes* until you visit for real.

**Your progress stays on your device.** Nothing about where you go is uploaded. Use **Export**
to keep a backup.

Everything else (all the controls, the camera AR view, beacons, geocaches, settings and
troubleshooting) is in the **[full guide](docs/GUIDE.md)**, and in the game under
Settings → *Help & about*.

## The beta version

**https://mediavanity-dev.github.io/OpenWorld/beta/** is where new ideas are tried first. It
has its own separate journal (copy your main one in from Settings if you like) and a small
BETA marker. The hunt and daily treasure started there and have now graduated to the main
version. Now in the beta: **Then & now**, lining up old photos of historic places in the camera, and
**Expeditions**: a board of three quests dealt from what's around you (a riddle about an
unnamed real place, a bounty on a locally recorded animal, a race to the high ground or
against the real sunset). Each one wins a collectible card whose rarity comes from real facts.

## For developers

Planned work and ideas: see [BACKLOG.md](BACKLOG.md).

```
npm install
npm run dev          # http://localhost:5173
npm run dev -- --mode beta   # beta channel locally (experiments on)
npm run check        # lint + type-check + unit tests; run before every push
npm run build && npm run build:beta && npm run smoke   # headless-browser smoke test of the build
```

CI ([.github/workflows/pages.yml](.github/workflows/pages.yml)) runs lint, type-check, the unit
tests, both builds and the smoke test (main and beta) before every deploy.

- **Lint:** ESLint ([eslint.config.js](eslint.config.js)).
- **Types:** plain JavaScript checked by TypeScript. Files opt in with `// @ts-check` on the first
  line (the game rules, geometry, storage and network code do).
- **Tests** ([tests/](tests/)): game rules against a fake world (modes, leash, upgrades, opening
  hours, treasure, geocaches), saving and migrations, playtest stats, the network helper,
  rephoto matching, opening hours, geo maths, anchors, journal, hunt and treasure.
- **Smoke test** ([scripts/smoke.mjs](scripts/smoke.mjs)): serves the build, opens it in
  headless Chrome/Edge in Roam at Greenwich and fails on any uncaught error. Set `CHROME_PATH`
  to choose a browser, `SMOKE_PATH=/beta/` for the beta and `SMOKE_SHOT=shot.png` for a
  screenshot. In Git Bash on Windows, prefix `MSYS_NO_PATHCONV=1` so `/beta/` isn't rewritten.

Deep link: `http://localhost:5173/?at=51.4779,-0.0015` starts in Roam at those coordinates.
Add `?dev` to bypass the 30-day home-base cooldown while testing.

### Conventions

- **Network:** every request goes through [src/data/net.js](src/data/net.js) (timeouts, retries
  with jittered backoff, per-service health). Never call `fetch` directly.
- **Storage:** durable data goes through [src/storage.js](src/storage.js), never `localStorage`
  directly. The app-store build swaps in native storage there.
- **Save format:** to change the profile format, bump `PROFILE_VERSION` and add a step to
  `MIGRATIONS` in [src/game/profile.js](src/game/profile.js). Old saves and backups are
  upgraded, never discarded.
- **Outside text:** escape with `esc()` and check links with `safeUrl()` from
  [src/util/html.js](src/util/html.js) before putting them in markup.

## Modes

| Mode | Where you are | Movement | Discoveries | Beacons |
|---|---|---|---|---|
| **Present** | your device's real location (GPS / Wi-Fi / IP) | only by moving in real life | **claimed** | yes |
| **Home** | your permanent home base (set once, from a real fix) | free, within 600 m | **home** | yes |
| **Roam** | anywhere (search a place or type lat, lon) | free and fast | **echo**, until visited for real | no |

Every fix carries a trust level (`gps` / `network` / `coarse` / `ip`), which is
recorded with each claim. A desktop can play Present using OS or IP location, then set
that as a home base to get room to move.

## Layout

```
src/main.js               entry: renderer, quality tiers + frame cap, the frame loop, start screen, wiring
src/geo.js                WGS84 <-> local frame (floating origin), z14 tile grid, geohash, seeded RNG
src/storage.js            durable key-value storage (localStorage today; native storage in the app build)
src/util/html.js          escaping and link checks for outside text
src/data/net.js           every network request: timeouts, retries, per-service health
src/data/vtiles.js        BASE fabric: OpenFreeMap vector tiles (CDN, fast)            <- swap sources here
src/data/osm.js           DETAIL fabric: Overpass (trees, hours, wiki tags), building/ref lookups
src/data/terrain.js       AWS Terrain Tiles (Terrarium) elevation
src/data/weather.js       Open-Meteo weather + air quality
src/data/wildlife.js      iNaturalist species near a place
src/data/wiki.js          Wikipedia / Wikidata summaries
src/data/calendar.js      seasons, moon phases, country + public holidays
src/data/hours.js         OSM opening_hours evaluator (common cases)
src/data/science.js       geology (Macrostrat), Wikipedia nearby, sky notes, climate, quakes, taxa, old photos
src/data/cache.js         transient IndexedDB cache (not game state)
src/world/chunkWorker.js  Web Worker: tile + terrain -> geometry buffers + ground texture (off main thread)
src/world/builder.js      buffers -> three.js chunk; height/habitat queries; late detail merge
src/world/world.js        moving 3x3 tile window, nearest-first queue, LOD, origin re-basing
src/world/sky.js          sun/moon lighting, sky, fog, rain/snow particles, lightning
src/world/materials.js    shared materials + GPU effects (wind sway, snow cover, wet ground)
src/game/game.js          rules: modes, leash, discovery, opening hours, wildlife, beacons, home base
src/game/profile.js       the only durable game state: saving, versions + migrations, export/import
src/game/anchors.js       anchor model + resolution (feature / shifted / orphaned / ground / pending)
src/game/environment.js   live conditions + snapshots stamped onto discoveries
src/game/journal.js       explored cells, daily totals, records, rocks, survey areas, daily assignment
src/game/hunt.js          the hunt: signs, warmer/colder, flee, reveal
src/game/treasure.js      daily treasure, seeded by date + area (same for everyone)
src/game/metrics.js       playtest stats (local only)
src/game/rephotoMatch.js  then-and-now: edge-map matching of camera view vs old photo
src/game/locator.js       device + IP location
src/render/               avatar, beacons & home marker, creatures, hunt tracks & treasure mote
src/ui/hud.js             toasts, stats panel, conditions, assignment, tracker, missing-data line
src/ui/labels.js          floating place / street / creature labels
src/ui/arMode.js          camera AR: enter/exit, photos, compass ribbon
src/ui/rephoto.js         then & now overlay in AR (beta)
src/ui/settingsPanel.js   settings, backup, feature switches, playtest stats, help
src/ui/                   also: place/species/this-spot cards, journal, minimap, controls, mini tutorial
src/ar.js                 camera AR core: rear-camera passthrough + device-orientation camera
src/sensors.js            compass, wake lock, battery, vibration
src/settings.js           per-device settings + quality tiers
src/audio.js              optional synthesised ambience (Web Audio)
public/                   app manifest, icons, service worker (caches the app shell only)
docs/GUIDE.md             the full player guide
```

## Performance notes

- World geometry and ground textures are built in a Web Worker; the main thread only uploads buffers.
- Base map comes from a CDN (1 request per ~1.5 km tile); Overpass detail is background-only.
- Quality tiers (pixel ratio, texture size, tree count, particle count, frame cap) with auto
  step-down when frame rate drops, battery-low switching, and a 20 fps idle cap when nothing moves.
- Trees are instanced, with a low-poly variant outside the centre tile; weather effects are
  shader uniforms plus one particle draw call.

## Anchors (the core idea)

Profile data never stores render coordinates or dataset indices. A beacon or discovery stores:

```json
{ "wgs84": [51.4783, -0.0009, 36.4], "height_ref": "terrain-surface", "cell": "gcpuzgr",
  "mode": "feature", "feature_ref": "osm:way/123", "offset": [4.85, 0, 0.07],
  "tolerance_m": 25, "fabric": { "osm": "2026-11-04T17:51:21Z", "base": "openfreemap", "terrain": "aws-terrarium-z13" } }
```

On load, each anchor is resolved against the current data. If the feature still exists,
the anchor follows it (`shifted` if it moved beyond tolerance). If the feature is gone,
it falls back to the ground at the stored coordinates (`orphaned`). Plain ground anchors
snap to the current terrain.

## Data & attribution

- Map data © OpenStreetMap contributors, ODbL. Base tiles: OpenFreeMap (OpenMapTiles schema).
  Detail: Overpass API (shared and sometimes busy; it's background-only).
- Elevation: AWS Terrain Tiles (Mapzen/Tilezen, open data).
- Weather & air quality: Open-Meteo (CC BY 4.0, non-commercial free tier).
- Wildlife: iNaturalist research-grade observations; photos credited per image.
- Wikipedia/Wikidata summaries (CC BY-SA); only Wikimedia Commons (free) images are shown.
- Geology: Macrostrat (CC BY 4.0). Climate normals: Open-Meteo historical archive (ERA5).
- Earthquakes: USGS. Holidays: Nager.Date.
- Wildlife photos: only openly licensed (CC/public-domain) iNaturalist photos are shown.
- Place search & country lookup: OSM Nominatim. IP location: geojs.io.
- Geocaches: the Opencaching network (OKAPI); listings © their owners under each site's
  licence (e.g. Opencaching.de CC BY-NC-ND), shown unmodified with attribution and a link.
- Photos of places: Wikimedia Commons (free licences, credited on hover).

### Geocaching setup (project owner)

Geocaches need free *consumer keys* from the Opencaching sites (one per site; register with an
email at e.g. `https://www.opencaching.de/okapi/signup.html`). Add them as GitHub repository
**variables** (Settings → Secrets and variables → Actions → Variables): `OKAPI_KEY_DE`,
`OKAPI_KEY_PL`, `OKAPI_KEY_NL`, `OKAPI_KEY_RO`, `OKAPI_KEY_UK`, `OKAPI_KEY_US`, then re-run the
deploy. Only the consumer *key* is needed; never add the consumer *secret*. Without keys the
feature stays off. Locally: put `VITE_OKAPI_KEY_DE=...` in an untracked `.env.local`.
