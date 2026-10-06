# Monk

Monk is an outdoor multiplayer rock-paper-scissors game. Find other players
on radar and convert them through continuous confirmed proximity.
A converted player changes faction and stays in the game.

The product target is an online PWA for iPhone and Android. The first physical
location trial uses **two iPhones only**. This software does not establish GPS
accuracy, Android accuracy, comprehension, or field feedback latency.

## Setup

Use Node 24.21.0 and Gleam 1.18.1. `mise.toml` pins both tools. With
[mise](https://mise.jdx.dev/) installed:

```sh
mise trust
mise install
npm ci
```

If you do not use mise, install the same Node and Gleam versions and put them
on `PATH`. Gleam builds download the locked `gleam_stdlib` dependency from Hex.
Commit `package-lock.json` and `rules/manifest.toml` when dependencies change.

## Software verification

```sh
npm test && npm run typecheck && npm run build && npm run check:bundle
```

The gameplay UI uses Svelte with Vite. The TypeScript controller owns network
connections and device permissions. The gameplay component stays mounted across
updates, so radar, focused controls, and open details stay in place.

`npm test` compiles the real Gleam rules and runs unit/browser-API tests and
tests in the Workers runtime. Worker tests first build the browser assets,
so a clean clone does not need a pre-existing `dist/`. Type checks keep browser,
Worker, browser-test, and Worker-test globals separate, and check Svelte components.
`check:bundle` is a
Wrangler dry run; it does not deploy.

The engine scenarios use synthetic positions. Production UI never generates
synthetic locations. Automated checks do not count as physical measurements.

### Browser gameplay checks

After the setup commands, run:

```sh
# Existing deterministic and Workers checks
npm test

# Once after npm ci, or after a Playwright browser-version change
npx playwright install --with-deps chromium webkit

# Real local app, synthetic locations
npm run test:e2e

# Watch one browser project
npm run test:e2e -- --project=chromium --headed
```

The browser suite starts and stops its own local Wrangler server at
`http://127.0.0.1:8788`. Keep that port free. Wrangler builds the app through
its existing build hook; no separate Vite server, deployment, or Cloudflare
credentials are required.

Playwright creates independent player sessions in Chromium and WebKit. A
test-only replacement for `navigator.geolocation` supplies asynchronous fixes
and errors and supports watch cancellation. The suite uses the real location
collector, storage sequencing, Svelte UI, WebSocket, Worker, and Gleam rules.
It checks conversion on both screens, range exit, stopping sharing, and a
visible nearby player whose location is too inaccurate for influence.
Each interruption case includes recovery and conversion.

The fixture uses the host controls to set a five-second conversion time and
one-millisecond grace period. All other settings retain their defaults.
Browser and server clocks run at normal speed. The deterministic suite checks
the production 30-second conversion and inactivity boundaries.

CI runs browser checks in a separate job, with no retries or deployment
secrets. On failure, CI retains the HTML report for seven days. Traces, video,
and automatic screenshots are disabled; profiles, local match storage, and
raw authenticated traffic are not uploaded.

### Desktop location overrides and limits

For manual checks, start the server under **Local use**. Open two independent
sessions in visible windows, such as a normal window and an Incognito window.
Open DevTools in each window and use its Command Menu to select **Show Sensors**.
Under **Geolocation**, select **Custom location**. Use latitude/longitude
`0, 0` for one player and `0, 0.00053959` for the other, about 60 m east.
The browser still requires location permission when you select **Share location**.
Select **Location unavailable** to check the error message and stopped sharing.
See [Chrome's Sensors instructions](https://developer.chrome.com/docs/devtools/sensors#geolocation).

Changing Chromium's native override can report a location error before the
new fix. Select **Share location** again if this stops sharing. This extra stop
means a manual override cannot prove uninterrupted movement. The tested
Playwright releases also supplied invalid capture timestamps in WebKit.
The automated gameplay suite replaces the location API to avoid these
automation defects; it does not verify the browser's native location provider
or permission prompts.

WebKit automation does not substitute for a physical iPhone or an installed
PWA. Physical GPS accuracy, stationary and moving update cadence, compass
quality, OS permissions, and screen-lock or background behavior remain
unverified by this suite. Follow the
[two-iPhone trial checklist](docs/playtests/two-iphone-trial.md) for device checks.
The physical trial remains **pending**.

### Marketing identity

The [Side by Side identity kit](brand/README.md) contains the Monk wordmark,
symbols, colors, typography, and sample graphics. Open `brand/index.html`
in a browser or visit `/brand/` on the website to view it. `/brand` redirects
to `/brand/`. The Vite build copies the public kit and its downloads into
`dist/brand/`; internal design-tool records stay in the repository.
The app uses the same wordmark, local Hanken Grotesk font, and faction palette.
The browser favicon uses the yellow avatar; installed-app icons use the paired
symbol. Gameplay rules and faction assignments are unchanged.

Open `/brand/motion.html` to preview or download the Lottie animation.
Yellow leads across both arches, then red paints the first and blue paints
the second. Each color starts 0.1 seconds before the previous color finishes.
The yellow paint stays beneath red and blue. Each arch takes
0.7 seconds; the full sequence takes 3 seconds, including a 0.4-second final
hold. The preview plays once and shows the static mark for reduced motion
or a loading failure. The gameplay app does not load the animation.

Edit `scripts/generate-mark-animation.mjs`, then run `npm run build:mark` to
regenerate `brand/assets/monk-entrance.json`. The regular build also runs
the generator.

## Local use

```sh
npm run dev -- --local --ip 127.0.0.1 --port 8788 --local-upstream 127.0.0.1:8788
```

Open the loopback URL printed by Wrangler. This command builds static assets
and serves them on the same origin as the API and WebSocket. Rebuild and restart
after edits. There is no separate Vite server, offline cache, or service worker.
The local upstream keeps the request origin on loopback instead of the
deployed route configured in `wrangler.jsonc`.

## Play with friends

The home page puts room controls first. **Skip to play** moves directly to them.
Invite links put **Join room** first, with the room code filled in. The short
**How to play** guide follows the controls; full rules and safe-play notes
remain available in closed disclosures. Invalid room codes keep focus at the
field and retain the entered name and code. Returning to an active room keeps
the gameplay view.

Faction badges use red for Rock, yellow for Paper, and blue for Scissors.
The fist, open palm, and two-finger icons come from
[Tabler Icons](https://tabler.io/icons)
(`hand-grab`, `hand-stop`, and `hand-two-fingers`). The rules, faction display,
radar, player lists, and faction-change messages import these SVGs from the
`@tabler/icons` dependency. Main controls and expandable sections use decorative
Tabler icons alongside their text labels.
The [MIT license](public/icons/LICENSE-tabler.txt) ships with the icons.
Vite bundles only the selected icons; the app does not fetch them from a
CDN. Update the package through npm rather than edit icon paths. Target and
threat indicators retain their separate colors and text labels.

Enter an optional display name and select **Create room** or **Join room**.
Blank names use numbered-player labels. The creator joins as a player.
Share **Copy invite link** or the eight-character room code. During play,
open **Room & options**, then **Invite players**. Invitations
remain available during play; new players can join running and paused rounds.
New players get a grace period. Rooms hold at most 100 players.

The invitation also shows a QR code. Scan it to join, or select **Download
QR code** to save a 1024 x 1024 PNG named `monk-room-<ROOMCODE>.png`.
**Share QR code** opens image sharing when the browser supports file sharing.
The app uses `@marianmeres/svelte-qrcode` to generate the code on your device.
It encodes only the public invite URL, with no host or player credentials,
and does not send the URL to a QR service. The link and QR code remain
available during running and paused rounds.

The host selects **Start game**, next to **Copy invite link**, with at least
two joined players. The player list stays visible without a separate
**Players** dropdown. After the round ends, a plain list shows the roster.
Starting and **Resume round** do not request permission or wait for GPS.
A player without location does not block another player's encounter.
The round ends when its timer expires or the host selects **End round**.

Select **Share location** when you want to participate in proximity conversion.
The app uses the browser's first available position, including a cached fix.
No clock check or five-second freshness check is required. Location sharing
works in the lobby and while paused. **Stop sharing** stops your influence
without leaving the room. If permission is blocked, allow location in browser
and device settings, then retry.

Keep the app visible, connected, and the screen on. Hiding, disconnecting,
leaving, ending, or a browser location failure stops local collection.
The app ignores late callbacks after collection stops. A phone clock change
does not stop ordinary reporting.

The gameplay HUD uses your faction color as its background, with ink text.
Your faction and round timer lead. Player distances stay visible without
opening a disclosure. On phones, distances, conversion progress, and location
and compass controls precede the radar. Desktop places these beside the radar.

**Player radar** shows north-up directions, distance rounded to 5 m, and
numbered faction markers. **T** marks a target faction, **!** marks a threat
faction, and **=** marks your own faction. The compact guide names your target
and threat. The two range rings show their actual distances in metres and keep
their labels upright with the compass. The player list emphasizes approximate
distance and bearing; its stable numbers match the radar markers.
Open a player's **Location details** for GPS uncertainty and update age, or
**Radar details** for the reference and full legend. Roles do not confirm an
attack. Your last-known position is the reference.
Without your position, the radar identifies a known peer reference by name.
An absent position shows a waiting state. Old and approximate positions
remain visible; last-known distances are marked when either position is stale.
The app updates age labels even while offline.

Select **Use compass** for optional **Heading-up** radar. On browsers that
request sensor permission, respond to the prompt after selecting the button.
Player positions and compass directions rotate with your phone; faction
icons, player numbers, and progress rings stay upright. Direction labels
in the player list still refer to geographic north. Select **Use compass**
again to stop compass access and restore the fixed view.

Compass access needs HTTPS and a supported sensor/browser. iPhone Safari
uses its compass heading; other browsers must provide absolute orientation.
Relative orientation and GPS travel direction are not used as a compass.
Unavailable, uncalibrated, or inaccurate readings use North-up. A three-second
gap also returns the radar to North-up; a usable new reading restores Heading-up
while it is selected. Hiding the app, leaving, or ending the round stops compass
access. Compass readings stay on your device and do not affect game rules or
location sharing. Sensor accuracy varies by device and surroundings.

Influence requires a shared position less than **30 seconds** old and within
the uncertainty limit. Unknown-age positions cannot contribute to influence.
A repeated capture does not extend its original deadline. After expiry,
the marker remains, both influence roles stop, and a new usable fix starts
new progress. Stopping sharing or disconnecting stops influence at once.
An unrelated old marker does not stop a fresh encounter.

**You are converting...** and **You are being converted by...** identify each
active conversion. Each alert shows a progress bar and seconds remaining,
calculated from the configured conversion time and server-confirmed progress.
Timers stop when influence stops. **Confirming...** at zero does not declare a
conversion; only a server conversion event does that. Solid radar arrows
point to players you influence; dashed arrows point from players influencing
you. Rings around these players show confirmed conversion progress. The
player list shows the same named influence and percentage.
Proximity alone does not confirm influence. The server must accept continuous
dwell before **You converted...** appears and the player's faction changes.
An interruption explains why influence stopped; progress does not continue
through missing observations.

Open **Faction changes** for a timestamped log of conversions and host faction
changes, newest first. Players see only changes involving them; the host sees
all changes. The server applies this filter before sending events. The log
loads again on reconnect without replaying completion alerts, and is separate
from the short **Match feedback** feed. It lasts until the room expires, within
24 hours of creation. Times use the device's local time zone. New changes save
the participants' display names and factions so they remain readable after
players leave. Older events without saved names use the current roster, or
**Player** when the name is no longer available.
Clients request history support when they connect. Tabs opened before this
update keep receiving the older message format; reload them to use the log.

Pausing freezes round timers and clears influence, but location sharing and
radar continue. Missing players or factions do not pause or end the round.
Host faction changes clear affected influence and apply grace. Repeated
command IDs do not apply a change twice.

Default settings: 30 m entry radius, 40 m retention radius, 15 m uncertainty
limit, 30-second conversion time, three-second grace, and a ten-minute round.
The host can change these under **Host controls > Advanced settings** before starting.
Use **Conversion time (seconds)** to set the required continuous influence time.
New rooms use 30 seconds; existing rooms keep their saved settings.
Retention must be at least entry radius. Settings stay fixed while running
or paused. The 30-second inactivity rule is fixed; no mode or approval step
is part of game setup. **Start game** and **Resume round** stay outside the
closed host controls. Sound cues, match feedback, and **Leave room** are under
**Room & options** during play. **Location and safe play** contains the full help.
Agree on safe routes and a bounded play area in person.

Private tokens stay in `sessionStorage` and authenticate the first WebSocket
frame, not the URL. Invite links contain only the room code. Do not share tokens.

## Optional two-iPhone measurements

Open **Host controls > Host diagnostics**, then **Optional location measurement** in the lobby.
Follow [the physical trial checklist](docs/playtests/two-iphone-trial.md).
Measurements require a deployed HTTPS origin; an insecure LAN IP is not a
substitute. API, assets, and sockets must share one origin.

Select two players and enter phone models, iOS versions, browser/PWA modes,
outdoor conditions, and reference separations. Both selected players must
consent to measurements. Diagnostic clock checks and five-second samples
do not control ordinary sharing, starting, or resuming.

Export grouped summaries when you choose to keep them. They omit raw positions,
credentials, names, and movement history. Keep compatible reference blocks
in one summary. Export, then select **Discard measurement summary** before
changing devices, conditions, or parameter candidates.

The host can inspect visible conversion acknowledgements under diagnostics.
Both intended players acknowledge after the conversion text fits inside its
notification and visible viewport. Display-delay upper bounds are not one-way
network latency. Physical accuracy, comprehension, and field feedback targets
remain unverified.

## Deployment is a separate operation

The deployed test origin is **https://monk-test.tylerbutler.com**.
The physical trial is **pending**. CI does not deploy. Authenticate with the
Cloudflare account specified in `wrangler.jsonc` and review the target:

```sh
npx wrangler login
npx wrangler whoami
npm run deploy
```

Wrangler creates the SQLite-backed `MatchAuthority` Durable Object binding
and serves `dist/` through `ASSETS`. Do not put account credentials or local
secrets in source or CI. Validate the resulting HTTPS origin and manifest
assets before inviting the two phones.

Wrangler runs `scripts/cloudflare-build.sh` before local serving, dry-run
bundling, and deployment. The script uses the pinned installed Gleam compiler.
On the Linux x86_64 Workers Builds image, it can install the missing compiler
in the ignored `.wrangler/toolchains/` directory. It verifies the official
release archive's SHA-256 checksum before extraction. `.node-version` selects
the same Node version as `mise.toml`.

### Connect GitHub later

Push the approved branch to the repository you want to connect. In Cloudflare,
open **Workers & Pages > monk-outdoor-playtest > Settings > Builds > Connect**.
Use these settings:

| Setting | Value |
| --- | --- |
| Worker name | `monk-outdoor-playtest` |
| Root directory | Repository root |
| Build command | `npm ci` |
| Deploy command | `npm run deploy` |
| Production branch | The branch approved for this test site |

Keep the Worker name equal to `wrangler.jsonc`. The deploy command runs the
Gleam and browser builds through Wrangler's build hook; Cloudflare's image
does not preinstall Gleam. Leave preview branch builds disabled initially:
Cloudflare does not generate preview URLs for Workers with Durable Objects.

No repository is connected by this configuration. The existing GitHub workflow
runs software checks without Cloudflare secrets or automatic deployment.

## Authority and privacy

One Durable Object owns each private match. TypeScript validates inputs and
calls the pure Gleam rules. Accepted checkpoints, events, and command outcomes
commit before broadcast. Player messages omit raw opponent coordinates.
Radar sends rounded relative distance, compass direction, position age,
uncertainty, and activity. Raw fixes, last-known positions, and unfinished dwell stay in memory; they are not saved
in match records, routine logs, or exports.
The authority also keeps up to 512 recent capture timing records per player,
without past coordinates, to preserve original deadlines across replacement
and suspension. After eviction, older captures rely on their reported age.
This metadata stays in memory and clears on leave, end, expiry, or restart.

An authority restart recovers a running round as paused with its last committed
remaining duration. It discards locations and dwell. Resume is direct;
clients share available positions after reconnecting with prior consent.
Leaving removes that player's position; ending or expiry clears all positions.
Saved legacy rooms migrate to flexible joining and the 30-second policy,
preserving credentials, names, factions, remaining time, and other saved settings.
Clients open during an upgrade must reload the new interface.
All match records and credentials expire within 24 hours of creation.

The design scope is in
[the current game specification](docs/superpowers/specs/2026-10-03-monk-outdoor-playtest-design.md).
`DESIGN.md` records the broader concept, not features promised by this build.
