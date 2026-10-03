# Monk outdoor playtest implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver an outdoor PWA with a Gleam rules engine, a two-iPhone location trial, and host-controlled two-player test rounds.

**Architecture:** A TypeScript Worker serves the PWA and routes private sessions to one Durable Object per match. That object validates inputs, calls a pure Gleam engine compiled to JavaScript, and commits accepted changes before sending player-specific messages. The browser owns location collection and presentation, not conversion decisions.

**Tech stack:** Gleam with JavaScript output and `gleam_stdlib`; TypeScript; vanilla DOM UI built with Vite; Cloudflare Workers and SQLite-backed Durable Objects; Zod for runtime protocol validation; Vitest, jsdom, and `@cloudflare/vitest-plugin`.

**Spec:** `docs/superpowers/specs/2026-10-03-monk-outdoor-playtest-design.md`. Read both documents before execution.

## Global constraints

- The product target is a PWA for iPhone and Android.
- The initial location trial uses two iPhones only.
- Players use it outdoors, keep the app visible with the screen on, and have usable internet access.
- Testing mode starts enabled for new matches.
- Testing mode permits a round with two active players and any faction distribution.
- For a normal round, require six active players and assign two to each faction.
- Keep the selected mode and rule parameters fixed through running and paused phases of that round.
- Use an initial round duration of ten minutes; the host can choose another duration before starting.
- Expire server-side match records and session credentials within 24 hours of match creation.
- Do not include coordinates or session secrets in routine logs, retained events, or exported summaries.
- Do not send exact opponent coordinates to a player.
- There is no native wrapper, offline gameplay, CRDT, competitive scoring, protection rule, or group mechanic in this scope.
- No production tracking values come from synthetic tests.
- The later gameplay targets are 80% comprehension and 95% of accepted conversions displayed to both players within one second.
- Use ASD-STE100 where possible. Do not add co-author trailers to commits.

## Review focus

1. A cached GPS result with a new message sequence must not extend freshness; Task 4 tests it.
2. A phone clock change or asymmetric delay must not give an old fix extra lifetime; Tasks 4 and 5 test it.
3. A lost acknowledgement must not repeat a host faction change or reset grace; Tasks 3 and 6 test it.
4. Paused clients must be able to provide resume-check fixes without restarting gameplay or the clock; Tasks 4 and 5 test it.
5. Private events sent to another player must not appear as sequence gaps in this player's stream; Tasks 4 and 5 test it.

## Baseline and tooling decisions

The repository contains `DESIGN.md`, this specification, and agent tooling.
It has no product package manifest, application source, build, or test suite.
Do not restructure or regenerate the existing APM and agent directories.

Use one npm package rather than a workspace or package-per-component setup.
Use Node 24 LTS and a Gleam compiler with the JavaScript public custom-type
API introduced in 1.13 or later. Select compatible stable tooling versions
in Task 1 and record exact resolutions in lockfiles. Vitest must be 4.1 or
later for the current Cloudflare test plugin.

Use `@cloudflare/vitest-plugin` and `cloudflareTest()`, not the superseded
`@cloudflare/vitest-pool-workers` configuration. Generate Worker types with
Wrangler. Configure separate browser and Worker TypeScript checks to avoid
mixing their global declarations.

Use Vite to build static browser assets and Wrangler to bundle the Worker.
A Cloudflare Vite plugin is not required for this first setup. Set the
Worker compatibility date to `2026-10-03`; use SQLite-backed Durable Object
migrations with `new_sqlite_classes: ["MatchAuthority"]`.
Bind static assets from `dist/` as `ASSETS` and use `run_worker_first: true`.
Return JSON 404 responses for unknown `/api/` routes instead of the HTML fallback.

Use these npm scripts:

| Script | Command or purpose |
| --- | --- |
| `build:rules` | `cd rules && gleam build --target javascript` |
| `test:unit` | `vitest run --config vitest.config.ts` |
| `test:worker` | `vitest run --config vitest.worker.config.ts` |
| `test` | Build rules once, then run both test configurations. |
| `typecheck` | Build rules, generate Wrangler types, then check browser, Worker, and test/config TypeScript projects. |
| `build` | Build rules, then run `vite build`. |
| `check:bundle` | `wrangler deploy --dry-run --outdir .wrangler/dry-run` |
| `dev` | Build rules and browser assets, then run local `wrangler dev`. |
| `deploy` | Build, then run `wrangler deploy` only after explicit deployment approval. |

Local browser access is through Wrangler's origin. Rebuild assets after edits;
do not add a second development server or proxy until needed. Physical iPhone
tests need a deployed HTTPS origin; an insecure LAN IP is not a substitute.

