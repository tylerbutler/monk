# Beryl Protocol Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Monk's custom connection lifecycle with beryl_protocol, Roost, and the official Phoenix client while preserving private state and durable command guarantees.

**Architecture:** Compile a small channel bridge in the existing Gleam package. The Durable Object executes its ordered actions and retains game authority; a Phoenix browser adapter handles connection lifecycle while Monk keeps snapshot recovery and stable command IDs.

**Tech Stack:** Gleam 1.19.0 targeting JavaScript, TypeScript, Svelte, Cloudflare Durable Objects, Roost, beryl_protocol, Phoenix 1.8.16, Vitest, and Playwright.

**Spec:** [Approved integration design](../specs/2026-11-01-beryl-protocol-integration-design.md).

**Status:** Implemented and software-verified on `main`, as the user requested.
Physical phone testing remains pending.

## Global Constraints

- Replace both ends. No old wire protocol, capability negotiation, long polling, or compatibility adapter.
- Keep room HTTP APIs, storage format, game rules, authorization, privacy, and recovery-as-paused behavior.
- Keep Node and Gleam pins. Add dependencies to the existing build; do not install the BEAM-only beryl runtime.
- Use beryl commit `0a778cafec53dfff0725de8b53e2da20d58da032`, path `packages/beryl_protocol`, and Roost commit `17a2db06b147c82a77fc76cbbc21fee6fe043c7e`.
- One `match:<code>` channel per connection; at most 64 pending protocol operations.
- Authorization deadline: 5,000 ms. Client heartbeat: 25,000 ms. Server heartbeat timeout: 60,000 ms.
- Inbound frames: at most 16,384 UTF-8 bytes. Attachment budget: 16,000 UTF-8 bytes.
- Command reply timeout: 5,000 ms. At most five automatic attempts per join; keep unresolved IDs for explicit retry.
- Credentials go only in join payloads. Keep tokens, coordinates, and application payloads out of protocol attachments and logs.
- Use existing test runners. Keep browser retries, traces, video, and screenshots disabled; do not upload authenticated traffic.
- Work in an isolated implementation worktree. Do not deploy intermediate commits or add commit attribution trailers.

## Review Focus

- A hidden phone returns during rejoin or a snapshot response is lost: recover without queued positions, resumed collection without consent, replayed celebration, or a permanent recovery state.
- A late response from an old socket or join arrives: it cannot change the new view or resolve the new request.
- Frequent valid position pushes arrive without heartbeats: operations must finish, and the connection must still expire.
- A command commits before attachment serialization or socket sending fails: retry returns the saved outcome without a second mutation.
- One of several connections for a player closes: retain influence until the last authorized joined connection closes; explicit game leave still revokes player authority.

Each condition has an explicit test below.

## File responsibilities and sequence

| Files | Responsibility |
| --- | --- |
| `rules/gleam.toml`, `rules/manifest.toml` | Commit-pinned portable dependencies and generated lockfile. |
| New `rules/src/monk_rules/channels.gleam`, `channels_ffi.mjs` in the same directory | Roost normalization, beryl transitions, ordered host actions, and validated JSON interop. |
| `src/shared/protocol.ts` | Join schemas and typed application payloads; no old authentication exchange. |
| `src/worker/index.ts`, `src/worker/match-authority.ts` | Phoenix routing, authorization, action execution, attachments, deadlines, and application dispatch. |
| `src/client/connection.ts`, `src/client/app.svelte.ts` | Phoenix lifecycle, readiness, transient sends, and one controller-owned pending-command map. |
| New `src/worker/channels.test.ts` | Pure bridge checks using generated JavaScript. |
| New `test/worker/phoenix-transport.ts`, `test/worker/channels.test.ts`; existing Worker helpers/tests | Actual Phoenix client through Workers-runtime WebSockets, plus fault and eviction checks. |
| New `test/phoenix-socket.ts`; existing connection/app tests | Browser WebSocket test double beneath the real Phoenix implementation. |
| `test/e2e/fixtures.ts`, new `test/e2e/connection.spec.ts`, `README.md` | Browser protocol assertions, connection recovery, and setup documentation. |

Implement Tasks 1-5 in order. Tasks 2 and 3 form one wire cutover on the
feature branch: do not add temporary compatibility code to make an
intermediate commit deployable.

### Task 1: Portable Gleam bridge

