# Award Data Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collect server-confirmed, coordinate-free round data for all 14 proposed player awards without changing gameplay or showing award results.

**Architecture:** Add a pure TypeScript collector beside the Worker engine adapter. Persist its versioned summaries and current timing cursors in the existing match transaction before broadcast. Preserve committed totals on recovery and delete them with the room.

**Tech Stack:** Existing TypeScript, Gleam-to-JavaScript engine, Zod, Cloudflare Durable Objects, Vitest, and Cloudflare test tools. No new dependencies.

**Spec:** [Player Awards and Data Collection](../specs/2026-10-07-player-awards-design.md).

**Status:** Proposed implementation plan. Writing this plan does not start implementation.

## Global Constraints

- Use Node 24.21.0 and Gleam 1.19.0 from `mise.toml`.
- Keep the public protocol unchanged.
- Keep the conversion rules unchanged.
- Store award data only inside the match's existing retention period: 24 hours from room creation.
- Retain only the current frame and open-encounter cursors, not a list of frames or observation samples.
- Count server-accepted conversions. A host faction change is not a conversion.
- No historical backfill is part of this plan.
- Keep counterpart IDs and timing cursors server-side.
- Do not add a database, service, dependency, or client analytics stream.
- Exclude winner selection, badges, results UI, exports, scoring cooldowns, accounts, cross-round history, and gameplay changes.
- Use ASD-STE100 where possible. Do not add co-author trailers to commits.

## Review Focus

1. A conversion batch can change an attacker's own faction. Task 2 checks snapshot faction credit and increments outgoing streaks before incoming resets.
2. A late timer or fresh fix after a gap can over-credit time. Task 2 checks exact observation expiry, grace, round expiry, and gap boundaries.
3. Retry or save failure can mutate uncommitted counters. Task 3 checks event replay, repeated command IDs, and transactional failure.
4. Restored or older rooms can claim missing data as a complete round. Task 4 checks recovery closures, partial coverage, and corrupt-record errors.
5. A departed player's summary or private counterpart IDs can disappear or leak. Tasks 3 and 4 check retained summaries, unchanged messages, and complete expiry deletion.

---

## File Map

| File | Responsibility |
| --- | --- |
| Create `src/worker/award-data.ts` | Worker-only schemas, summary types, pure reducer, and recovery function. |
| Create `src/worker/award-data.test.ts` | Exact-time, batch, population, and encounter collection tests. |
| Modify `src/worker/engine.ts` | Coordinate-free `awardFrameFor` adapter over typed Gleam state. |
| Modify `src/worker/engine.test.ts` | Frame eligibility and privacy tests using the real engine. |
| Modify `src/worker/storage.ts` | Nullable legacy field, strict award schema, and record consistency checks. |
| Modify `src/worker/match-authority.ts` | Creation, transactional collection, recovery, and existing lifecycle paths. |
| Create `test/worker/awards.test.ts` | Stored collection, write failure, privacy, and lifecycle integration tests. |
| Modify `test/worker/recovery.test.ts` | Legacy migration, recovery, and expiry cases. |
| Modify `README.md` | Explain collected summaries, missing legacy coverage, privacy, retention, and absence of results UI. |

Do not change `src/shared/protocol.ts`, client components, package manifests,
or Gleam rules. Use `test/fixtures.ts` and `test/worker/helpers.ts`; extend
helpers only when a new integration case cannot use their current interfaces.

## Data Contract

Define these types and signatures in `src/worker/award-data.ts`. Infer the
persisted types from strict Zod schemas rather than maintaining separate
unchecked storage types. Import `Faction`, `MatchPhase`, and `EngineEvent`
from the existing shared protocol.