## Planned files and responsibilities

| Files | Responsibility |
| --- | --- |
| `package.json`, `package-lock.json`, `.gitignore` | JavaScript dependencies, commands, and generated-file exclusions. |
| `vite.config.ts`, `wrangler.jsonc`, `vitest.config.ts`, `vitest.worker.config.ts` | Browser bundle, Worker bindings, and test environments. |
| `tsconfig.json`, `tsconfig.browser.json`, `tsconfig.worker.json`, `tsconfig.test.json` | Strict shared settings and environment-specific checks. |
| `worker-configuration.d.ts` | Wrangler-generated binding/runtime types. |
| `rules/gleam.toml`, `rules/manifest.toml` | Gleam target, declaration output, and dependency lock. |
| `rules/src/monk_rules/domain.gleam` | Factions, phases, parameters, observations, commands, state, and events. |
| `rules/src/monk_rules/engine.gleam` | Match lifecycle, test mode, clocks, snapshots, and checkpoints. |
| `rules/src/monk_rules/proximity.gleam` | Horizontal distance and conservative range checks. |
| `rules/src/monk_rules/conversion.gleam` | Target selection, dwell, batch conflicts, and grace. |
| `src/worker/engine.ts`, `src/worker/engine.test.ts` | Typed Gleam adapter and synthetic scenarios. |
| `test/fixtures.ts` | Synthetic state/position builders; never imported by production code. |
| `src/shared/protocol.ts`, `src/shared/protocol.test.ts` | Zod schemas and inferred protocol types. |
| `src/shared/clock.ts`, `src/shared/clock.test.ts` | Clock estimates and conservative fix-expiry calculation. |
| `src/worker/index.ts`, `src/worker/match-authority.ts` | HTTP routing and the authoritative Durable Object. |
| `src/worker/auth.ts`, `src/worker/storage.ts` | Credential verification and coordinate-free persistent records. |
| `test/worker/build.test.ts`, `test/worker/match.test.ts`, `test/worker/recovery.test.ts` | Worker-runtime, authority, and recovery checks. |
| `src/client/connection.ts`, `src/client/location.ts`, and adjacent `.test.ts` files | Authenticated streams, clock sync, visibility, GPS, and wake lock. |
| `src/client/trial.ts`, `src/client/trial.test.ts` | Two-phone measurements and coordinate-free summaries. |
| `src/client/app.ts`, `src/client/views.ts`, `src/client/app.test.ts`, `src/client/styles.css` | Lobby, trial, player view, and host controls. |
| `index.html`, `public/manifest.webmanifest`, `public/icons/icon.svg` | PWA entry, metadata, and source artwork. |
| `public/icons/icon-192.png`, `public/icons/icon-512.png` | Generated install icons; document the conversion command. |
| `README.md`, `docs/playtests/two-iphone-trial.md`, `.github/workflows/ci.yml` | Setup, deployment, physical trial instructions, and software checks. |

Ignore `node_modules/`, `dist/`, `rules/build/`, `.wrangler/`, and local secrets.
Commit npm and Gleam lockfiles. Import the generated Gleam entry at
`rules/build/dev/javascript/monk_rules/monk_rules/engine.mjs`; let bundlers
follow its dependency imports rather than copying only that file.

## Shared contracts

Define these names once in `src/shared/protocol.ts` using Zod schemas and
`z.infer`. Match Gleam fields through explicit mapping in `engine.ts`.

```ts
type Faction = "rock" | "paper" | "scissors";
type MatchMode = "test" | "normal";
type MatchPhase = "lobby" | "running" | "paused" | "ended";
type RuleParameters = {
  entryRadiusM: number; retentionRadiusM: number; maxAccuracyM: number;
  freshnessMs: number; dwellMs: number; graceMs: number;
  roundDurationMs: number;
};
type PositionReport = {
  seq: number; capturedAtMs: number;
  latitude: number; longitude: number; accuracyM: number;
};
type Observation = {
  playerId: string; latitude: number; longitude: number; accuracyM: number;
  capturedAtMs: number; expiresAtMs: number; seq: number;
};
type VerifiedActor = { id: string; host: boolean; playerId: string | null };
type EngineInput = {
  nowMs: number; actor: VerifiedActor | null;
  commands: DomainCommand[]; observations: Observation[];
};
```

`DomainCommand` is a discriminated union of `join`, `leave`, `configure`,
`start`, `pause`, `begin_resume`, `cancel_resume`, `end`, and `set_faction`.
Give parameter and mode changes to `configure`; give `join` a player ID and
initial faction; give `set_faction` a target player ID and faction. The adapter
supplies `VerifiedActor` after authorization, never from client JSON.
Include host approval and device limitations in configuration metadata; reset
that approval when parameters change. Internal joins use the least-populated
faction, with ties ordered Rock, Paper, Scissors. Clients cannot send internal
join commands through the host-control channel.

