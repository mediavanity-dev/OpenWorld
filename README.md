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

**First time?** The game opens with just the map and points at the 👁 button: tap it to
show the menus. One more short pointer follows, and then it never appears again.

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

**Street names** follow the road hierarchy: major roads are named even when zoomed well
out, secondary roads at mid zoom, and small streets and paths as you get closer.
**Place icons** work the same way: landmarks (sights, history, museums, parks, nature,
stations) always show; civic and cultural places join at mid zoom; cafés, shops and sport
appear close up. Icons far from where you're looking fade away to keep the view calm.

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

Small round **icons** mark real named places. Each icon shows the kind of place, taken
from OpenStreetMap's own categories: ☕ food & drink, 🛍 shops, 🏛 museums & galleries,
★ sights, ⏳ history, 📖 culture & entertainment, 🎓 education, places of worship, civic
buildings & services, 🛏 lodging, 🌳 parks, ⚽ sport & play, ⛰ nature, 🚆 transport.
Tap an icon for its name and details. Names also appear on their own when you zoom in
close (you can change this in Settings → *Place names*). **Walk within about 30 m of one to
discover it.**

- Once discovered, an icon turns grey (or pale for an echo); places that are closed right
  now look dark.
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
- **🚶 Walking directions** on a place card opens your phone's maps app (Apple Maps on
  iPhone, Google Maps on Android, with *Other app* to choose another; Google Maps or an
  OpenStreetMap route on a computer). Only the destination is sent, so the route starts
  from where you really are.

### 5. Real weather, time and seasons

The world follows the real conditions at your location: the sun and moon are in their
real positions, night is dark (buildings glow softly), and rain, snow, fog, thunderstorms
and wind (trees sway) match the live weather. Trees change with the season: blossom in
spring, orange in autumn, bare in winter. Pine-type trees stay green. The panel shows the
current weather, local time and any public holiday.

When you discover a place, the game remembers the conditions: night, rain, snow, a full
moon, golden hour, a holiday. Visiting again in **new conditions** adds a badge to that
place (🌙 🌧️ ❄️ 🌕 🌅 🎉), so revisiting has a point.

### 6. Track wildlife and find daily treasure

**The hunt.** As you walk, especially through parks, woods and along water, you'll notice
*signs* of an animal nearby ("Fresh signs of a bird nearby"):

- a soft green **rustle** on the minimap that tightens as you close in;
- a small **tracker** at the bottom: 🐾 and five dots that light up as you get warmer;
- faint **tracks** on the ground once you're close.

Get close enough and it shows itself with a gentle glow; walk up to it or **photograph it**
in camera view. Go gently: move in too fast and it slips away. Leave it too long and the
trail goes cold. Every animal is a **real species that people have actually recorded in
that area** (from iNaturalist), shown with a photo; rarer ones leave fainter trails. Plants
and fungi don't leave tracks, so they're simply found nearby. Your collection appears under
**species**.

**Daily treasure ✦.** Every day, three golden finds are hidden in each area along public
streets and paths, the same ones for everyone nearby. The ✦ in the tracker brightens as you
get warmer, a golden arc on the minimap's edge hints at the direction, and a faint golden
glimmer appears when you're close. Walk to it to collect it. Only real visits (Present or
Home) count, and they reset at midnight.

**Geocaches.** Real geocaches from the open **Opencaching** network appear as small box
icons. Tap one for its type, size, difficulty and terrain, the owner's hint (hidden until you
tap), and walking directions. When you've found the container, tap **I found it** (you need
to be close by, and it only counts in Present or Home); it goes into your journal. To log the
find with the cache owner, use **Open listing** on the Opencaching site. For puzzle and
multi-stage caches the marker is only the starting point. Please follow each cache's rules,
respect private land and put caches back exactly as you found them.

All three can be switched off in **Settings → Game features**.

### 7. Your field journal, records and daily assignment

