# Player Awards and Data Collection

Date: 2026-10-07

Status: Proposed award catalog and collection design. This document does not
approve gameplay changes or select the final awards.

Implementation plan:
[Award data collection](../plans/2026-10-07-award-data-collection.md).

## Purpose

Offer end-of-round awards that recognize conversion success, meeting other
players, playing different factions, and recovering after a conversion.
Players keep their achievements when they change faction.

Monk is a casual outdoor game for friends. Awards should give several players
something to enjoy without treating a conversion as elimination. The first
implementation collects the data. A later design will select winners and
decide how to show awards.

## Award Catalog

Count server-accepted conversions. A host faction change is not a conversion.
Count faction-specific success using the attacker's faction in the accepted
conversion event, including when the attacker changes faction in that same
resolution step.

### Conversion-history ideas

| Award | Proposed measure | Data needed | Notes |
| --- | --- | --- | --- |
| Conversion Champion | Most conversions made across all factions. | Accepted conversions by attacker. | Repeated pairs can inflate the count; keep raw totals separate from future award scoring. |
| Social Butterfly | Most distinct conversion counterparts, in either direction. | Union of attacker and target counterpart IDs. | Count each counterpart once. A conversion received counts as an interaction. |
| Hat Trick | At least one conversion made as each of Rock, Paper, and Scissors. | Conversions made by faction. | Prefer a badge that several players can earn. |
| Hot Streak | Most conversions made between conversions received. | Current and longest outgoing conversion streak. | Include the opening and closing stretches. Reset on a host faction change, but do not score that change. |
| Faction Specialist | Most conversions made as a selected faction. | Conversions made by faction. | Three possible awards: Rock, Paper, and Scissors. |
| Comeback Kid | Shortest eligible playing time from a conversion received to the next conversion made. | Eligible-time clock and a pending comeback per player. | Exclude grace and pauses. An outgoing conversion in the same resolution batch does not count as a comeback. |
| Last Word | Make a conversion in the final successful resolution batch. | Latest conversion batch and its attacker IDs. | Share the award when several players convert in that batch. Do not break that tie with event order. |
| Most Transformations | Most conversions received. | Accepted conversions by target. | Optional, light-hearted recognition. Avoid labels such as "most losses." |

### Encounter and participation ideas

| Award | Proposed measure | Data needed | Notes |
| --- | --- | --- | --- |
| Close Call | Receive an incoming encounter that reaches at least 90% of dwell time, then breaks confirmed range without converting you in that batch. | Encounter start, configured dwell, terminal reason, batch targets. | Collect the count of qualifying encounters. Decide later whether to award a badge or compare counts. |
| Great Escape | Most incoming encounters that end through a confirmed range break without converting you in that batch. | Incoming encounter outcomes and batch targets. | A range break does not prove which player moved or whether someone intended to escape. |
| Unbroken | Longest continuous eligible interval without receiving a conversion. | Eligible interval boundaries and conversions received. | Close the interval on pause, grace, unusable location, suspension, departure, recovery, or a host faction change. Excluded time cannot extend it. |
| Underdog | Most conversions made while your faction has the smallest positive roster population. | Roster faction counts before the accepted conversion batch. | Require a strict minority among the factions present. Equal populations do not qualify. |
| All-Rounder | Highest minimum of conversions made as Rock, Paper, and Scissors. | Conversions made by faction. | A 3/3/3 split scores 3; a 10/1/1 split scores 1. A missing faction gives a score of 0. |
| People Person | Most distinct counterparts in confirmed incoming or outgoing influence. | Counterpart IDs from attack-start events. | Include encounters that do not complete. This is broader than Social Butterfly; same-faction proximity alone does not count. |

The initial recommended award set remains Conversion Champion, Social
Butterfly, Hat Trick, Hot Streak, and Comeback Kid. Collect data for the full
catalog so a later award selection does not require route recording.

## Proposed Counting Rules

These rules define collection. They do not add points, cooldowns, or changes
to conversion eligibility.

### Accepted batches and interruptions

- Count each accepted conversion once, by `eventSeq`.
- Apply outgoing streak increments for the whole conversion batch before
  resetting streaks for players who receive a conversion in that batch.