```ts
type AwardFrame = {
  atMs: number;
  eventSeq: number;
  phase: MatchPhase;
  remainingMs: number;
  dwellMs: number | null;
  players: {
    id: string;
    label: string;
    faction: Faction;
    graceMs: number;
    usableUntilMs: number | null;
  }[];
};

type PlayerAwardData = {
  label: string;
  conversionsMade: number;
  conversionsReceived: number;
  conversionsByFaction: Record<Faction, number>;
  conversionPeerIds: string[];
  influencePeerIds: string[];
  currentConversionStreak: number;
  longestConversionStreak: number;
  incomingEncounters: number;
  outgoingEncounters: number;
  rangeBreaksReceived: number;
  closeCallsReceived: number;
  underdogConversions: number;
  eligibleMs: number;
  currentUnconvertedEligibleMs: number;
  longestUnconvertedEligibleMs: number;
  pendingComebackEligibleMs: number | null;
  fastestComebackEligibleMs: number | null;
};

type AwardData = {
  version: 1;
  coverage: "complete" | "partial";
  startedAfterEventSeq: number;
  lastProcessedEventSeq: number;
  lastFrame: AwardFrame;
  players: Record<string, PlayerAwardData>;
  openEncounters: Record<string, {
    startedEventSeq: number;
    targetId: string;
    startedAtMs: number;
    dwellMs: number;
  }>;
  lastConversionBatch: {
    lastEventSeq: number;
    atMs: number;
    attackerIds: string[];
  } | null;
};

createAwardData(
  frame: AwardFrame, coverage: AwardData["coverage"]
): AwardData;

advanceAwardData(
  data: AwardData, frame: AwardFrame, events: readonly EngineEvent[],
  eligibilityResetIds?: readonly string[]
): AwardData;

recoverAwardData(data: AwardData, restored: AwardFrame): AwardData;
```

Export `awardDataSchema`, the types, and these functions. Validate counters,
IDs, timestamps, and arrays with the same constraints used by existing
protocol fields. Require unique peer and latest-batch IDs, exactly three
faction counters, and safe nonnegative integer counts and durations.
Use `null` for no completed comeback, not a fabricated zero.
Default `eligibilityResetIds` to an empty array. This internal input clears
timing for explicit suspension or an unusable report even when a paused
engine has no observation or interruption event to reveal the change.

The frame's roster holds at most 100 current players. Historical player
summaries and peer sets can exceed the current roster size; retain them.
Reject unsupported schema versions, unknown fields, impossible cursor order,
and open encounters with unknown participants. Do not coerce corrupt input.

## Task 1: Add the Typed Collection Frame

**Files:** Create schema/type definitions in `src/worker/award-data.ts`;
modify `src/worker/engine.ts` and `src/worker/engine.test.ts`.

**Interfaces:**
- Consumes: `EngineState`, the typed Gleam player/observation collections, and existing shared protocol types.
- Produces: `awardDataSchema`, the Data Contract types, and `awardFrameFor(state: EngineState): AwardFrame`.

- [ ] **Step 1: Add failing frame tests in `src/worker/engine.test.ts`.**

  | Test | Assertions |
  | --- | --- |
  | `projects award frames without location reports` | With a production-configured round, frame time equals `state.last_at`, phase and event sequence equal the engine state, and roster faction/label/grace agree with its players. A usable fix exposes only its deadline. Recursively assert absence of `latitude`, `longitude`, `accuracyM`, `capturedAtMs`, `distanceM`, and `bearingDegrees`. |
  | `uses engine eligibility rather than radar visibility` | Accuracy at 15 m permits a usable deadline; 15.01 m does not. An expired or absent observation gives `usableUntilMs: null`. Grace stays a separate duration. Ended and restored states have no usable deadlines. |
  | `keeps an unchanged capture deadline in award frames` | Repeated observations with the same normalized expiry retain that deadline. Do not construct a new deadline from the frame time. |

- [ ] **Step 2: Run the failing frame tests.**

  Run: `npm run build:rules && npm run test:unit -- src/worker/engine.test.ts`

  Expected: the new cases fail because the frame adapter is absent.