**Files:** Modify `rules/gleam.toml` and `rules/manifest.toml`. Create
`rules/src/monk_rules/channels.gleam`,
`rules/src/monk_rules/channels_ffi.mjs`, and `src/worker/channels.test.ts`.

**Interfaces:**

- `new_connection(epoch: String, now: Int) -> Result(protocol.State, HostError)`.
- `receive_text(state, data: String, now: Int) -> Result(Transition, HostError)`.
- `join_accepted(state, operation, payload: String, now)`, `join_rejected(state, operation, payload: String, now)`, `reply(state, operation: Option(protocol.Operation), payload: String, succeeded: Bool, now)`, `push(state, topic: String, event: String, payload: String, now)`, `cleaned_up(state, operation, now)`, `expire(state, now)`, and `disconnect(state, now)` return `Result(Transition, HostError)`.
- `snapshot(state, now) -> Result(String, HostError)`, `restore(snapshot: String, now: Int, elapsed: Int) -> Result(Transition, HostError)`, and `next_deadline(state) -> Int`, with `-1` for no deadline.
- `Transition` contains `state: protocol.State` and `actions: List(Action)`. Actions are `Authorize(operation, topic, payload: Dynamic)`, `Deliver(operation: Option(protocol.Operation), topic, event, payload: Dynamic)`, `Cleanup(operation, topic)`, `SendText(data)`, `Disconnect(reason)`, and `Schedule(deadline: Option(Int))`.
- `HostError` distinguishes protocol, decode, encode, and invalid-JSON-payload errors. Reuse the upstream error types as variant fields.

- [x] **Step 1: Add failing bridge tests.** Use the actual generated module,
  a local Result-unwrapping helper, and Roost-compatible JSON frames.
  Include this deadline transition:

  ```ts
  const state = unwrap(bridge.new_connection("epoch-1", 1_000));
  const heartbeat = unwrap(bridge.receive_text(
    state, JSON.stringify([null, "hb-1", "phoenix", "heartbeat", {}]), 2_000,
  ));
  expect(bridge.next_deadline(heartbeat.state)).toBe(62_001);
  ```

  Also test `authorizes before joining`, `replies once with the supplied ref`,
  `waits for cleanup before replacement authorization`, and
  `restores lost work as a rejoin requirement`. Collect `SendText` actions
  and inspect their decoded frames; do not assert compiler-generated tags.

- [x] **Step 2: Run the tests and confirm failure.**
  Run `npm run build:rules && npm run test:unit -- src/worker/channels.test.ts`.
  Expect a missing bridge/module failure before implementation.

- [x] **Step 3: Add the locked dependencies and bridge.** Use the spec's Git
  configuration and a direct `gleam_json = ">= 3.1.0 and < 4.0.0"` dependency.
  Run `cd rules && gleam deps download` to generate the manifest.
  Use the upstream portable example as a reference, omitting binary support
  and demo authorization. Resolve `AdmitJoin` through
  `AdmissionFinished(True)` before exposing later actions. Expose cleanup
  barriers to the host. Configure the exact global limits.

  The FFI helper converts a JSON string into the JSON representation expected
  by the bridge and returns a Gleam Result. Preserve parse errors; do not
  use assertions that turn malformed payloads into a process failure.
  Follow declarations generated by the pinned compiler rather than copying
  the example's older JavaScript constructor checks.

- [x] **Step 4: Verify the bridge.**
  Run the Step 2 command and
  `cd rules && gleam format --check src/monk_rules/channels.gleam`.
  Expect passing tests and formatting, with no engine source changes.

- [x] **Step 5: Commit the deliverable.**
  Stage the five listed files and commit with
  `feat: add portable channel protocol bridge`.

### Task 2: Durable Object channel host and wire cutover

**Files:** Modify `package.json`, `package-lock.json`,
`src/shared/protocol.ts`, `src/shared/protocol.test.ts`,
`src/worker/index.ts`, `src/worker/match-authority.ts`,
`test/worker/helpers.ts`, and affected tests in
`test/worker/{match,recovery,history,awards,round-results}.test.ts`.
Create `test/worker/phoenix-transport.ts` and
`test/worker/channels.test.ts`.

**Interfaces:**

- Consume the bridge from Task 1. Alias its generated state and transition
  types as `ProtocolState` and `ChannelTransition`; do not recreate them.