- Keep faction-specific credit from `event.faction`, not the final roster.
- Start comeback timing after the incoming batch. A subsequent incoming
  conversion replaces the pending attempt.
- Reset a pending comeback after a host faction change, departure,
  suspension, unusable-location gap, or recovery. Freeze it through a host
  pause and conversion grace; add only eligible time after play resumes.
- An interrupted incoming encounter earns neither escape measure if its
  target receives any conversion in that resolution batch.
- Match the exact existing range reason, `Outside confirmed range.`.
  Location failure, faction changes, grace, host actions, departure, and
  recovery do not count as escapes.
- Use integer arithmetic for Close Call:
  `confirmedElapsedMs * 10 >= dwellMs * 9`.

An encounter starts when the server emits `attack_started`. Use that event's
sequence as its durable identity. The Gleam encounter counter resets on
restore and is not a durable identifier. One attacker has at most one open
encounter; several attackers can influence one target.

For Underdog, count all joined players in each faction, including joined
players without usable location. Exclude departed players. Ignore empty
factions when finding the minimum; a conversion cannot originate from an
empty faction. Treat all conversions in one resolution batch against the
same pre-conversion population snapshot, after accepted roster and host
changes.

### Eligible playing time

A player earns eligible time while the round is running, they remain in the
roster, their server observation is usable under the existing uncertainty
and freshness rules, and their grace has ended. Eligibility does not require
a nearby opponent. Do not infer attention, physical activity, or safe
movement from this time.

Use engine authority time. For an interval after a saved frame, intersect:

1. The running round interval, ending at its remaining-time deadline.
2. The previous observation's usable interval, ending at its expiry.
3. The interval after the player's remaining grace.
4. The interval up to the next accepted engine step.

A new fix begins eligibility at acceptance. It cannot fill a gap after the
previous fix expired. Repeated captures retain their existing expiry.
A delayed timer cannot credit time after an observation or round deadline.

Pausing closes the current Unbroken interval and freezes a pending comeback.
A location interruption closes Unbroken and cancels a pending comeback.
Grace contributes no eligible time. Recovery closes open intervals at their
last committed boundary without adding time for the outage.

### Ties, sample size, and repeated pairs

The eventual award selector should permit shared winners and omit awards
whose qualifying condition nobody met. Participation-based awards need
minimum eligible-time or encounter requirements before launch; choose those
thresholds through playtests. Do not invent them in the collector.

Store raw conversion totals and keep the existing conversion event history.
That history contains pair IDs, timestamps, and faction changes for a future
award-only pair cooldown or distinct-pair scoring rule. Do not filter raw
counts or introduce a gameplay cooldown as part of collection.

## Existing Data and Missing Data

| Surface | Existing behavior | Collection change |
| --- | --- | --- |
| `src/shared/protocol.ts` | Typed conversion, manual change, attack-start, interruption, and lifecycle events. | Keep the public protocol unchanged. |
| `rules/src/monk_rules/conversion.gleam` | Server-selected encounters, continuous dwell, and snapshot-based conversion batches. | Keep the conversion rules unchanged. |
| `src/worker/engine.ts` | TypeScript boundary over the Gleam engine. | Add a coordinate-free frame with authority time, roster, grace, parameters, and usable-until deadlines. |
| `src/worker/match-authority.ts` | Serialize transitions; save checkpoint and events before broadcast. | Update award summaries in the same accepted transition. |
| `src/worker/storage.ts` | Store match identity, checkpoints, events, outcomes, and feedback. | Add a validated, versioned award-data field. |
| Constructor recovery | Restore running rounds as paused and discard observations and attacks. | Preserve committed totals; close award timing and encounter cursors without awarding outage time. |
| Room expiry | Delete the match after 24 hours from creation. | Delete award data with the existing match record. |

Conversion history can support several ideas already, but it does not
contain a complete eligible-time timeline or the roster population at each
resolution. Saved attack events alone do not establish those missing facts.
No historical backfill is part of this plan.

## Collection Record

Add one `awardData` field to the existing match record. Use a worker-only
module, `src/worker/award-data.ts`, for its schema and pure collection logic.
Do not add a database, service, dependency, or client analytics stream.
Use Node 24.21.0 and Gleam 1.19.0 from `mise.toml`.