Define `PlayerSnapshot` with phase, mode, own faction, roster labels/factions,
remaining time, own grace, outgoing/incoming progress, nearby faction counts,
quality reasons, and parameter/calibration status. Include `resumeChecking`
and `canHost`; the adapter derives `canHost` from the verified actor. Allow
null own-player fields for a host who has not joined as a player. It contains
no coordinates.
`EngineEvent` variants include `conversion`, `manual_faction_change`,
`attack_started`, `attack_interrupted`, and lifecycle changes. Fix event field
names to `attackerId`, `targetId`, `faction`, `reason`, `eventSeq`, and `atMs`
where those fields apply. Manual changes also have `hostId` and `oldFaction`.

`EngineCheckpoint` contains roster/factions, phase/mode/parameters, remaining
round/grace durations, and event sequence. It excludes observations and dwell.
Define the server-only `MatchRecord` in `storage.ts`: match ID/code, creation
and expiry times, checkpoint, session-token verifiers, accepted events, and
deduplicated command outcomes. Validate it when loading.
`TrialSummary` contains device/software labels, reference separations, counts,
error/update-gap distributions, parameter candidates, and limitations. It
excludes coordinates, credentials, and player names.

Define `SessionCredentials` with `matchCode`, nullable `hostToken`, and nullable
`playerToken`. `ConnectionHandlers` supplies `onMessage(ServerMessage): void`
and `onStatus(ConnectionStatus): void`. `LocationStatus` reports collection,
permission, visibility, wake-lock status, and a nullable reason. Define
`ConnectionStatus` as connecting, connected, reconnecting, or failed, with a
nullable reason.

`TrialSample` contains authority time, estimated distance, both uncertainties,
both sample ages/update gaps, capture-to-receipt delay bounds, clock uncertainty,
and nullable reference separation. It contains no coordinates. Use these fields
to calculate signed/absolute error and interruption/false-entry counts for
candidate settings. Export grouped summaries, not per-sample movement records.

Use a `version: 1` envelope. Client messages are `authenticate`, `clock_probe`,
`clock_confirm`, `position`, `suspend`, `host_command`, `snapshot_request`,
`feedback_seen`, `trial_begin`, `trial_ready`, and `trial_end`. Server messages
are authentication/clock replies, `snapshot`, `update`, `trial_sample`, and
`error`. Host commands have `commandId` and `command`, with only host operations
allowed. Validation failures produce a typed error with a human-readable
reason, not an empty successful response.

`trial_begin` is a host operation selecting two joined participants; each
confirms consent through `trial_ready` before collection starts. Send pair
measurements only to those participants and their host. A trial may run in
the lobby without conversion settings. Use `5000 ms` as its labeled diagnostic
freshness limit; this does not set gameplay freshness. `trial_end`, pause,
leave, or restart stops trial collection.

Each authenticated connection has a new `streamId` and contiguous `streamSeq`.
Keep those separate from the global persisted `eventSeq`, since player-specific
events can omit events that another player receives.

## Task 1: Prove the Gleam and Worker build

**Files:** Create the root build/test/TypeScript configs, manifests and locks,
`rules/src/monk_rules/domain.gleam`, `rules/src/monk_rules/engine.gleam`,
`src/worker/engine.ts`, `src/worker/index.ts`, `src/worker/match-authority.ts`,
`src/worker/engine.test.ts`, `test/worker/build.test.ts`, and a minimal
`index.html`. Create the faction-only start of `src/shared/protocol.ts`.
Modify `.gitignore`.

**Interfaces:**
- Produces Gleam `is_superior(attacker: Faction, target: Faction) -> Bool`
  and `new_match(id: String, host_id: String, created_at: Int) -> Match`.
- Produces TypeScript `isSuperior(attacker: Faction, target: Faction): boolean`
  and `createEngine(input: {id: string; hostId: string; createdAtMs: number}): EngineState`.
- `EngineState` derives from the generated declaration of `new_match`, not a
  handwritten duplicate of Gleam internals.
- Produces `MatchAuthority extends DurableObject<Env>` and the Worker default
  `fetch(request: Request, env: Env): Promise<Response>`.

- [ ] **Step 1: Add the failing build-boundary tests and the configs needed to run them.**
  Add manifests before installing dependencies. Configure Gleam JavaScript
  output and `typescript_declarations = true`. Define the protocol faction type.