- Export `channelJoinSchema` with strict `hostToken` and `playerToken` fields
  using the existing token schema; derive `ChannelJoin`.
- Export `joinReplySchema` and `JoinReply`:
  `{ identity: { playerId: string | null; canHost: boolean; expiresAtMs: number }, state: Extract<ServerMessage, { type: "snapshot" }> }`.
- Keep version-1 application `ClientMessage`/`ServerMessage` payloads,
  excluding `authenticate` and `authenticated`. The Phoenix event name
  equals `payload.type`; reject disagreement.
- Extend `ConnectionHandlers` with `onReady(): void` and
  `onCommandUnconfirmed(commandId: string): void`. Keep
  `MatchConnection.send(message): void` and `close(): void`.
- In `MatchAuthority`, use
  `applyChannel(socket: WebSocket, transition: ChannelTransition): Promise<void>`,
  `checkpointConnection(socket: WebSocket): void`, and
  `dispatchMessage(socket, actor: VerifiedActor, message: ClientMessage, operation): Promise<void>`.
  The operation is the bridge's optional operation capability.
  Keep active state in `protocols: Map<WebSocket, ProtocolState>`.
- Worker `connect(credentials)` returns the existing `send`, `next`,
  `messages`, and raw `socket` test access, plus `channel`, `joined`, and
  the current test transport. `send` and `next` translate only application
  payloads; Phoenix owns lifecycle framing.

- [x] **Step 1: Add the test transport and failing host tests.** Dial the
  real Worker using `SELF.fetch` and a same-origin `Origin` header.
  Replace only WebSocket dialing beneath the actual Phoenix client.
  Resolve `.join()` and `.push()` through their `ok`, `error`, and `timeout`
  callbacks. Add a test whose key assertions are:

  ```ts
  expect(client.joined.identity.canHost).toBe(true);
  expect(client.joined.state.type).toBe("snapshot");
  expect(client.joined.state.snapshot.ownPlayerId).not.toBeNull();
  ```

  Add named tests for URL credentials, duplicate/unknown/version query
  parameters, missing/cross-origin requests, wrong topics, wrong-room tokens,
  invalid application fields, binary frames, and the 16 KiB boundary.
  Assert rejected traffic causes no application mutation.
  Add `unauthorized sockets expire at the five-second deadline`, using the
  real alarm with explicit host time rather than waiting five seconds.

- [x] **Step 2: Confirm the new protocol tests fail.**
  Run `npm run build:rules && npm run test:worker -- test/worker/channels.test.ts`.
  Expect missing Phoenix or failed join/route assertions, not a harness error.

- [x] **Step 3: Add Phoenix and its declarations.**
  Use `npm install --save-exact phoenix@1.8.16` and
  `npm install --save-dev --save-exact @types/phoenix@1.6.8`.
  Commit the package-manager-generated lockfile. Implement the shared schemas
  and handler contracts above; add strict join/reply parsing tests.

- [x] **Step 4: Implement routing and the channel host.** Accept only GET
  upgrades at `/api/matches/<code>/socket/websocket?vsn=2.0.0`.
  Preserve HTTPS and same-origin checks. Reject unknown or duplicate query
  keys with 403, missing/unsupported versions with 400, and non-upgrade
  requests with 426. Keep HTTP room routes unchanged.

  Store active protocol states by WebSocket. Execute bridge actions within
  the existing serialized queue. Authenticate `Authorize`, establish a new
  stream, and return the validated `JoinReply`. Checkpoint before outbound
  actions. Complete cleanup before processing later external input.
  Run application delivery only for the authorized channel and actor.

  Extract the existing application branches into `dispatchMessage` without
  changing engine or storage behavior. A committed host command replies with
  its typed `update` payload, including outcome/state/events; broadcast to
  other recipients using their private views. Replay saved outcomes for
  duplicate IDs. Reply to snapshot requests with a typed `snapshot`.
  A successful non-command delivery receives an empty `{}` acknowledgment
  after its effects complete; it does not increment the application stream.
  This settles Phoenix requests and releases core reply capabilities.
  Deliver typed errors through error replies or authorized error pushes.

  Route application sends through the bridge. Await snapshots, errors,
  replies, and broadcasts; do not leave async sends outside the operation
  queue. Use one application stream counter across state replies and pushes.
  Remove first-frame authentication, capability flags, and `authTimers`.