- [ ] **Step 3: Implement the schemas and `awardFrameFor`.**

  Read `state.last_at`, `state.event_seq`, `state.remaining`, and typed
  parameters without obtaining a browser/server clock. Reuse the existing
  typed faction conversion helper in `engine.ts`. Match
  `proximity.usable`: observation expiry must exceed frame time and accuracy
  must not exceed the configured maximum. Return a null deadline when no
  observation meets that policy. Keep grace separate for interval accounting.
  Export no position or distance data.

- [ ] **Step 4: Run the frame tests and type check.**

  Run: `npm run test:unit -- src/worker/engine.test.ts && npm run typecheck`

  Expected: all cases and type checks pass.

- [ ] **Step 5: Commit the frame contract.**

  Run: `git add src/worker/award-data.ts src/worker/engine.ts src/worker/engine.test.ts && git commit -m "feat: add award collection frames"`

## Task 2: Collect Counts, Encounters, and Eligible Time

**Files:** Modify `src/worker/award-data.ts`;
create `src/worker/award-data.test.ts`.

**Interfaces:**
- Consumes: Task 1's `AwardFrame`, `AwardData`, and existing `EngineEvent`.
- Produces: `createAwardData`, `advanceAwardData`, and `recoverAwardData` with the Data Contract signatures.

- [ ] **Step 1: Add failing pure-reducer tests.**

  Use hand-built frames for exact timing; use real engine transitions from
  `test/fixtures.ts` for conversion-batch and population assertions. Enrich
  fixture conversion events with each target's prior faction, matching the
  authority's existing enrichment; the raw Gleam conversion event leaves
  `oldFaction` null.

  | Test | Inputs and assertions |
  | --- | --- |
  | `counts conversions and unique counterparts` | Three Rock conversions from `p1` to `p2`, with target-only host changes to Scissors between encounters: made 3, received 3, faction counts 3/0/0, one conversion peer each, longest outgoing streak 3. Replaying the same events and frame changes nothing. |
  | `records faction breadth without transferring achievements` | Separate valid conversions as Rock, Paper, and Scissors, with intervening host changes for the attacker: made 3, faction counts 1/1/1, longest streak 1. Host changes add no conversions. These counters support both Hat Trick and All-Rounder. |
  | `resolves simultaneous credit before incoming streak resets` | A Rock/Scissors/Paper conversion chain credits outgoing conversions to snapshot factions, updates each longest streak, then resets affected current streaks to 0. The final batch retains all three attacker IDs. No same-batch comeback completes. |
  | `keeps host changes and departures out of conversion totals` | A host change resets the affected streak and pending comeback; totals stay unchanged. Departure preserves the player's label and accumulated data. Equal display names remain separate IDs. |
  | `tracks unique influence peers and range outcomes` | Repeated attack starts against one counterpart add one unique peer and separate encounter counts. Range interruptions at 26,999/30,000 ms add an escape but no Close Call; 27,000/30,000 ms add both. |
  | `does not award an escape to a converted target` | One incoming attack breaks range while another converts that target in the batch: no escape or Close Call. Location, faction, host, grace, leave, pause, and end reasons add neither measure. |
  | `credits only the previous usable interval` | A usable deadline at 30,000 ms followed by a step at 31,000 ms credits 30,000 ms. A new usable fix at 31,000 ms cannot fill the 1,000 ms gap. Replaying the frame adds 0. |
  | `intersects grace and round deadlines` | With grace 3,000 ms, observation valid to 30,000 ms, and round ending at 10,000 ms, eligible time is 7,000 ms. A step after the round deadline cannot increase it. |
  | `times a comeback with eligibility and pause boundaries` | After receipt at 0, grace lasts to 3,000 ms. Count eligibility from 3,000 to 5,000; pause until 15,000; resume with a fresh observation; make a conversion at 19,000. Fastest comeback is 6,000 eligible ms. An unusable gap cancels the pending attempt. |
  | `cancels paused timing through explicit reset input` | Keep a pending comeback through a pause. Pass the player's ID in `eligibilityResetIds` with no events and an otherwise unchanged paused frame. The pending attempt clears and resume cannot complete it. |
  | `closes unbroken intervals at eligibility loss` | An interval of 5,000 eligible ms, a pause or location gap, and a second interval of 4,000 ms produce a longest interval of 5,000, not 9,000. Total eligible time remains 9,000. |
  | `counts underdog success from one resolution roster` | Pre-batch Rock/Paper/Scissors counts 1/3/2 credit Rock. Counts 2/2/3 credit nobody. Counts 1/0/2 credit Rock. Apply joins/leaves/manual changes before the batch; batch event order does not change credit. |
  | `rejects invalid cursors and unsupported award records` | Negative/fractional durations, unknown fields, duplicate peers, invalid version, missing conversion participants/faction, and backward frames produce explicit errors. A `lastProcessedEventSeq` beyond the frame sequence is invalid. |
  | `recovers without awarding an outage` | Preserve committed counts, longest values, and coverage. Clear open encounters, pending comeback, and current Unbroken time. Keep the conversion streak. Add no elapsed or escape count. |