Tap **📓 Journal** to see what you've done:

- **Overview**: places claimed, species, rock units, area explored on foot, distance walked,
  days out, and a chart of your last 7 days.
- **Collections**: places by type, your **life list** of species (tap one for details), the
  **rocks** you've stood on, and the conditions you've seen places in.
- **Records**: highest point stood on, longest day on foot, oldest place, rarest species,
  furthest north and south, peaks reached.
- **Areas**: how much of each ~1.5 km area you've surveyed.
- **Map**: the ground you've explored, with your discoveries.
- **Create a summary image** to save or share a picture of your journal (made on your
  device; nothing is uploaded).

Each day brings one **field assignment** that sends you towards nature, history or
something quirky: *Find a monument or historic spot*, *Visit a park or nature spot*, *Find
something quirky (a sculpture, fountain, clock or sundial)*, *Spot a bird*, *Walk 1 km*.
Cafés and shops never count, and each asks for just one thing. It sits in the panel under
Journal and This spot, with an arrow to the nearest place that fits; tap it to open that
place. In the map-only view it becomes a faint ★ with a small arrow at the bottom of the
screen. It only counts in Present or Home mode.

The **minimap** (bottom-left on computers, top-right on phones) shows the ground you've
explored lit up, the rest in fog, plus nearby places. Tap it to open the journal map.
Roam never counts as real exploration: virtual areas show in purple.

### 8. This spot: geology, sky and history

Tap **🔍 This spot** for a short field note about where you are:

- **Under your feet**: the rock beneath you and its age (e.g. *Lambeth Group: clay, silt,
  sand and gravel, 56–66 million years old*). New rock types you walk onto are added to
  your collection automatically.
- **Recently seen here**: animals and plants people have recorded within about 1 km in the
  past two weeks.
