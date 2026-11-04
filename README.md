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

The first time you visit an area, the map can take **10 to 60 seconds** to build
("Loading world…" at the bottom). Places you've been before load almost instantly.

### 2. Get around

| | On a computer | On a phone |
|---|---|---|
| Walk | **W A S D** or arrow keys | the round joystick, bottom left |
| Run | hold **Shift** | push the joystick all the way out |
| Look around | click and drag | drag with one finger |
| Zoom | mouse wheel | (not yet) |

You're the small coloured figure with the arrow above its head.

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

### 5. Set your home base

While playing **Present**, tap **Set home base** to make your current real location your
home. After that you can play **Home** mode from anywhere.

Choose carefully: **a home base can only be moved once every 30 days.**

### 6. Leave beacons

Tap **Place beacon** (or press **B**) to drop a glowing marker where you're standing, with
a label of your choice. Beacons stay put for good, even when the map data changes.
Their colour tells you what they're attached to:

- **gold**: attached to a nearby building
- **teal**: attached to the ground
- **orange**: the building it was on has moved on the map, so the beacon moved with it
- **red**: the building it was on no longer exists on the map; the beacon stays at its spot

### 7. See just the map

Tap the **eye button** (bottom right), or press **H** on a computer, to hide everything
except the map. Tap it again to bring it all back.

### 8. Keep your progress safe

Your progress is saved **only in this browser on this device**. It isn't stored online.
To keep a backup or move to another device, use **Export profile** to save a file, then
**Import** it on the other device. Clearing your browser data erases your progress unless
you've exported it.

### Troubleshooting

- **The map stays empty or keeps "Loading world…"**: the free map server is busy. Wait a
  minute; it retries by itself.
- **"Device location failed"**: allow location for this site in your browser settings, or
  use *Locate me via my internet connection* instead.
- **I'm in the wrong town (internet location)**: that's normal for internet location.
  Use your phone with *Be here* for an accurate position.
- **I can't move**: you're in Present mode, so walk for real, or switch to Home or Roam.

**Privacy:** your position is used on your device to show the map. To build the map,
the game requests map data for the area around you from public servers
(OpenStreetMap). "Locate via internet" asks geojs.io where your connection is. Your
discoveries and beacons are never uploaded.

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
src/geo.js              WGS84 <-> local frame (floating origin), chunk grid, geohash, seeded RNG
src/data/osm.js         OSM adapter (Overpass) -> neutral "reference fabric"   <- swap sources here
src/data/terrain.js     AWS Terrain Tiles (Terrarium) elevation
src/data/cache.js       transient IndexedDB cache of fabric (7-day TTL; not game state)
src/world/builder.js    fabric -> abstract 3D chunk (draped land-cover raster, extruded buildings, blob trees, POIs)
src/world/world.js      moving 3x3 chunk window, load/unload, origin re-basing
src/game/anchors.js     anchor model + resolution (feature / shifted / orphaned / ground / pending)
src/game/profile.js     the only durable state (localStorage, JSON export/import)
src/game/game.js        rules: modes, leash, discovery grading, beacons, home base
src/game/locator.js     device + IP location
src/main.js             renderer, avatar, camera, input, HUD
```

## Anchors (the core idea)

Profile data never stores render coordinates or dataset indices. A beacon or discovery stores:

```json
{ "wgs84": [51.4783, -0.0009, 36.4], "height_ref": "terrain-surface", "cell": "gcpuzgr",
  "mode": "feature", "feature_ref": "osm:way/123", "offset": [4.85, 0, 0.07],
  "tolerance_m": 25, "fabric": { "osm": "2026-11-04T17:51:21Z", "terrain": "aws-terrarium-z13" } }
```

On load, each anchor is resolved against the current data. If the feature still exists,
the anchor follows it (`shifted` if it moved beyond tolerance). If the feature is gone,
it falls back to the ground at the stored coordinates (`orphaned`). Plain ground anchors
snap to the current terrain.

## Data & attribution

- Map data © OpenStreetMap contributors, ODbL, via the public Overpass API. It is shared
  and sometimes overloaded: the first visit to an area can take 10–60 s, and later
  visits load from cache.
- Elevation: AWS Terrain Tiles (Mapzen/Tilezen, open data).
- Place search: OSM Nominatim. IP location: geojs.io.
