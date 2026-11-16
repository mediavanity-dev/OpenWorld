# OpenWorld on the App Store (iPhone)

The iPhone app is the same game as the website, bundled inside a native shell with
[Capacitor](https://capacitorjs.com). Every file ships inside the app, and builds run on a
GitHub-hosted Mac, so no Mac is needed. Model: **free, with an optional tip jar** (consumable
in-app purchases that unlock nothing). The repo and the website stay public, so builds cost no
Actions allowance.

## What's in the repo

| Path | Purpose |
| --- | --- |
| `capacitor.config.json` | App ID `com.mediavanity.openworld`, name, background colour |
| `scripts/build-www.mjs` | `npm run build:app`: the Vite build into `www/`, without the service worker or web manifest; fails on remote scripts or analytics |
| `src/boot.js` | Entry point: inside the app, loads `src/native/` first (storage must be ready before the game reads its profile) |
| `src/native/native.js` | Native storage (Preferences), haptics, location, the tip jar plugin |
| `src/native/notify.js` | The optional morning nudge (local notifications) |
| `ios/App/App/OpenWorldPlugin.swift` | The app's own plugin: the tip jar (StoreKit 2) |
| `ios/App/App/SceneDelegate.swift` | Registers the plugin, no zoom, dark background, light status bar |
| `ios/App/App/Info.plist` | Location, camera and motion permission text; portrait; iPhone only |
| `ios/App/App/PrivacyInfo.xcprivacy` | Privacy manifest: no tracking, no data collected; UserDefaults (CA92.1) |
| `icons/icon.svg`, `scripts/make-icons.mjs` | App icon and launch screen (`node scripts/make-icons.mjs`) |
| `.github/workflows/ios-testflight.yml` | Checks, builds, signs and uploads to TestFlight (run by hand from Actions) |
| `public/switches.json` | Remote off-switches for data services (see below) |

After changing web code: `npm run ios:sync` (rebuilds `www/` and copies it into `ios/`), commit,
push, then run **Actions → iOS → TestFlight → Run workflow**. CI rebuilds `www/` itself.

## Identifiers (permanent)

- Bundle ID: `com.mediavanity.openworld`
- Tip products (consumable): `com.mediavanity.openworld.tip.small` ($0.99), `.tip.medium` ($2.99), `.tip.large` ($4.99)
- Name for TestFlight: **OpenWorld**. "OpenWorld" is a generic genre word: expect to add a suffix or rename before the public release (the name can change with any version; the bundle ID can't).

## Repository secrets (Settings → Secrets and variables → Actions)

The same four values as Alchemy and Standards (secrets are per repo, so they're entered again):
`APPLE_TEAM_ID`, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (the whole `.p8` file).

## Data sources and licences

No scheduled data pipeline (ETL) is needed: the app fetches everything live from public services
and caches it on the phone (7–30 days). Nothing about the player is sent to the developer.

| Source | Used for | Terms that matter for a free app with tips |
| --- | --- | --- |
| OpenStreetMap via OpenFreeMap tiles | The world | ODbL: attribution shown on screen. OpenFreeMap is free, no key |
| Overpass API (public instances) | Trees, opening hours, details | Shared fair-use limits per *app* (about 10k queries a day in total). Fine for TestFlight; for a public launch, put a caching proxy in front (below) |
| Nominatim | Place search, country lookup | 1 request a second for the whole app, no autocomplete, must be switchable off without an update (done: `switches.json`) |
| Open-Meteo | Weather, air quality, climate | Free tier is for non-commercial use; tip jars are explicitly allowed. Subscriptions or ads would need a paid plan (the climate history needs "Professional") |
| iNaturalist | Wildlife lists, photos | Only CC0 / CC BY / CC BY-SA photos are shown, each credited; non-commercial (NC) and no-derivatives (ND) photos are filtered out and replaced with a compatible photo where one exists |
| Wikimedia Commons, Wikipedia, Wikidata | Old photos, stories, facts | Free licences with credit (Commons only hosts free licences); Wikidata is CC0 |
| Macrostrat, USGS, AWS terrain, Nager.Date, geojs.io | Geology, earthquakes, terrain, holidays, IP location | Open/public-domain data, light use |

**At scale (public launch, thousands of players):** add an on-demand caching proxy (for example a
Cloudflare Worker with its cache) in front of Overpass and Nominatim, keyed by map area, so each
area is fetched once a week for everyone. It fills itself as people play: no schedule and no
routine maintenance. Not needed for TestFlight.

**Remote switches:** if a provider asks us to stop, add its host to `"off"` in
`public/switches.json` and merge to `main`. Every copy of the app and the website stops contacting
it at its next start, and the game carries on without that data.

## Still done by hand

- App Store Connect: the app record, the internal TestFlight group, the three tip products
  (consumables, with a review screenshot), App Privacy, age rating, listing, screenshots,
  support and privacy pages, then Submit for Review.
- Review notes must give reviewers a way to play without travelling: **Roam** anywhere (for example
  Greenwich), and that Walk mode uses the phone's real location.