- [ ] **Step 2: Run the failing collector tests.**

  Run: `npm run test:unit -- src/worker/award-data.test.ts`

  Expected: failures for the missing reducer functions.

- [ ] **Step 3: Implement the pure functions.**

  Create zero counters and null timing results for each roster member.
  Copy structures before updating them; retain departed summaries. Credit
  the interval from `data.lastFrame` to the new frame before processing new
  outcomes, using the spec's eligibility intersection. Close intervals at
  expired observations even when a new observation arrives in that step.

  Ignore events at or below `lastProcessedEventSeq`; validate new event
  order and frame boundaries. Process the accepted conversion events as
  one batch. Accrue pre-batch comeback time, complete existing attempts for
  outgoing-only players, then start or replace attempts for incoming players.
  A player with both outcomes in the batch starts a new pending attempt.

  Track open encounters by attacker, using the start event sequence as
  identity. A terminal conversion or interruption closes that encounter.
  Credit only the exact range reason, exclude converted targets, and use
  the spec's 90% integer comparison. Unknown interruption reasons close an
  encounter without awarding either range measure.

  For population credit, start with the resulting roster and reverse all
  accepted target faction changes using enriched `oldFaction`. This gives
  the post-command, pre-conversion roster, including joins and departures.
  Require a non-null old faction for each accepted conversion. Determine
  the strict smallest positive faction once for the batch.

  During a paused frame, retain pending comeback state without adding time.
  Clear it when a participating player disappears, changes faction through
  a host command, receives a location interruption, or appears in
  `eligibilityResetIds`. A running unusable frame or expired prior fix
  cancels it even without an open encounter.

- [ ] **Step 4: Run collector and engine tests.**

  Run: `npm run test:unit -- src/worker/award-data.test.ts src/worker/engine.test.ts && npm run typecheck`

  Expected: all cases and type checks pass.

- [ ] **Step 5: Commit the pure collector.**

  Run: `git add src/worker/award-data.ts src/worker/award-data.test.ts && git commit -m "feat: collect award counts and eligible time"`

## Task 3: Save Collection in Accepted Authority Transitions

**Files:** Modify `src/worker/storage.ts` and
`src/worker/match-authority.ts`; create `test/worker/awards.test.ts`.

**Interfaces:**
- Consumes: Tasks 1 and 2's frame, schema, and collector; existing `commitRecord`, `loadRecord`, and `MatchAuthority.accept`.
- Produces: `MatchRecord.awardData: AwardData | null`, persisted with the checkpoint and events. No new public messages or endpoints.