```ts
it("calls Gleam faction rules", () => {
  expect(isSuperior("rock", "scissors")).toBe(true);
  expect(isSuperior("rock", "paper")).toBe(false);
});
it("runs compiled Gleam inside the Workers runtime", () => {
  expect(isSuperior("paper", "rock")).toBe(true);
});
```

- [ ] **Step 2: Run `npm run build:rules && npm run test:unit -- src/worker/engine.test.ts`.**
  Expect a missing export or failing rule assertion, not an unrelated dependency
  failure. Resolve missing tools only after that failure or manifest changes.
- [ ] **Step 3: Implement the two Gleam functions and the typed adapter.**
  Use public generated constructors/accessors. Export the Durable Object class
  from the Worker entry, configure its SQLite migration, and retain the adapter
  import in the class so the Worker bundle includes Gleam. Start matches in a
  lobby with testing mode enabled.
- [ ] **Step 4: Run `npm test && npm run typecheck && npm run build && npm run check:bundle`.**
  Expect passing unit and Workers-runtime imports, no type errors, and a dry-run
  bundle that resolves generated Gleam modules without Node-only dependencies.
- [ ] **Step 5: Commit as `build: connect Gleam to the Worker runtime`.**

## Task 2: Implement deterministic match rules and test mode

**Files:** Complete the four planned Gleam modules and `src/worker/engine.ts`.
Add domain schemas/contracts to `src/shared/protocol.ts`. Extend
`src/worker/engine.test.ts`; create `test/fixtures.ts`.

**Interfaces:**
- Consumes Task 1's compiled engine and shared contracts.
- Produces Gleam `step(match: Match, input: StepInput) -> StepResult`,
  `checkpoint(match: Match, now: Int) -> Checkpoint`,
  `restore(checkpoint: Checkpoint, now: Int) -> Match`, and
  `view_for(match: Match, player_id: Option(String), now: Int) -> PlayerView`,
  and proximity `distance_between(a: Position, b: Position) -> Float`.
- Produces TypeScript `advanceEngine(state: EngineState, input: EngineInput): EngineTransition`,
  `checkpointEngine(state: EngineState, nowMs: number): EngineCheckpoint`,
  `restoreEngine(checkpoint: EngineCheckpoint, nowMs: number): EngineState`,
  `snapshotFor(state: EngineState, playerId: string | null, nowMs: number): PlayerSnapshot`,
  and `distanceBetween(a: Observation, b: Observation): number`.
- `EngineTransition` has `state`, `events: EngineEvent[]`, and typed `rejections`.
- Test helpers: `runningFixture(factions: Faction[], mode?: MatchMode): EngineState`,
  `fix(playerId: string, eastM: number, nowMs: number): Observation`,
  and `pulse(state: EngineState, nowMs: number, eastM: number[]): EngineTransition`.
  Assign fixture player IDs `p1`, `p2`, etc.; `pulse` supplies fresh fixes.

- [ ] **Step 1: Add failing scenario tests against the real compiled engine.**
  Fixtures use entry `12 m`, retention `14 m`, maximum uncertainty `3 m`,
  freshness `1500 ms`, dwell `3000 ms`, grace `2000 ms`, and round `600000 ms`.
  `fix` uses uncertainty `1 m` and coordinates at latitude zero, with longitude
  calculated from eastward metres using Earth radius `6371000 m`.

```ts
it("requires continuous dwell", () => {
  let state = runningFixture(["rock", "scissors"]);
  for (const now of [0, 500, 1000, 1500, 2000, 2500]) {
    const next = pulse(state, now, [0, 4]);
    expect(next.events.filter(e => e.type === "conversion")).toHaveLength(0);
    state = next.state;
  }
  const done = pulse(state, 3000, [0, 4]);
  expect(done.events.filter(e => e.type === "conversion")).toMatchObject([
    { attackerId: "p1", targetId: "p2", faction: "rock" },
  ]);
});
```

  Add assertions for stale fixes at expiry, excessive uncertainty, interruption
  reset, nearest-target locking, exact tie order, competing attackers, an RPS
  chain, and both directions of grace. Replay the same ordered inputs twice
  and compare checkpoints/events for equality.
  Before replacing observations, check the previous expiries and clear dwell
  across any freshness gap. Supply new accepted observations before evaluating
  lifecycle commands; apply host commands before the conversion snapshot.
  Test an observation gap even when fresh endpoint fixes would be in range.

  Add `default_test_mode`, `normal_requires_six_balanced_players`,
  `test_accepts_two_and_incomplete_factions`, `normal_extinction_ends`,
  `test_extinction_continues`, `manual_change_requires_host`,
  `manual_change_rejected_in_normal_round`, `manual_change_clears_both_attack_roles`,
  `manual_change_applies_grace_without_conversion`, `same_faction_does_not_reset_grace`,
  and `mode_and_parameters_frozen_while_paused` tests with the named outcomes.