- [x] **Step 5: Implement bounded attachments and deadline recovery.**
  Use the spec's versioned envelope and 16,000-byte budget. Rehydrate
  authority before protocol restoration and reject revoked actors.
  Let beryl invalidate lost work. Establish a new stream and snapshot after
  authority reconstruction, preserving recovery-as-paused.
  Compute one alarm from auth, protocol, game-recovery, and expiry deadlines.
  Keep the existing active-game tick; use no per-socket heartbeat timers.
  Reject oversized frames with 1009, binary with 1003, and invalid restored
  state with 1011. Clean up malformed attachments without parsing them again
  in the close callback.

  For transport/channel cleanup, count other authorized joined connections
  before suspending a player. Keep explicit game leave separate. Room expiry
  must not let cleanup save a new record after `deleteAll()`.

- [x] **Step 6: Migrate existing Worker tests and verify.** Make helpers use
  real Phoenix joins and replies. Replace old authentication injections and
  old route expectations. Remove old-client capability tests in history and
  results; keep their authorization and private-data assertions.
  Change the awards message test to a normal authorized second connection.
  Keep existing saved-record coverage tests: this task does not redesign
  record loading or awards coverage.

  Adapt the malformed-JSON test to assert no state change, no sensitive log
  output, and a working subsequent snapshot request.
  Run `npm run test:unit -- src/shared/protocol.test.ts` and
  `npm run build:rules && npm run test:worker`. Expect all selected tests
  to pass. Browser client migration follows in Task 3; do not deploy this
  intermediate commit.

- [x] **Step 7: Commit the host cutover.**
  Stage the listed production and Worker-test files and commit with
  `feat: host Phoenix channels in durable objects`.

### Task 3: Phoenix browser adapter and pending commands

**Files:** Modify `src/client/connection.ts`,
`src/client/connection.test.ts`, `src/client/app.svelte.ts`, and
`src/client/app.test.ts`. Create `test/phoenix-socket.ts`.

**Interfaces:**

- Consume `JoinReply`, application schemas, and `ConnectionHandlers` from
  Task 2. Keep `connectMatch(credentials, handlers): MatchConnection`.
- The controller owns
  `Map<string, { command: HostCommand; unconfirmed: boolean }>`.
- `onReady()` resends unresolved controller commands using their existing
  IDs after the adapter has applied a valid snapshot.
- `onCommandUnconfirmed(id)` marks that controller entry for explicit retry.
  It does not report a dead connection or discard the command ID.
- The test WebSocket supplies native event properties, ready states, send,
  and close. Helpers wrap/unpack Phoenix frames for UI fixtures; they do not
  emulate channel joins, rejoining, or retry behavior.
  Its test fixture's `positionFrames()` helper returns decoded position
  application messages from the sent frames.

- [x] **Step 1: Add failing adapter tests beneath the real Phoenix client.**
  Extend the WebSocket double so Phoenix can use its native event surface.
  Test `waits for a validated join snapshot before becoming ready`:

  ```ts
  expect(statuses.at(-1)?.state).not.toBe("connected");
  expect(positionFrames()).toHaveLength(0);
  // Deliver the matching successful join reply with a valid snapshot.
  expect(statuses.at(-1)?.state).toBe("connected");
  ```

  Add tests named `does not buffer positions during recovery`,
  `ignores replies from an obsolete socket or join`,
  `requests one snapshot per unresolved stream gap`, and
  `private event-number gaps do not trigger recovery`.
  Add `missing heartbeat replies trigger reconnect and stop position sends`,
  advancing fake timers through the real Phoenix heartbeat cycle.
  Add `a timed-out snapshot request reconnects instead of remaining blocked`.
  Keep the clock diagnostic failure tests.

- [x] **Step 2: Confirm adapter failures.**
  Run `npm run test:unit -- src/client/connection.test.ts`.
  Expect failed Phoenix-frame/readiness assertions with the old adapter.

