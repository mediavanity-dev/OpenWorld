# OpenWorld (prototype)

The real Earth, abstracted. Open data, true WGS84 coordinates, a moving 3D window
around the character, and a tiny on-device profile whose task data is pinned to
the world by anchors that are re-resolved against whatever the global data is today.

**▶ Play: https://mediavanity-dev.github.io/OpenWorld/** (works on phones and computers, nothing to install)

---

## How to play

OpenWorld is a simplified 3D copy of the real world, built from free public map data.
Buildings are plain blocks, trees are round blobs and parks are green, but everything
is in its real place. Walk around, find real landmarks, and leave your mark.

### 1. Choose where to start

When the game opens, pick one of these:

- **Be here: use my device location.** Puts you exactly where you are right now. Your
  browser will ask for permission to use your location; tap **Allow**. Best on a phone
  outdoors.
- **Locate me via my internet connection.** Guesses your town from your internet
  connection. Good for computers, but it's only accurate to roughly the nearest city.
- **Roam anywhere.** Type a place name ("Eiffel Tower") or tap one of the suggestions to
  visit it virtually.

The world appears within a few seconds. Trees, opening hours and extra place details
then fill in over the next half-minute or so ("Adding trees & place details…" at the
bottom). You can play while that happens.

### 2. Get around

| | On a computer | On a phone |
|---|---|---|
| Walk | **W A S D** or arrow keys | the round joystick, bottom left |
| Run | hold **Shift** | push the joystick all the way out |
| Look around | click and drag | twist two fingers; move two fingers up/down to tilt |
| Zoom | mouse wheel | pinch |
| Info about a place | click its marker or name | tap its marker or name |
| Look around the map (any mode) | right-click and drag | (in Present mode) drag with one finger |
| Back to your character | **C**, or the ◎ button | the orange ◎ button |

In **Present** mode your character only moves when you really walk, so dragging moves
the map instead: zoom out and look around freely, then tap **◎** to jump back to where you
are. Moving with the joystick also brings the view back.

You're the small coloured figure with the arrow above its head. The arrow shows through
buildings, so you can always find yourself.

On phones, the **▸** button next to the mode buttons opens more options (locate, home
base, beacons, search).

### 3. The three ways to play

The buttons at the top switch between them. Each one has a different rule:

- **Present** (orange): you are where your phone or computer really is. You can't use
  the joystick; to move, you walk in real life and your character follows. This is
  the "real" way to play, and everything you find counts fully.
- **Home** (blue): play freely around your **home base**: walk anywhere within
  600 m of it, from your sofa. Finds count as "home". A blue ring shows your limit.
- **Roam** (purple, see-through): go anywhere in the world. It's great for exploring,
  but anything you find there is only an **echo**: a note that you've seen it
  virtually. Visit it for real (Present) later to claim it properly. You can't place
  beacons while roaming.

### 4. Discover places

Floating diamond markers are real named places: cafés, monuments, shops, parks and
landmarks. Their names appear as you get close. **Walk within about 30 m of one to
discover it.**

- Marker colours: orange = sights, purple = historic, blue = cafés, schools and services,
  yellow = shops, green = parks and sport.
- Once discovered, a marker fades (or turns pale for an echo).
- The panel (top-right on computers, bottom on phones) shows your **claimed / home /
  echoes** scores and an arrow pointing to the **nearest place you haven't found yet**.
  Follow the arrow!
- Finding something again in a better mode upgrades it: an echo becomes a claim when you
  visit for real.
- **Opening hours are real.** Cafés, shops and museums that are closed right now look
  dark and can't be discovered until they open (the message tells you when). This uses the
  place's own local time, even when you're roaming abroad.
- **Tap a place for its card**: whether it's open, when it was built (with a 🎂 on its
  anniversary), whether it's heritage-listed, and a short Wikipedia summary when one exists.

### 5. Real weather, time and seasons

The world follows the real conditions at your location: the sun and moon are in their
real positions, night is dark (buildings glow softly), and rain, snow, fog, thunderstorms
and wind (trees sway) match the live weather. Trees change with the season: blossom in
spring, orange in autumn, bare in winter. Pine-type trees stay green. The panel shows the
current weather, local time and any public holiday.

When you discover a place, the game remembers the conditions: night, rain, snow, a full
moon, golden hour, a holiday. Visiting again in **new conditions** adds a badge to that
place (🌙 🌧️ ❄️ 🌕 🌅 🎉), so revisiting has a point.

### 6. Spot wildlife

As you walk, especially through parks, woods and along water, a small glowing creature may
appear nearby ("Something is moving nearby…"). **Walk up to it before it wanders off**
(about 2 minutes) to see what it is. Every creature is a **real species that people have
actually recorded in that area** (from iNaturalist), shown with a photo. Birds and plants
are common; at night you'll meet different animals. Your collection appears under
**species**.

### 7. Set your home base

While playing **Present**, tap **Set home base** to make your current real location your
home. After that you can play **Home** mode from anywhere.

Choose carefully: **a home base can only be moved once every 30 days.**