- [ ] **Step 1: Add failing persistence and integration tests.**

  Use `runningMatch`, `hostCommand`, `connect`, and `runInDurableObject`
  to read saved data without adding a production export endpoint.

  | Test | Assertions |
  | --- | --- |
  | `saves award counters before announcing conversion` | After a conversion update reaches a client, the saved attacker/target totals, faction counter, peer IDs, and processed sequence agree with that event. Match checkpoint and award frame use the same engine-step boundary. |
  | `keeps ordinary updates and duplicate commands idempotent` | Snapshot requests, feedback acknowledgements, duplicate host command IDs, and exact event replay do not add conversions or encounters. Rejected out-of-order position reports do not alter award data. |
  | `does not publish or retain failed award transitions` | Spy on the Durable Object storage transaction with a one-shot rejection before its write. No accepted conversion update reaches clients and the saved record and in-memory collector stay at the prior boundary. Restore storage; a retry counts the transition once. Use the current storage error response. |
  | `tracks joins and retains departed participants` | A late join starts with zero counters and grace. Leave removes the active frame entry but preserves prior label/counters/peer sets. A new player with that name gets a separate summary. |
  | `cancels paused comebacks without requiring attack events` | Pause with a pending comeback and no open attack. Suspend sharing, close the last player socket, or submit an unusable report while paused. Each path clears the pending attempt before resume. |
  | `does not disclose collection through messages` | Legacy and history-aware snapshots/updates contain no `awardData`, peer sets, open cursors, or new event fields. Existing private-event filtering still holds. |
  | `stores only coordinate-free award data` | Inspect the saved `awardData` recursively: no observation/report objects, raw coordinate fields, capture timestamps, distances, bearings, or frame history. |

- [ ] **Step 2: Run the failing authority tests.**

  Run: `npm run test:worker -- test/worker/awards.test.ts`

  Expected: new cases fail because the stored field and collection hook
  are absent.

- [ ] **Step 3: Extend storage validation.**

  Add `awardData: awardDataSchema.nullable().default(null)` to
  `recordSchema`. Validate that the collection cursor and frame sequence
  do not exceed the checkpoint sequence, and that non-null collection
  frame roster/phase/remaining time agree with the saved checkpoint.
  Retain the existing explicit invalid-record error. Missing legacy data
  is permitted; malformed present data is not.

- [ ] **Step 4: Wire creation and `accept`.**

  Initialize new-room collection from the configured lobby engine frame
  with complete coverage. In `accept`, enrich accepted conversion events
  with names and old factions as it does today, then call the pure collector.
  Build the checkpoint with `next.state.last_at`, the same time used by
  `awardFrameFor(next.state)`, instead of another save-time clock reading.

  Put collection, checkpoint, feedback, outcomes, and events through the
  existing `commitRecord` transaction. Assign in-memory record and engine
  only after success. Keep existing error responses and broadcast order.
  Feedback-only writes retain collection without advancing its frame.

  Tick, alarm, joins, host commands, positions, suspend, leave, and the final
  player socket close must use this path. The existing multiple-socket rule
  remains: closing one socket does not suspend a player with another open
  socket. Do not infer eligibility from `lastKnownPositions`, which can
  retain radar-only fixes.

  Extend the internal method to
  `accept(next: EngineTransition, outcome: CommandOutcome | null = null, sessions?: MatchRecord["sessions"], eligibilityResetIds: readonly string[] = []): Promise<void>`.
  Pass the IDs to `advanceAwardData`. Supply the player's ID for explicit
  suspend, last socket close, and accepted reports with no `gameObservation`
  or gameplay-observation accuracy above the configured maximum. Use the
  normalized observation, which can retain an earlier capture's values,
  rather than a repeated report's replacement values. Rejected report
  sequences must not reset collection. Leave already resets through roster
  removal.

- [ ] **Step 5: Run authority and compatibility tests.**

  Run: `npm run test:worker -- test/worker/awards.test.ts test/worker/history.test.ts test/worker/match.test.ts && npm run typecheck`

  Expected: persisted collection and existing messages/gameplay pass.

- [ ] **Step 6: Commit transactional collection.**

  Run: `git add src/worker/storage.ts src/worker/match-authority.ts test/worker/awards.test.ts && git commit -m "feat: persist award collection with match transitions"`

## Task 4: Complete Recovery, Lifecycle, and Retention Coverage

**Files:** Modify `src/worker/match-authority.ts`,
`test/worker/awards.test.ts`, `test/worker/recovery.test.ts`, and `README.md`.

