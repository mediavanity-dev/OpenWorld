# OpenWorld (prototype)

The real Earth, abstracted. Open data, true WGS84 coordinates, a moving 3D window
around the character, and a tiny on-device profile whose task data is pinned to
the world by anchors that are re-resolved against whatever the global data is today.

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
