# Monk outdoor playtest

Monk tests outdoor rock-paper-scissors conversion with phone location.
A player changes faction after continuous confirmed proximity, but stays
in the game. New matches use **Testing mode**. Two active players can play,
and the host can change factions during a test round.

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

`npm test` compiles the real Gleam rules and runs unit/browser-API tests and
tests in the Workers runtime. Worker tests first build the browser assets,
so a clean clone does not need a pre-existing `dist/`. Type checks keep browser,
Worker, browser-test, and Worker-test globals separate. `check:bundle` is a
Wrangler dry run; it does not deploy.

The engine scenarios use synthetic positions. Production UI never generates
synthetic locations. Automated checks do not count as physical measurements.

## Local use

```sh
npm run dev
```

Open the loopback URL printed by Wrangler. This command builds static assets
and serves them on the same origin as the API and WebSocket. Rebuild and restart
after edits. There is no separate Vite server, offline cache, or service worker.

Create a match. The host can select **Join as a player on this phone**.
The second phone joins with the private eight-character code. The code does
not grant host control. Private tokens stay in `sessionStorage` and authenticate
the first WebSocket frame, not the URL. Do not share tokens.

Location starts only with consent during a trial, a fresh start check, an active
round, or a resume check. Keep the app visible and the screen on. Permission,
clock, visibility, connection, and wake-lock failures appear in the interface.
Pausing, leaving, hiding, and ending stop local collection. Late browser
callbacks after stopping are discarded.

After a backward clock change, the app waits for capture times beyond the
old clock range. A new clock probe does not make cached fixes fresh.

## Two-iPhone field trial

Follow [the physical trial checklist](docs/playtests/two-iphone-trial.md).
The field build needs a deployed HTTPS origin. An insecure LAN IP is not a
substitute for HTTPS. API, static assets, and sockets must share one origin.

The location-only trial works without gameplay parameters. Select two players;
both must consent. Enter phone models, iOS versions, browser/PWA modes, outdoor
conditions, and known reference separations. Export grouped summaries only
when you choose to keep them. They contain no raw positions, session credentials,
player names, or movement history.

A summary keeps compatible measurement blocks at different marked separations.
Export, then select **Discard measurement summary** before changing phones,
conditions, or parameter candidates. The app does not combine incompatible
measurements or discard earlier blocks without that action.

For a quick Testing round, new matches prefill an **uncalibrated test preset**:
entry 30 m, retention 40 m, maximum uncertainty 15 m, freshness 5000 ms,
dwell 2000 ms, grace 3000 ms, and a ten-minute round. Enter the actual agreed
play area and save before starting. The preset fills the form; it does not
approve measured accuracy or override saved settings.

Expand **Advanced settings** to adjust values, switch modes, or record device
limits. Expand **Change player factions** for host faction controls, or
**Two-iPhone location trial** for measurements. An invited or active trial opens
its consent controls. Open sections and draft inputs stay open across authority
updates. Retention must be at least entry radius, and parameters must be positive
and finite. Settings freeze while running or paused.

Use **Allow location for this round** on both phones. The host starts a
ten-second freshness check; a prior trial is not required. A test round needs
at least two fresh, usable player fixes. Host faction changes clear affected
attacks, apply grace, and have distinct visible feedback. Repeated command IDs
do not apply a change twice.

Normal mode requires six active players, two per faction at start, plus a
separate approval of the saved measured parameters and their device limits.
Changing parameters resets approval. Normal mode pauses on a missing fresh
faction, ends on conversion extinction, and rejects live manual changes.

Both intended players acknowledge conversions only after visible rendering.
The conversion text must fit inside its notification and the visible viewport.
The host sees sample counts, missing acknowledgements, failures, and display-delay
upper bounds. This is not one-way network latency. The later targets are 80%
comprehension and 95% of conversions displayed to both players within one second;
neither target is claimed as achieved.

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
commit before broadcast. Player messages omit exact opponent coordinates.
Raw fixes and unfinished dwell stay in short-lived memory; they are not saved
in match records, routine logs, or exports.

An authority restart recovers a running round as paused with its last committed
remaining duration. It discards locations and dwell. Resume requires fresh
observations and prior player consent; failed checks keep timers paused.
All match records and credentials expire within 24 hours of creation.

The design scope is in
[the approved specification](docs/superpowers/specs/2026-10-03-monk-outdoor-playtest-design.md).
`DESIGN.md` records the broader concept, not features promised by this build.