- [x] **Step 3: Implement `connectMatch`.** Use `Socket` and one channel,
  explicit WebSocket transport, and `heartbeatIntervalMs: 25_000`.
  Keep credentials in channel params. Do not configure long-poll fallback.
  Validate the join response, deliver its snapshot, report ready, then invoke
  `onReady`. Block transient sends unless the socket is connected, the
  channel is joined, and a validated snapshot baseline exists.

  Use Phoenix for reconnect/rejoin and request timeouts. Delete the native
  reconnect timers and the polling command-retry interval.
  Guard callbacks with connection/join generation and disposal state.
  Parse application messages from both push events and request replies.
  Ignore empty non-command acknowledgments.

  Allow one snapshot request in flight. If it times out after 5,000 ms,
  reconnect through Phoenix's public disconnect callback and `connect()`
  API, then require a fresh authorized join. Do not retain a recovery flag
  that can leave a healthy socket blocked without another recovery attempt.

  Retry command timeouts and `storage_failed` responses with the same ID,
  counting the initial send toward the five attempts per command per join.
  Do not retry known permission/validation/capacity rejections.
  Handle `accepted: false` as a final saved outcome.
  Pause retries during recovery and let `onReady` restart unresolved work.
  On exhaustion, call `onCommandUnconfirmed`; do not set connection status
  to failed. Drop transient messages instead of entering Phoenix's buffer.
  Keep diagnostic clock timeouts independent of connection health.

- [x] **Step 4: Migrate controller state and its test harness.** Remove
  `authenticated` handling; resend pending commands from `onReady`.
  Resolve outcomes once, and clear known final error responses by command ID.
  Render an explicit retry action for unconfirmed commands that reuses the
  stored ID. Keep pending faction controls protected against a new-ID retry.
  Preserve collection shutdown on lost readiness, consent, visibility,
  snapshot/live-update distinctions, and diagnostic clock behavior.

  Adapt the central `browserApp` fixture to perform a real Phoenix join over
  the test WebSocket. Keep application-level `receive` and command inspection
  helpers so unrelated UI assertions do not need a rewrite.
  Add `hidden recovery does not restart collection or replay awards`,
  `unconfirmed retry keeps its ID`, and
  `late old-connection replies do not unlock faction controls`.

- [x] **Step 5: Verify the browser integration.**
  Run `npm run test:unit -- src/client/connection.test.ts src/client/app.test.ts`
  and `npm run typecheck`. Expect passing tests and type checks.
  Check that adapter disposal cancels its request callbacks and leaves no
  reconnect or heartbeat activity after the controller closes it.

- [x] **Step 6: Commit the browser cutover.**
  Stage the five listed files and commit with
  `feat: use Phoenix for match connections`.

### Task 4: Recovery and delivery-failure matrix

**Files:** Extend `test/worker/phoenix-transport.ts`,
`test/worker/channels.test.ts`, and `test/worker/recovery.test.ts`.
Fix only implementation defects exposed by these tests in the bridge,
connection adapter, or `src/worker/match-authority.ts`.

**Interfaces:** Extend the test transport with bounded controls to drop one
selected reply, suppress heartbeat delivery, and close one connection.
Retain frame inspection in memory only. Use `evictDurableObject`,
`runInDurableObject`, and `runDurableObjectAlarm` from `cloudflare:test`.
Use the real stored record and exported protocol state for fixtures.

- [x] **Step 1: Add failing fault tests with recorded state assertions.**
  Include `commit survives a lost command reply and eviction`:

  ```ts
  expect(retried.outcome).toEqual(committed.outcome);
  expect(after.events.filter(e => e.type === "manual_faction_change"))
    .toHaveLength(before.events.filter(e => e.type === "manual_faction_change").length + 1);
  ```

  Apply a faction change with a stable ID, let the transaction commit, drop
  its reply, evict, rejoin, and retry. Also interrupt once after commit but
  before attachment serialization, and once before `socket.send`; use scoped
  spies, not production fault-injection flags.

  Add `valid position traffic cannot keep a heartbeat-dead connection alive`
  and `successful reports do not retain pending reply operations`.
  Deliver more than 64 successful reports without a heartbeat and assert
  pending operations do not accumulate, inspecting the core's public
  `pending_count` against the host's protocol state. At 60,001 ms after the
  last heartbeat, run the real alarm and assert closure/cleanup.

  Add `eviction preserves membership but resets authority to paused`,
  `lost operations require authorized rejoin`,
  `revoked actors cannot resume after eviction`, and
  table-driven invalid-version, corrupt, oversized, and backward-time
  attachment cases. Assert attachments exclude tokens and coordinates.

  Add `closing one of two player connections preserves the other`,
  `closing the last connection suspends without roster removal`, and
  `explicit game leave revokes player authority on remaining connections`.
  Preserve results/history privacy for departed players.