### 8. Leave beacons

Tap **Place beacon** (or press **B**) to drop a glowing marker where you're standing, with
a label of your choice. Beacons stay put for good, even when the map data changes.
Their colour tells you what they're attached to:

- **gold**: attached to a nearby place or building
- **teal**: attached to the ground
- **orange**: the building it was on has moved on the map, so the beacon moved with it
- **red**: the building it was on no longer exists on the map; the beacon stays at its spot

### 9. See just the map

Tap the **eye button** (bottom right), or press **H** on a computer, to hide everything
except the map. Tap it again to bring it all back.

### 10. Phone extras and settings

- **🧭 Compass** (Present mode, phones): tap it and the camera turns as you turn your phone.
  Your character faces the way you're facing.
- **Settings** (in the panel) let you choose graphics quality, turn weather effects off,
  keep the screen on while you walk, and switch on **Data saver** (skips trees, opening
  hours and wildlife downloads on a slow or limited connection).
- By default the game **adapts to your device**: if things get jerky it lowers the
  graphics, and if your battery drops below 20% it switches to battery saver by itself.
  When nothing is moving, it slows down drawing to save power.
- Discoveries and creatures give a short **vibration** (Android).

### 11. Keep your progress safe

Your progress is saved **only in this browser on this device**. It isn't stored online.
To keep a backup or move to another device, use **Export** to save a file, then
**Import** it on the other device. Clearing your browser data erases your progress unless
you've exported it.

### Troubleshooting

- **The map stays empty or keeps "Loading world…"**: check your connection; it retries by
  itself.
- **No trees / opening hours / creatures yet**: those come from a busy free server and can
  take a minute. They're also skipped while *Data saver* is on.
- **Everything is dark**: it's night there! The sky follows the real time at that place.
- **A place won't count**: it may be closed right now; tap it to see its hours.
- **"Device location failed"**: allow location for this site in your browser settings, or
  use *Locate me via my internet connection* instead.
- **I'm in the wrong town (internet location)**: that's normal for internet location.
  Use your phone with *Be here* for an accurate position.
- **I can't move**: you're in Present mode, so walk for real, or switch to Home or Roam.

**Privacy:** your position stays on your device; only the *area* around you is used to
ask public services for data: map tiles (OpenFreeMap), map details (OpenStreetMap
Overpass), terrain (AWS), weather and air quality (Open-Meteo, to about 1 km), your
country (OpenStreetMap Nominatim, to about 10 km) and its holidays (Nager.Date), and
wildlife (iNaturalist, to about 5 km). Wikipedia is contacted only when you open a place
card. "Locate via internet" asks geojs.io where your connection is. Your discoveries,
species, beacons and home base are never uploaded.

---

## For developers

```
npm install
npm run dev        # http://localhost:5173
```
Deep link: `http://localhost:5173/?at=51.4779,-0.0015` starts in Roam at those coordinates.
Add `?dev` to bypass the 30-day home-base cooldown while testing.

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
src/geo.js                WGS84 <-> local frame (floating origin), z14 tile grid, geohash, seeded RNG
src/data/vtiles.js        BASE fabric: OpenFreeMap vector tiles (CDN, fast)            <- swap sources here
src/data/osm.js           DETAIL fabric: Overpass (trees, hours, wiki tags), building/ref lookups
src/data/terrain.js       AWS Terrain Tiles (Terrarium) elevation
src/data/weather.js       Open-Meteo weather + air quality
src/data/wildlife.js      iNaturalist species near a place
src/data/wiki.js          Wikipedia / Wikidata summaries
src/data/calendar.js      seasons, moon phases, country + public holidays
src/data/hours.js         OSM opening_hours evaluator (common cases)
src/data/cache.js         transient IndexedDB cache (not game state)
src/world/chunkWorker.js  Web Worker: tile + terrain -> geometry buffers + ground texture (off main thread)
src/world/builder.js      buffers -> three.js chunk; height/habitat queries; late detail merge
src/world/world.js        moving 3x3 tile window, nearest-first queue, LOD, origin re-basing
src/world/sky.js          sun/moon lighting, sky, fog, rain/snow particles, lightning
src/world/materials.js    shared materials + GPU effects (wind sway, snow cover, wet ground)
src/game/anchors.js       anchor model + resolution (feature / shifted / orphaned / ground / pending)
src/game/environment.js   live conditions + snapshots stamped onto discoveries
src/game/profile.js       the only durable state (localStorage, JSON export/import)
src/game/game.js          rules: modes, leash, discovery, opening hours, wildlife, beacons, home base
src/game/locator.js       device + IP location
src/sensors.js            compass, wake lock, battery, vibration
src/settings.js           per-device settings + quality tiers
src/ui/                   controls (touch/pinch/keys), place & species card
src/main.js               renderer, adaptive quality + frame cap, avatar, labels, HUD
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
- Wikipedia/Wikidata summaries (CC BY-SA). Holidays: Nager.Date.
- Place search & country lookup: OSM Nominatim. IP location: geojs.io.
