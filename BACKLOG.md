# OpenWorld backlog

Ideas and larger pieces of work that are not built yet. Each item notes what it needs,
the main risks, and a suggested first step. Policy and API details change often: anything
marked *(verify)* must be re-checked against the provider's current documentation before
building.

---

## 1. Shared user content (a moderated community layer)

**Goal:** let players add specific, place-anchored content that other players can see and
interact with, after it passes quality control (QC) for appropriateness.

### Content players could add (suggestions)

Ranked roughly by usefulness to other players:

1. **Field notes on a place**: a short tip anchored to a real place ("Quiet bench behind
   the chapel", "Best view at sunset from the north wall"). Text only, ≤ 280 characters.
2. **Wildlife sightings**: "Heron fishing here most mornings". Ideally a hand-off to
   iNaturalist (see item 2) so it becomes real, verifiable science.
3. **Seasonal / timed notes**: "Bluebells here in late April", "Market every Saturday
   08:00–13:00". Shown only during the stated season or time window.
4. **Accessibility notes**: step-free access, benches, toilets, shade, drinking water,
   surfaces. High value and rarely mapped well.
5. **Trail / route suggestions**: a sequence of existing places ("Historic loop, 2.1 km"),
   built only from existing place references, so no free-form geometry is needed.
6. **Corrections**: "This café closed", "Wrong opening hours". Better forwarded to
   OpenStreetMap as a *Note* than stored here (see item 2).
7. **Riddles / puzzles at a place**: player-made challenges with a multiple-choice answer
   checkable on site ("How many lions on the fountain?").
8. **Beacon messages**: public beacons with a short message for others to find.
9. **Photos**: highest value but highest risk (see QC). Consider only after text is proven,
   and only with automated image screening plus human review.

Interactions for other players: *helpful* / *not helpful*, *report*, *still true?*
confirmations (auto-expire stale notes), and "visited" (counts only in Present mode).

### Security and bounds (must-haves)

- **Strict schema, server-side validation**: fixed types only (enum), length limits,
  allowed characters, coordinates within range, and anchors that must reference an existing
  place or tile. Reject anything else; never store unvalidated fields.
- **No HTML ever**: store plain text; render with `textContent` only (the app already
  escapes all outside text). Strip control characters and limit URLs (or disallow them).
- **Parameterised queries only** (no string-built SQL); the API is the only writer.
- **Rate limits and abuse controls**: per device/IP limits, proof-of-work or a privacy-
  friendly CAPTCHA (e.g. Cloudflare Turnstile), shadow-banning, duplicate detection.
- **Location privacy**: never store a contributor's live position; store the anchored
  place only. Optionally delay publication so notes can't reveal real-time presence.
- **Identity**: anonymous device keys (signed) or optional account; no emails in public data.

### Quality control (QC)

1. Automated first pass: profanity/abuse list, a text-moderation classifier, spam and link
   heuristics, image screening for photos.
2. Human review queue for anything flagged or for new contributors (trust grows with
   approved posts).
3. Community reports with automatic hiding at a threshold, pending review.
4. Published guidelines + a clear appeal path; audit log of moderation actions.

### Architecture sketch

Static site stays as-is. Add a small serverless API (e.g. Cloudflare Workers + D1/SQLite, or
Supabase with row-level security): `POST /notes` (validated, queued), `GET /notes?tile=z/x/y`
(approved only, cached at the CDN). Notes are fetched per map tile like other data, so
performance is unaffected.

### Legal / policy

Terms of use, content licence (e.g. CC BY-SA so it can be shared), takedown process,
age gating if needed, GDPR/CCPA data requests, and app-store UGC rules (item 3).

**First step:** text-only "field notes on a place", reviewed manually, in the test
version (item 4).

---

## 2. Linked apps (connect accounts with approved APIs)

**Goal:** let players bring in content from apps they already use, after signing in to them
through the provider's official login (OAuth), never by sharing passwords.

Candidates with public, approved APIs *(verify each)*:

| Service | What it could add | Notes |
|---|---|---|
| **OpenStreetMap** | Add missing places / leave map Notes; credit contributions | OAuth 2 with PKCE works from a static site. Strong fit. |
| **iNaturalist** | Post your AR creature photos as real observations; import your life list | OAuth; contributes to real science. |
| **Opencaching (OKAPI)** | Geocaches as collectibles; log finds | Free per-site keys; logging finds needs OAuth. |
| **Strava** | Import walks/runs as explored ground and distance | Token exchange needs a client secret, so it needs a small backend. |
| **Wikimedia Commons** | Upload your AR photos of landmarks (free licence) | OAuth; good for open data. |
| **Mapillary** | Street-level photos at a place | Token-based API. |
| **Geocaching.com** | Caches | Partner-only API; hobby apps generally not approved. |

Not viable or restricted *(verify)*: Instagram's Basic Display API (retired), Google Photos
library access (restricted to app-created items), and health data (Apple Health and Health
Connect are native-app only).

**Requirements:** each provider's developer registration and app review, scopes kept
minimal, tokens stored securely (a backend for secrets), easy unlinking with data deletion,
and a privacy policy listing every connected service.

**First step:** OpenStreetMap Notes ("report a missing or wrong place") in the test version.

---

## 3. Mobile app stores (iOS App Store, Google Play)

### Is a complete rewrite needed?

Not necessarily. Three routes:

1. **Wrap the web app** (Capacitor): reuse nearly all code; add native plugins for
   location, camera, compass, haptics, background behaviour. Fastest. Risk: Apple rejects
   apps that are "just a website" (Guideline 4.2, minimum functionality), so it must
   use native capabilities meaningfully (e.g. native AR, offline maps, notifications,
   widgets).
2. **Cross-platform engine** (Unity or Flutter): one codebase, true native performance,
   access to ARKit/ARCore (including ARCore Geospatial for street-accurate AR anchoring).
   Requires rewriting rendering and UI; data adapters and game rules port directly.
3. **Fully native** (Swift + Kotlin): best platform feel and AR; two codebases, most cost.

Recommendation: start with (1) to learn store requirements cheaply, then move AR (and
possibly rendering) to native modules or (2) if the game earns it.

### Store policy requirements to plan for *(verify against current guidelines)*

**Both stores**
- Privacy policy URL; accurate data disclosures (Apple *App Privacy* labels; Google Play
  *Data safety* form) covering location, camera, identifiers, and third-party services.
- Location: request only *while in use* unless background use is essential and declared;
  clear purpose strings; Google Play's location permission declaration if background is used.
- Camera / motion: purpose strings (iOS `NSCameraUsageDescription`, `NSMotionUsageDescription`,
  `NSLocationWhenInUseUsageDescription`).
- User-generated content (item 1): ability to report and block, filtering, published
  terms, timely moderation, and contact information.
- Accounts: if users can create accounts, they must be able to **delete the account in-app**.
- Third-party sign-in: on iOS, offering social logins generally requires an equivalent
  privacy-friendly option (e.g. Sign in with Apple).
- Data attribution and licences shown in-app (OpenStreetMap ODbL etc.); respect each
  API's terms, including Open-Meteo's non-commercial free tier (commercial use needs a plan).
- Age rating questionnaire; content rating; kids policies if targeting children.
- No hidden features; review notes and a demo path for reviewers (location-based apps
  need a way to test without travelling).

**Apple-specific**
- Privacy manifest (`PrivacyInfo.xcprivacy`) and reasons for "required reason" APIs.
- Guideline 4.2 minimum functionality (see above); 5.1.1 data collection rules.
- Physical-world safety: AR / location games should warn about surroundings.

**Google-specific**
- Target a recent Android API level (Google raises the minimum yearly).
- Foreground-service and background-location declarations if used.
- App bundle (AAB) signing with Play App Signing; 64-bit native libraries.

**First step:** a Capacitor build in the test version (item 4), run through both stores'
internal testing tracks (TestFlight / Play internal testing) before any public listing.

---

## 4. Test version (beta channel)

**Goal:** a separate version for trying features safely before they reach everyone.

- Deploy a second build to `/OpenWorld/beta/` (or a separate repo/site) from a `beta`
  branch; the main site deploys only from `main`.
- Feature flags (`?beta`, or a settings toggle) so experimental features can be switched
  on for testers without affecting others.
- Separate storage keys for the beta profile (so tests can't corrupt real journals), with
  optional import of your real profile.
- Clear "BETA" marker in the interface and a quick feedback button (item 5).
- First beta features: linked apps (item 2), shared notes (item 1), Opencaching.

---

## 5. Anonymous feedback board

**Goal:** a place where anyone can suggest fixes and enhancements without an account.

Options:
1. **In-app "Send feedback"** form, posting to a small serverless endpoint that files the
   message into a private triage queue (or a GitHub issue via a bot token kept server-side).
   Anonymous by default; optional contact field. Rate-limited + CAPTCHA (e.g. Turnstile).
2. **Hosted form/board** (e.g. Tally, Formspree, or a self-hosted Fider/Canny-style board).
   Quick to start; check each one's privacy terms and data location.
3. **GitHub Discussions/Issues**: public and free, but requires a GitHub account, so not anonymous.

Recommended: (1) for intake + a public roadmap page (curated from accepted items, e.g. a
GitHub Project or a simple page) so people can see what's planned and vote.

Must-haves: no IP or location stored with feedback, spam protection, moderation before
anything is shown publicly, and a short note on what happens to submissions.

---

## 6. Geocaching via Opencaching (ready once keys exist)

Opencaching's open API (OKAPI) works directly from the browser with a free key per site
(e.g. opencaching.de, .pl, .us, opencache.uk). Needs: keys registered by the project owner.
Then: caches as a collectible type (difficulty, terrain, hint, size), finds in the journal;
later, OAuth to log finds. Coverage is strong in Germany and Poland, thinner elsewhere.