- [x] **Step 2: Run the targeted fault suite.**
  Run `npm run build:rules && npm run test:worker -- test/worker/channels.test.ts test/worker/recovery.test.ts`.
  Confirm each new test either exposes its intended fault or proves that the
  earlier host implementation already covers it. Do not weaken assertions to
  obtain a failing baseline.

- [x] **Step 3: Fix only exposed defects.** Keep one action interpreter,
  alarm owner, and pending-ID owner. Recompute deadlines after restore and
  cleanup; do not extend heartbeats on application traffic. Preserve durable
  outcomes when a later connection action fails. Use core operation identity
  rather than wire refs for stale-work rejection.

- [x] **Step 4: Verify the same targeted suite passes.**
  Run the Step 2 command. Expect all fault and existing recovery tests to
  pass without longer timeouts, sleeps for heartbeat periods, or retries.
  Restore spies, close test sockets, and reset Workers state after each test.

- [x] **Step 5: Commit the recovery checks and fixes.**
  Stage only the files changed for this task and commit with
  `test: cover channel recovery and lost replies`.

### Task 5: Browser cutover and final verification

**Files:** Modify `test/e2e/fixtures.ts` and `README.md`.
Create `test/e2e/connection.spec.ts`. Update build/CI configuration only if
the existing rules build or test discovery fails to include the new modules;
do not add a separate pipeline.

**Interfaces:** Reuse the existing `duel` fixture and local Wrangler server.
Inspect only match-channel application frames. For `phx_reply`, validate
`payload.response`; for application pushes, validate their payload. Skip
heartbeats and join metadata when waiting for a committed settings update.

- [x] **Step 1: Add failing browser recovery coverage.** Forward traffic to
  the real backend through Playwright's WebSocket routing and force one
  transport close after both players join. Do not mock server responses.
  Assert the client reconnects to the same room and player, receives fresh
  state, and does not duplicate a host command or replay a celebration.
  Include recovery while hidden: location sending stays stopped until the
  visible, ready, consented state and a new location report.

- [x] **Step 2: Run the new browser tests in both projects.**
  Run `npm run test:e2e -- test/e2e/connection.spec.ts --project=chromium --project=webkit`.
  Expect any remaining readiness or fixture-framing mismatch to fail with
  an application assertion. Fix fixture setup errors before judging behavior.

- [x] **Step 3: Update fixture framing and documentation.** Change the
  committed-settings predicate to inspect the Phoenix application response;
  do not accept a heartbeat as an application message or record raw traffic.
  Document the libraries, Git package path, heartbeat/recovery behavior,
  command retry guarantee, and lack of old-client support in `README.md`.
  Keep existing physical-device limitations and browser privacy settings.

- [x] **Step 4: Run the complete checks once targeted checks pass.**

  ```sh
  npm test &&
  npm run typecheck &&
  npm run build &&
  npm run check:bundle &&
  npm run test:e2e
  ```

  Expect all unit, Workers, Chromium, and WebKit checks to pass. Check bridge
  formatting with
  `cd rules && gleam format --check src/monk_rules/channels.gleam`.
  Confirm `check:bundle` includes portable dependencies, excludes BEAM-only
  code, and performs no deployment. Run `git diff --check`.
  Leave unrelated generated brand assets unchanged.

- [x] **Step 5: Commit the browser coverage and documentation.**
  Stage this task's changed files and commit with
  `test: verify Phoenix browser recovery`.

## Completion evidence

Record command results and any real limitations in the implementation
handoff. Report software checks separately from physical phone testing.
Update the spec/plan status after implementation, not before.
No implementation or runtime verification has occurred during plan authoring.

Implementation verification passed: 332 unit tests, 120 Workers-runtime tests,
and 188 Chromium/WebKit browser tests. Type checks, production build, bundle
dry run, bridge formatting, and `git diff --check` passed. The bundle includes
the portable protocol and Roost modules and excludes the BEAM runtime.
Whole-change code review found one deadline defect. A late heartbeat could
renew an expired connection before a delayed alarm; the host now checks
expiry before receiving a frame. Deadline-boundary regression tests and the
complete checks passed after the fix. No minor findings remain deferred.
No deployment or physical phone test was performed.