- **Pictures of this place**: freely licensed photos taken nearby, oldest first, with their year.
- **Sky today**: sunrise, sunset, day length (and how fast it's changing), moon phase and
  moonrise, the next meteor shower, and how far local clocks are from the sun.
- **Climate**: how today compares with the 1991–2020 average for this date, plus the
  hottest and coldest this date has been since 1991.
- **Pollen in the air** (Europe), only when there is some.
- **Nearby on Wikipedia**: articles about places within 1 km.
- **The other side of the Earth**: where you'd come out if you dug straight down.
- **Earthquakes**: any of magnitude 2.5+ within 500 km in the past week.

Species cards now also show the creature's family tree, conservation status, how rare it is
locally, and which months it's usually seen around here.

### 9. Camera AR (phones, Present mode)

Tap **📷** to see the game through your phone's camera. Places appear as small icon pins
with their distance (tap one for its name and details), the names of streets ahead of you show near the
ground, beacons rise up as glowing pillars, and nearby creatures appear with a green
"tap to photograph" tag. **Tap a creature to photograph it** from up to 40 m away.
Tap **✕ Exit AR** to go back to the map.

- A **compass strip** at the top shows which way you're facing, with ★ for your next
  target and ● for creatures; arrows at its edges point to anything behind you.
- Your phone gives a gentle buzz (and screen readers announce it) when a creature is straight ahead.
- **Labels off?** Drag sideways on the screen to nudge them into line. If the strip says
  the compass needs calibrating, wave your phone in a figure-8.

- Your browser will ask to use the **camera** (and on iPhone, **Motion & Orientation**); allow both.
- Hold the phone upright and turn around slowly. Direction comes from the phone's compass,
  so it can be off by a few degrees, and positions are as accurate as your GPS (usually 5–15 m).
- AR is only available in **Present** mode, because it shows what's around where you really are.
- Tap **📸** in AR to save a photo of the view (with place labels and a caption). It's
  created on your phone and only saved or shared if you choose.
- The camera picture is otherwise **only shown on your screen**: it is never recorded or uploaded.

### 10. Set your home base

While playing **Present**, tap **Set home base** to make your current real location your
home. After that you can play **Home** mode from anywhere.

Choose carefully: **a home base can only be moved once every 30 days.**

### 11. Leave beacons

Tap **Place beacon** (or press **B**) to drop a glowing marker where you're standing, with
a label of your choice. Beacons stay put for good, even when the map data changes.
Their colour tells you what they're attached to:

- **gold**: attached to a nearby place or building
- **teal**: attached to the ground
- **orange**: the building it was on has moved on the map, so the beacon moved with it
- **red**: the building it was on no longer exists on the map; the beacon stays at its spot

### 12. See just the map

Tap the **eye button** (bottom right), or press **H** on a computer, to hide everything
except the map, place icons and street names. Tap it again to bring it all back.

### 13. Phone extras and settings

- **🧭 Compass** (Present mode, phones): tap it and the camera turns as you turn your phone.
  Your character faces the way you're facing.
- **Settings** (in the panel) let you choose graphics quality, turn weather effects off,
  keep the screen on while you walk, and switch on **Data saver** (skips trees, opening
  hours and wildlife downloads on a slow or limited connection).
- By default the game **adapts to your device**: if things get jerky it lowers the
  graphics, and if your battery drops below 20% it switches to battery saver by itself.
  When nothing is moving, it slows down drawing to save power.
- Discoveries and creatures give a short **vibration** (Android).
- **Settings** also has **units** (metres/°C or feet/°F), **large text**, **reduce motion**
  (no flashes, swaying or bobbing) and an optional quiet **ambient soundscape** (wind, rain,
  birdsong), generated on your device.
- **Install it like an app**: in your browser's menu choose *Add to Home Screen* / *Install*.
  It then opens full-screen and starts instantly.

### 14. Keep your progress safe

Your progress is saved **only in this browser on this device**. It isn't stored online.
To keep a backup or move to another device, use **Export** to save a file, then
**Import** it on the other device. Clearing your browser data erases your progress unless
you've exported it.

### Help inside the game

Tap **? Help & about** in Settings (or *How it works* on the start screen) for a one-page
overview of everything above.

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
card; Macrostrat (geology), Open-Meteo's climate archive, iNaturalist taxon pages and USGS
(earthquakes) only when you open *This spot* or a species card, or move into a new area
(geology). "Locate via internet" asks geojs.io where your connection is. Your discoveries,
species, beacons and home base are never uploaded. In AR, the camera image stays on your
screen and is never recorded or sent anywhere.

---

## The beta version

**https://mediavanity-dev.github.io/OpenWorld/beta/** is where new ideas are tried first. It
has its own separate journal (copy your main one in from Settings if you like) and a small
BETA marker. The hunt and daily treasure started there and have now graduated to the main
version; the next experiments will appear in the beta first.

## For developers

Planned work and ideas: see [BACKLOG.md](BACKLOG.md).

```
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (opening hours, geo, anchors, journal, hunt, treasure); run before every deploy
npm run dev -- --mode beta   # beta channel locally (experiments on)
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
src/game/journal.js       explored cells, daily totals, records, rocks, survey areas, daily assignment
src/data/science.js       geology (Macrostrat), Wikipedia nearby, sky notes, climate normals, quakes, taxa
src/game/profile.js       the only durable state (localStorage, JSON export/import)
src/game/game.js          rules: modes, leash, discovery, opening hours, wildlife, beacons, home base
src/game/locator.js       device + IP location
src/sensors.js            compass, wake lock, battery, vibration
src/ar.js                 camera AR: rear-camera passthrough + device-orientation camera (no libraries)
src/settings.js           per-device settings + quality tiers
src/ui/                   controls, place/species/this-spot cards, field journal, minimap, mini tutorial
src/audio.js              optional synthesised ambience (Web Audio)
public/                   app manifest, icons, service worker (caches the app shell only)
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