- [ ] **Step 2: Run `npm run build:rules && npm run test:unit -- src/worker/engine.test.ts`.**
  Expect failures in the new scenario assertions.
- [ ] **Step 3: Implement the named transitions and proximity functions.**
  Use horizontal haversine distance. Follow the spec's host-command-before-snapshot
  batch order. Keep round/grace duration separate from wall time during pauses;
  expired observations cannot earn dwell. Require fresh samples throughout the
  interval rather than considering only its endpoints.
- [ ] **Step 4: Run the same targeted command, then `npm run typecheck`.**
  Expect all scenarios to pass. The fixture numbers remain test-only; do not
  initialize the application's location parameters from them.
- [ ] **Step 5: Commit as `feat(rules): add deterministic test rounds`.**

## Task 3: Add private sessions and durable accepted state

**Files:** Extend `src/shared/protocol.ts` with wire schemas; create its tests,
`src/worker/auth.ts`, `src/worker/storage.ts`, and `test/worker/match.test.ts`.
Extend Worker routing and `MatchAuthority`.

**Interfaces:**
- Consumes Task 2's engine/checkpoint functions.
- Produces `parseClientMessage(input: unknown): ParseResult<ClientMessage>`,
  `parseServerMessage(input: unknown): ParseResult<ServerMessage>`, and inferred
  domain/checkpoint types. `ParseResult` is a success/error discriminated union.
- Produces `issueToken(): Promise<{token: string; verifier: string}>` and
  `verifyToken(token: string, verifier: string): Promise<boolean>`.
- Produces `loadRecord(storage: DurableObjectStorage): Promise<MatchRecord | null>`
  and `commitRecord(storage: DurableObjectStorage, record: MatchRecord, events: EngineEvent[]): Promise<void>`.
- HTTP endpoints: `POST /api/matches`, `POST /api/matches/:code/join`,
  and `GET /api/matches/:code/socket`. JSON creation/join replies contain only
  the caller's credentials. Return 400 for invalid input, 401/403 for failed
  authorization, and 409 for a roster or phase conflict.

- [ ] **Step 1: Add failing schema, authorization, and persistence tests.**

```ts
it("rejects a client-selected host role", () => {
  expect(parseClientMessage({
    version: 1, type: "host_command", commandId: "test-1", role: "host",
    command: { type: "set_faction", playerId: "p1", faction: "rock" },
  }).ok).toBe(false);
});
it("stores no location or dwell in a checkpoint", () => {
  const record = checkpointEngine(pulse(runningFixture(["rock", "scissors"]), 0, [0, 4]).state, 0);
  expect(JSON.stringify(record)).not.toMatch(/latitude|longitude|capturedAtMs|dwellStart/);
});
```

  Worker tests assert that a join code grants no host authority, wrong-match
  tokens fail, the host can also join as a player, closed rosters reject joins,
  invalid JSON yields a visible error, and a failed storage commit emits no
  successful transition. Retrying a command ID returns its original outcome
  without another event or grace change.
  Capture routine error logs and assert that submitted credentials and coordinate
  values do not appear. Log sanitized error codes rather than rejected payloads.

- [ ] **Step 2: Run `npm run test:unit -- src/shared/protocol.test.ts && npm run test:worker -- test/worker/match.test.ts`.**
  Expect the new contract and persistence assertions to fail.
- [ ] **Step 3: Implement strict Zod schemas, private routing, and record commits.**
  Use `crypto.getRandomValues` for session tokens and join codes; store token
  hashes/verifiers, not raw tokens. A code identifies the object's name directly;
  check for collision on creation instead of adding an index database.
  Return credentials once over HTTPS. Authenticate a socket in its first frame
  within five seconds; do not put bearer credentials in URLs or logs.
  Validate same-origin WebSocket requests and bound frames to `16 KiB`.
  Associate identities with verified sessions, serialize command application,
  and atomically commit checkpoint, event sequence, and command outcome before
  broadcasting. Reject corrupt stored records instead of creating empty state.
- [ ] **Step 4: Run the targeted commands and `npm run typecheck`.**
  Expect schema, authorization, retries, failed writes, and cross-match checks
  to pass without `as any` or unvalidated casts.
- [ ] **Step 5: Commit as `feat(server): add private durable match sessions`.**

## Task 4: Add observations, scheduling, and recovery

**Files:** Create `src/shared/clock.ts`, its tests, and
`test/worker/recovery.test.ts`. Extend protocol, storage, and authority code.