**Interfaces:**
- Consumes: `recoverAwardData` and nullable `MatchRecord.awardData`.
- Produces: recovery-safe collection across the existing match lifecycle and documented retention limits.

- [ ] **Step 1: Add failing recovery and lifecycle tests.**

  | Test | Assertions |
  | --- | --- |
  | `recovers collected rounds without outage credit` | Evict a running room with saved totals and an open encounter. Restore as paused; totals, best values, labels, and coverage survive. Open encounters, pending comeback, and current Unbroken duration clear. No conversion or escape is invented. Resume starts new eligible intervals. |
  | `starts legacy collection with honest coverage` | Remove `awardData` from saved lobby/running/paused/ended records. Load keeps sessions/events/settings. Lobby initializes complete coverage; the other phases initialize partial coverage at the existing event sequence with zero new counters. |
  | `rejects malformed present award data` | Unsupported version or a collection cursor beyond the checkpoint rejects loading with `Stored match record is invalid.`; the loader does not replace it with null or zeros. |
  | `stops eligibility on explicit suspend and last socket close` | Suspend clears timing without a false escape. Closing one of two sockets keeps eligibility; closing the last clears it. Unknown-age, inaccurate, stale, and repeated captures cannot refresh eligibility. |
  | `closes round intervals without new client messages` | Host end and timer expiry finalize elapsed eligible time only up to their valid boundary. Tick/alarm retries add no duplicate credit. Existing conversion and grace defaults stay unchanged. |
  | `deletes award data with the expired room` | At creation plus 86,400,000 ms, the existing alarm deletes the entire record, closes clients, and leaves no award storage keys. A repeated alarm has the same result. |
  | `retains summaries across roster turnover` | More than 100 historical players can join and leave while the active roster stays within 100. Earlier labels/counters/peer sets remain; current open encounters stay bounded by the active roster. |

- [ ] **Step 2: Run the failing lifecycle tests.**

  Run: `npm run test:worker -- test/worker/awards.test.ts test/worker/recovery.test.ts`

  Expected: the new recovery/legacy cases fail before constructor integration.

- [ ] **Step 3: Integrate recovery and document collection.**

  In the existing constructor recovery transaction, inspect the saved phase
  before `restoreEngine`. For null collection, call `createAwardData` with
  the restored frame and complete coverage only for an older lobby.
  For saved collection, call `recoverAwardData`. Save the restored checkpoint
  and collection together before snapshots or alarms.

  Retain the existing expiry path: one match record means its existing
  deletion also removes collection. Do not add separate storage keys.
  Update README with the fields collected, server-only access, partial
  legacy coverage, 24-hour retention, unchanged location policy, and the
  fact that collection does not yet show awards. Link the award catalog.

- [ ] **Step 4: Run the affected tests, then the existing verification commands.**

  Run:

  ```sh
  npm run test:unit -- src/worker/award-data.test.ts src/worker/engine.test.ts
  npm run test:worker -- test/worker/awards.test.ts test/worker/recovery.test.ts test/worker/history.test.ts
  npm test && npm run typecheck && npm run build && npm run check:bundle
  ```

  Expected: all selected and existing suites, type checks, build, and dry-run
  bundling pass. Synthetic tests do not establish physical GPS performance.
  No deployment or new browser UI tests are part of this collection work.

- [ ] **Step 5: Commit lifecycle coverage and documentation.**

  Run: `git add src/worker/match-authority.ts test/worker/awards.test.ts test/worker/recovery.test.ts README.md && git commit -m "feat: preserve award data through match recovery"`

## Implementation Order and Completion Boundary

Run Tasks 1 through 4 in order. Each task uses the previous task's typed
interfaces. Review the data contract and proposed counting rules before
implementation; award naming and final winner thresholds can remain a later
decision.

The deliverable is stored, validated collection for the catalog. Do not
declare player awards available after these tasks: winner selection,
repeat-pair scoring, minimum participation thresholds, result disclosure,
and the end-of-round interface require a separate design.