The record contains:

- `version: 1` and `coverage: "complete" | "partial"`.
- The first tracked event boundary, last processed event sequence, and
  last coordinate-free engine frame.
- Per-player labels, conversions made and received, conversion counts by
  faction, unique conversion counterparts, and unique influence counterparts.
- Current and longest conversion streaks.
- Incoming and outgoing encounter counts, qualifying incoming range breaks,
  and Close Call counts.
- Underdog conversion counts.
- Total eligible milliseconds, current and longest Unbroken intervals,
  pending comeback milliseconds, and fastest completed comeback milliseconds.
- At most one open encounter per attacker, identified by attack-start event
  sequence, with target, authority start time, and configured dwell.
- The final conversion batch's boundary and unique attacker IDs.

Keep summaries for departed players until room expiry, including their last
display label. The 100-player limit applies to the active roster, not the
number of people who might join and leave across the room's lifetime.
Do not truncate counterpart sets to 99 or drop departed summaries.

The last frame needs only IDs, labels, factions, remaining grace,
usable-until deadlines, phase, remaining round time, configured dwell,
authority time, and event sequence. It must not contain coordinates,
accuracy values, bearings, distances, capture timestamps, location reports,
or routes. Retain only the current frame and open-encounter cursors, not a
list of frames or observation samples.

## Persistence, Recovery, and Compatibility

Compute the next award record without mutating the committed one. Persist
award data, checkpoint, events, and command outcomes in the existing
transaction. Replace in-memory state and broadcast only after that write
succeeds. A failed write must not create a conversion, reset, timer interval,
or processed-event cursor in award data.

Pass explicit eligibility-reset player IDs into the collector for suspension,
the last socket closing, and an unusable location report. A paused engine
can have no observations and can emit no interruption event for those
actions. Comparing frames alone would miss the reset. These IDs are internal
transition input, not new stored location samples or public event fields.

Use one engine-step time for the checkpoint and award frame. Do not obtain
another `Date.now()` during the save to advance one of them beyond the other.
The normal next tick accounts for later elapsed time.

New rooms track a complete round. Older records can omit `awardData`; load
them as `null` and initialize collection during recovery. An older lobby can
start with complete coverage. An older running, paused, or ended round starts
with partial coverage and zero newly tracked totals. Do not represent those
totals as full-round statistics or award results.

After recovery, preserve saved counts, completed durations, labels, and
coverage. Close open encounters as recovery interruptions, clear pending
comebacks and current Unbroken intervals, and replace the saved frame with
the restored engine frame. Do not count those closures as escapes.
Keep the conversion streak across recovery because recovery is not a
conversion or host faction change.

Reject malformed award data and unsupported versions through the existing
explicit stored-record error path. Do not replace corrupt data with zeros.

## Privacy and Product Limits

Store award data only inside the match's existing retention period:
24 hours from room creation. This proposal does not change raw location
handling or introduce movement history.

Keep counterpart IDs and timing cursors server-side. This collection plan
does not send award data in player snapshots, host diagnostics, or logs.
A future results interface needs its own disclosure and access rules;
collecting the data does not grant players access to other players' histories.

Defer distance traveled, fastest movement, and furthest-from-group awards.
GPS noise makes these unreliable, and speed or separation rewards can
encourage unsafe play. Do not collect new data for them.

## Scope and Acceptance

The initial implementation collects enough data for the 14 catalog entries.
It excludes winner selection, badges, results UI, exports, scoring cooldowns,
accounts, cross-round history, and gameplay changes.

Acceptance requires:

- Conversion totals and faction counts agree with committed engine events.
- Simultaneous incoming and outgoing conversions keep snapshot attribution.
- Unique counterparts and latest-batch ties have deterministic results.
- Pauses, grace, stale fixes, repeated captures, suspension, and recovery do
  not contribute excluded time or false escapes.
- Population counts reflect joins, departures, and host changes before the
  whole conversion batch.
- Failed storage writes and repeated commands do not double-count data.
- Departed players retain their summaries until room expiry.
- Legacy records keep identity, events, settings, and partial-coverage status.
- Stored award data contains no raw location fields or sample history.
- Public messages, existing gameplay behavior, and 24-hour deletion remain
  unchanged.