**Interfaces:**
- Consumes authenticated actors, engine steps, and atomic commits.
- Produces `estimateClock(sample: ClockProbeSample): ParseResult<ClockEstimate>`
  and `normalizeObservation(report: PositionReport, clock: ClockEstimate, receivedAtMs: number, playerId: string, freshnessMs: number): ParseResult<Observation>`.
- `ClockProbeSample` has `clientSendMs`, `serverReceiveMs`, `serverSendMs`,
  and `clientReceiveMs`. `ClockEstimate` has `offsetMs`, `uncertaintyMs`, and
  `measuredAtMs`. Offset means authority time minus client time.
- Produces authenticated snapshots/updates with per-connection stream cursors,
  plus coordinate-free `trial_sample` distance/quality data for the two-phone view.

- [ ] **Step 1: Add failing freshness, timer, recovery, and stream tests.**

```ts
it("uses the oldest plausible fix time for expiry", () => {
  const clock = { offsetMs: 100, uncertaintyMs: 40, measuredAtMs: 1000 };
  const report = { seq: 1, capturedAtMs: 1000, latitude: 0, longitude: 0, accuracyM: 1 };
  const parsed = normalizeObservation(report, clock, 1100, "p1", 1500);
  expect(parsed.ok).toBe(true);
  if (parsed.ok) expect(parsed.value.expiresAtMs).toBe(2560);
});
```

  Assert that duplicate capture timestamps with higher message sequences do not
  refresh observations; old sequences and implausible future fixes fail; round
  and grace deadlines run without new messages; a late callback cannot complete
  stale dwell; missing factions pause normal mode but not testing mode.
  A stale/missing faction in normal mode must pause even if its socket stays
  connected. Derive active participation from fresh usable observations.
  Assert paused sampling stops, resume-check sampling starts without advancing
  timers, and failed/canceled checks return to paused collection behavior.
  Restore running records as paused, preserve lobby/ended phases, clear locations
  and dwell, preserve committed duration, and require fresh resume observations.
  Send a private event to player B and verify player A's next `streamSeq` is
  contiguous. At `createdAtMs + 86400000`, close clients and delete match data.
  Add a lobby trial with no gameplay parameters: it starts only after both
  selected participants consent, uses diagnostic freshness, and stops on pause
  or leave. No other player receives its pair measurements.

- [ ] **Step 2: Run `npm run test:unit -- src/shared/clock.test.ts && npm run test:worker -- test/worker/recovery.test.ts`.**
  Expect the new authority and clock assertions to fail.
- [ ] **Step 3: Implement conservative clock normalization and scheduling.**
  Calculate offset as `((s1 - c0) + (s2 - c3)) / 2` and uncertainty as
  `((c3 - c0) - (s2 - s1)) / 2`. Reject negative intervals and inconsistent
  probes. Bind probes to the authenticated connection and echoed nonce.
  Use `capture + offset - uncertainty + freshness` as fix expiry. Reject a
  fix if even its oldest plausible capture time exceeds receipt time, or if
  expiry is at/before the current time. Refuse estimates with
  uncertainty over `1000 ms`; refresh clock probes every `30 s`.
  These are transport checks, not proof of physical location.

  Resolve running matches every `250 ms` with an in-memory timer. Persist
  coordinate-free clock checkpoints, and schedule Durable Object alarms for
  recovery/expiry work. The active timer prevents hibernation during a round;
  do not depend on a timer surviving eviction. Hibernated lobby connections can
  use WebSocket attachments; waking a previously running checkpoint pauses it.
  Apply each transition through the serialized commit path from Task 3.
  On failed clock refresh or wall-clock changes, reject fixes and request a
  new probe rather than extending location lifetime.
  A resume check times out after `10000 ms`; failure/cancel stops collection
  and keeps the round/grace clock paused. Use Task 2's `distanceBetween` for
  trial measurements; do not duplicate the proximity formula in TypeScript.
- [ ] **Step 4: Run the targeted commands, all Worker tests, and `npm run typecheck`.**
  Expect stale-data, retry, stream, resume, recovery, and 24-hour deletion checks
  to pass. Test alarm retries for idempotence.
- [ ] **Step 5: Commit as `feat(server): resolve fresh observations safely`.**

## Task 5: Deliver the two-iPhone location trial

**Files:** Create client connection, location, and trial modules and tests,
`src/client/app.ts`, `src/client/styles.css`, the PWA manifest/icons, and
`docs/playtests/two-iphone-trial.md`. Extend `index.html` and protocol as needed.

**Interfaces:**
- Consumes Task 4's authenticated stream, clock probes, and trial samples.
- Produces `connectMatch(credentials: SessionCredentials, handlers: ConnectionHandlers): MatchConnection`.
  `MatchConnection` exposes `send(message: ClientMessage): void` and `close(): void`.
- Produces `startLocation(onFix: (fix: PositionReport) => void, onStatus: (status: LocationStatus) => void): () => void`.
  Its return function stops collection and releases resources.
- Produces `addTrialSample(summary: TrialSummary, sample: TrialSample): TrialSummary`
  and `exportTrialSummary(summary: TrialSummary): string`.
- Produces `mountApp(root: HTMLElement): () => void` with create/join and trial views.
  The host can join as a player without another phone.

- [ ] **Step 1: Add failing browser tests with injected browser API mocks.**

```ts
it("exports measurements without coordinates", () => {
  const text = exportTrialSummary(twoIphoneSummary);
  expect(text).toContain("iPhone");
  expect(text).not.toMatch(/latitude|longitude|token|playerName/);
});
```

  Define the `twoIphoneSummary` fixture in this test file, including both device
  labels, reference distance, and sample count. Test permission denial, absent
  wake-lock support, released locks, hidden-page suspension, cached fixes, and
  backward clock changes. Test one fresh fix during resume checking without
  showing running state. A changed `streamId` requires a snapshot; a cursor gap
  requests one; private global event gaps alone do not.
  A pending geolocation callback after stopping must not send or aggregate a
  fix. Test declined trial consent, duplicate fixes, and capture-to-receipt
  diagnostics in the exported aggregate summary.
- [ ] **Step 2: Run `npm run test:unit -- src/client/connection.test.ts src/client/location.test.ts src/client/trial.test.ts`.**
  Expect failures for the new browser behaviors.
- [ ] **Step 3: Implement the connection and trial view.**
  Use first-frame authentication and same-origin URLs. Keep credentials in
  `sessionStorage`; never render them or include them in exports.
  Use `watchPosition` with high accuracy and zero maximum age. If fresh callbacks
  stop while visible, permit one outstanding `getCurrentPosition` request with
  zero maximum age and a `5000 ms` timeout; check once per second.
  Preserve browser capture timestamps and reject repeated fixes. Stop watchers
  and prevent new fallback requests on leave, hide, pause, canceled resume,
  and end. `getCurrentPosition` has no cancellation API; invalidate its callback
  generation and discard late callbacks after stopping.
  Make requests during a host resume check only with the user's prior consent.

  Display distance, uncertainty, age, update gaps, entered reference separation,
  and explicit connection/permission/clock errors. Label recommendations as
  provisional and device-specific. Export summaries only after user action.
  Configure standalone PWA metadata and 192/512-pixel icons. Installation does
  not require a service worker; omit offline caching in this online-only version.
- [ ] **Step 4: Run the targeted tests, `npm run typecheck`, and `npm run build`.**
  Expect lifecycle/error/export assertions to pass and the manifest/icon assets
  to appear in `dist/`. Document how to test the deployed HTTPS build on exactly
  two iPhones, including tab versus installed-PWA mode.
- [ ] **Step 5: Commit as `feat(client): add the two-iPhone location trial`.**

## Task 6: Deliver playable test rounds and host faction controls

**Files:** Create `src/client/views.ts` and `src/client/app.test.ts`.
Extend client app/styles, protocol, and `test/worker/match.test.ts`.

**Interfaces:**
- Consumes PlayerSnapshot, EngineEvent, MatchConnection, and LocationStatus.
- Produces `renderMatch(root: HTMLElement, snapshot: PlayerSnapshot, actions: MatchActions): void`.
- `MatchActions` has `start`, `pause`, `beginResume`, `cancelResume`, `end`,
  `configure`, `setFaction(playerId: string, faction: Faction)`, and `leave`.
  Commands carry stable IDs; retry uses the same ID.
- `feedback_seen` acknowledges an accepted event only after updating a visible
  player interface. The server records elapsed authority time and aggregate
  success/failure counts without coordinates.

- [ ] **Step 1: Add failing UI and round-flow tests.**

```ts
it("shows testing mode and host-only faction controls", () => {
  renderMatch(root, hostTestSnapshot, actions);
  expect(root.textContent).toContain("Testing mode");
  expect(root.querySelector('[data-action="set-faction"]')).not.toBeNull();
  renderMatch(root, playerTestSnapshot, actions);
  expect(root.querySelector('[data-action="set-faction"]')).toBeNull();
});
```

  Define snapshots/actions as local typed fixtures. Assert no coordinate map,
  faction name and symbol without color dependence, visible attack start and
  interruption reasons, and distinct manual-change versus conversion messages.
  Test missing audio/haptic APIs without losing visual feedback.
  During pause, the remaining clock and grace stay fixed. A lost command reply
  retries its existing ID and does not change faction or grace twice.
  Normal mode rejects live overrides even if a client sends a forged command.
  In testing mode, a two-phone round keeps running with an absent faction.
  Include a full request/report/resolve/update/ack flow using synthetic fixes
  in the Worker tests; do not send synthetic fixes from production UI.
- [ ] **Step 2: Run `npm run test:unit -- src/client/app.test.ts && npm run test:worker -- test/worker/match.test.ts`.**
  Expect the new interface and two-player flow assertions to fail.
- [ ] **Step 3: Implement the approved views and controls.**
  Default the lobby to test mode; let the host select normal mode there.
  Require a complete parameter set before any gameplay round. Keep test values
  labeled `Uncalibrated`; require the host's measured-parameter approval before
  a normal round. Freeze settings while running or paused.
  Disable redundant same-faction controls, and show authoritative command
  outcomes. Send visibility-qualified feedback acknowledgements after a rendered
  frame, not upon receiving a packet. Use acknowledgement elapsed time as a
  conservative upper bound on display delay; do not label it one-way network
  latency. Treat missing acknowledgements as failures in latency summaries.
  Explain location use and the agreed play area before collection. Starting a
  round requests fresh fixes with consent; it does not require a trial first.
  Require the same active/fresh observation checks as the selected round mode.
  Expose a player leave action without a score or other gameplay penalty.
- [ ] **Step 4: Run the targeted tests, `npm run typecheck`, and `npm run build`.**
  Expect host-only overrides, grace, mode isolation, feedback, and timer controls
  to pass. Verify generated player payloads omit opponent coordinates.
- [ ] **Step 5: Commit as `feat(client): add host-controlled test rounds`.**

## Task 7: Verify delivery and prepare the physical trial

**Files:** Create `README.md` and `.github/workflows/ci.yml`. Complete
`docs/playtests/two-iphone-trial.md`. Extend existing tests for remaining
delivery checks; do not create another application or test framework.

**Interfaces:**
- Consumes the scripts and delivered trial/test-round workflows from Tasks 1-6.
- Produces a reproducible software verification command and a separate field
  checklist. No physical measurements come from an automated test.

- [ ] **Step 1: Add failing delivery assertions to existing tests.**
  Check default test mode, expired credentials, coordinate-free exports,
  disconnected/inactive nearby-count exclusions, restart recovery, and manifest
  asset delivery through the Worker. Assert latency summaries use both intended
  recipients and count missing feedback as failure.
- [ ] **Step 2: Run `npm test`.**
  Expect the added delivery assertions to identify any remaining omissions.
- [ ] **Step 3: Complete software behavior and operating instructions.**
  Configure CI to install the chosen Node/Gleam toolchains, use `npm ci`, and run
  tests, types, browser build, and Worker dry-run bundling. Keep credentials out
  of CI and source; do not add automatic deployment.

  Document authenticated Cloudflare deployment as a separate user-approved
  operation, and identify HTTPS/origin requirements. Document the two-iPhone
  sequence: join, enter device details, measure marked separations, move
  together/apart, test visibility/connection failures, export an opted-in summary,
  enter provisional parameters, start a two-player test round, and change
  factions from the host phone. Make no Android accuracy claim.
  Explain that normal six-player comprehension/latency tests and physical
  parameter approval remain later work.
- [ ] **Step 4: Run `npm test && npm run typecheck && npm run build && npm run check:bundle`.**
  Expect all software checks and production bundling to pass. If deployment has
  explicit approval, deploy and check HTTPS responses before the field trial;
  otherwise record deployment as pending, not completed.
- [ ] **Step 5: Commit as `chore: prepare outdoor trial delivery`.**

## Completion boundary

Software completion means the compiled rules, authority, PWA, trial workflow,
and testing-mode controls work with the automated checks above. It does not
mean GPS is accurate enough, both mobile platforms have been field-tested,
or the later gameplay targets have been achieved.

The user performs the initial physical trial with two iPhones. Record those
results as a separate, opt-in measurement report without raw coordinates.
Use the evidence to select parameters and decide when to organize the later
six-player playtest.

## Planning references

- [Cloudflare's current Vitest integration](https://developers.cloudflare.com/workers/testing/vitest-integration/write-your-first-test/)
- [Vite setup](https://vite.dev/guide/)
- [Zod schemas](https://zod.dev/api)
- [Gleam JavaScript declarations](https://github.com/gleam-lang/gleam/blob/main/changelog/v1.1.md)
- [PWA installation requirements](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)
