# Monk: Game and System Design

**Status:** Draft for discussion. No implementation or playtest results yet.

**Source:** `monk.doc`, a concept document dated September 30, 2004.

This document preserves the source concept, identifies gaps, and proposes a
small first version. Proposed rules are not approved requirements. Values that
affect balance must be set through playtests.

## 1. Summary

Monk is a location-based social strategy game. Players move through a shared
physical space with a connected device. Each player belongs to one of three
factions. A player can convert a nearby opponent to their faction if the
opponent is vulnerable and stays within range long enough.

Faction relationships follow Rock, Paper, Scissors:

| Attacker | Can normally convert | Is vulnerable to |
| --- | --- | --- |
| Rock | Scissors | Paper |
| Paper | Rock | Scissors |
| Scissors | Paper | Rock |

Conversion changes allegiance, not participation. A converted player remains
in the game and can convert others or change faction again.

The central design question is whether these changes create enjoyable social
play without causing confusion, repeated forced conversions, or a stalled game.

## 2. Design Goals

- Make movement and face-to-face interaction more important than screen use.
- Make faction changes clear, fair, and easy to understand.
- Give players a reason to meet different people, not only stay with one group.
- Keep every player involved after a conversion.
- Support safe play in a bounded, agreed play area.
- Make uncertain location data visible rather than treat it as exact.

### Non-goals for the first version

Persistent worlds, public matchmaking, indoor positioning, custom faction
systems, unlimited group sizes, offline peer-to-peer matches, and ranked play
are out of scope. The first version does not need themed religious roles or
special-purpose hardware.

## 3. What the Source Establishes

| Mechanic | Source intent | Detail still missing |
| --- | --- | --- |
| Three factions | Use a cyclic superiority relationship. | Initial faction assignment. |
| Conversion | Change an opponent's faction through sustained proximity. | Duration, interruption, and simultaneous attacks. |
| Sphere of influence | Define attack range and nearby faction counts. | Range, measurement accuracy, and update frequency. |
| Hunting season | Protect a faction when its population is low; reopen at a higher threshold. | Thresholds, departures, and conflict with victory conditions. |
| Groups | Increase range and let three players convert a lone superior opponent. | Group membership, attack attribution, and overlapping groups. |
| Pair timers | Limit benefits from staying with the same teammate. | Duration, reset rules, and penalties. |
| Game modes | Allow different objectives and strategies. | The source leaves this section unfinished. |
| Infrastructure | Use location-aware devices; consider a server or an ad-hoc network. | Authority, transport, trust, and failure handling. |

The source also suggests larger-group rules and penalties for an expired pair
timer. Those are extensions, not necessary parts of the first experiment.

## 4. Feedback on the Original Concept

### Preserve the changing-allegiance loop

This is the strongest part of the design. Conversion lets a player lose an
encounter without leaving the game. It also changes the social situation:
someone who was an opponent can become an ally.

The interface must make this change unmistakable. Use a faction name, symbol,
and distinct feedback. Do not rely on color alone.

### Define victory before balance rules

Converting everyone to one faction cannot be the objective if hunting season
prevents the last members of a faction from being converted. A match needs a
clear end condition and a scoring rule that do not contradict faction
protection.

Changing allegiance also makes a conventional team scoreboard ambiguous.
Does a player's score move with them? Does their old faction retain it? The
first version should avoid this question rather than hide it.

### Test the core loop before adding all balancing mechanics

Hunting season, group superiority, larger attack ranges, and pair timers can
interact in ways that are hard to predict. Adding all of them at once makes it
difficult to tell which rule improves the game.

Start with ordinary conversion. Add hunting season as one comparison, then
test groups and pair timers separately.

### Treat location accuracy as a gameplay constraint

A phone cannot be assumed to know whether someone has crossed a small radius.
Position error can make a conversion feel arbitrary. Range and dwell time must
follow measured performance in the chosen environment.

Do not select close-range rules first and assume the tracking system can
support them later.

### Replace forced separation penalties with limited benefits

Automatic grouping plus penalties can let another player cause harm to your
game state simply by following you. It can also pressure players to move away
when doing so is unsafe.

A safer first experiment is to let group benefits expire without shrinking a
player's normal range. Repeated contact should not create a new penalty.

### Make radar support interaction, not surveillance

Nearby faction counts can help players find an encounter. Exact live positions
are not needed for that purpose. Counts should exclude invalid or stale
locations, and the system should collect location only during a match.

## 5. Proposed First Playable Version

### Match setup

Use a short, hosted match in a bounded outdoor area. Start with six to eighteen
consenting players and assign factions as evenly as possible. This participant
range is a proposed test scope, not an established balance limit.

Freeze the roster when the match starts. Late arrivals wait for the next round.
The host confirms the play area, safe movement rules, and the selected ruleset.

Use a ten-minute round as an initial test value. End the round when the timer
expires or the host stops it. A pause stops both gameplay and the round timer.

### Core loop

1. Find a nearby player.
2. Check whether your faction can convert theirs.
3. Stay within a confirmed attack range for the conversion duration.
4. Receive clear progress and interruption feedback.
5. On success, the target joins your faction and receives a short grace period.
6. Continue play under the new faction relationships.

Attacks begin automatically when the rules permit them. No physical contact is
required. The device gives a clear start signal; an invisible attack should
never be the first indication that an encounter occurred.

### Scoring and results

**Proposal:** Each accepted conversion gives the converting player one personal
point. Points remain with that player after a faction change. The highest score
wins; equal scores are a tie. Show final faction populations as match statistics,
not as a separate team victory.

This gives the first version a complete objective without making faction
extinction a requirement. It also changes the emphasis from faction conquest
to individual contribution, so it needs explicit playtest feedback.

Rapid repeated conversions are not a useful source of points. Apply a
post-conversion grace period and a per-attacker/target scoring cooldown. During
that cooldown, a later valid conversion can still change allegiance but cannot
award another point to that attacker for that target. Show this distinction.

These limits reduce accidental loops and simple score farming. They do not
prove resistance to collusion; ranked play remains out of scope.

### Initial rulesets

| Ruleset | Included | Purpose |
| --- | --- | --- |
| Core | RPS conversion, dwell time, grace period, personal scoring | Establish whether conversion is fun and understandable. |
| Core + protection | Core rules plus hunting season | Measure whether protection reduces one-sided play without causing stalls. |
| Group experiment | A selected core ruleset plus small groups and pair timers | Test social mixing only after the core loop works. |

In Core, if a faction has no active players, pause and end the round early.
Record faction extinction as a balance outcome. Do not silently restore it or
allow an indefinitely one-sided match.

## 6. Conversion Rules

### Eligibility

A conversion can progress only when:

- Both players are active in the same running match.
- Both have fresh location estimates with acceptable uncertainty.
- The attacker is superior under the selected ruleset.
- The target is not under faction protection or a conversion grace period.
- The target is within the attacker's confirmed range.

For the first version, a player can maintain one attack at a time. Select the
nearest eligible target when an attack begins, then retain that target until
the attack ends. This prevents one player from converting an entire cluster
with a single dwell interval.

A protected target cannot attack during its post-conversion grace period.
Faction hunting-season protection is different: it does not stop that faction
from attacking.

### Progress and interruption

Conversion needs continuous confirmed proximity for a configured duration.
Changing faction, losing eligibility, leaving range, or receiving stale or
uncertain location data clears progress.

The client shows the interruption reason. Reconnection does not recover
conversion progress from an unobserved interval.

### Simultaneous events

The match authority evaluates attacks against one state snapshot per resolution
step. It then accepts and applies a batch of conversions.

- A target can be converted at most once in a step.
- Competing attacks are ordered by the start of their continuous dwell interval.
- Exact ties use a stable, server-assigned encounter identifier.
- An attacker's faction in the snapshot determines the resulting target faction.
- A player's incoming conversion does not retroactively cancel their accepted
  outgoing conversion in that same step.
- Changed factions invalidate unfinished attacks before the next step.

The last two rules allow a simultaneous RPS chain without making the result
depend on message arrival order. The client must present the accepted events
in a clear sequence.

## 7. Hunting Season

Keep the source's two-threshold model:

- At or below the lower population threshold, close hunting season for that
  faction. Its players cannot be converted.
- At or above the higher threshold, reopen hunting season.
- Between the thresholds, retain the current season state.

For initial six-or-more-player tests, try a lower threshold of one and an upper
threshold of two. These are test values. Larger thresholds can lock every
faction and stop play.

Protection must apply before an event batch is committed. If a faction has
`n` players and a lower threshold `L`, accept at most `n - L` outgoing
conversions from that faction in the step. Incoming conversions do not increase
that allowance until the next step. This conservative rule prevents simultaneous
attacks from bypassing the floor.

Use the same conflict order as ordinary conversions when only some attacks can
be accepted. Update season states after the batch and notify affected players.

Count active participants, not stale disconnected sessions. A temporary
disconnect pauses that player's participation and affects season state. If a
departure removes a faction or makes the selected ruleset unplayable, pause the
match. Resume only after an explicit host decision and any agreed reassignment,
or end the round.

Protection preserves faction presence during conversions. It does not guarantee
equal populations, equal skill, or enjoyable play.

## 8. Group and Timer Experiment

Groups should remain an optional rule module until the core loop is tested.

### Proposed group model

Use groups of two or three players from the same faction. A player can belong
to one group at a time, and every pair in a group must be within a fixed
group-link distance. A chain of nearby players is not one group.

Conversion removes a player from their group immediately. A group with fewer
than two remaining members dissolves. Removing the representative cancels the
group's unfinished attack; appointing another representative starts a new one.

**Intentional change from the source:** Begin with an opt-in group invitation,
not automatic grouping. Proximity remains necessary. This prevents an unwanted
nearby player from taking a group slot or consuming a timer. Test automatic
grouping later if it materially improves the experience.

Group membership uses a fixed base distance, not the group's increased attack
range. This avoids a feedback loop in which a range bonus recruits more members
and creates a larger bonus.

| Attacking faction relative to target | Attacking group | Target group | Can convert? |
| --- | --- | --- | --- |
| Superior | Any supported size | Any supported size | Yes |
| Vulnerable | Three | One | Yes, by group override |
| Vulnerable | One or two | Any | No |
| Vulnerable | Three | Two or three | No |
| Same faction | Any | Any | No |

Faction protection and conversion grace still take precedence. The source's
three-against-one rule does not make a group of two immune to ordinary superior
attackers.

A group conversion requires all three members to remain linked for the full
dwell interval. The group selects one attacking representative; that player
receives the conversion point. Other members receive an assistance statistic,
not additional conversion points.

Two- and three-player groups can receive a bounded attack-range bonus. Do not
set the bonus until tracking accuracy and the base range are known.

### Proposed pair timer

Store one shared budget for each unordered pair of players. It decreases only
while that pair receives group benefits. A trio needs an unexpired budget for
each of its three pairs.

On expiry, dissolve the affected group and retain each player's normal
capabilities. Remaining players can form a new group only if all its pair
budgets are unexpired. Do not reduce normal range, apply damage, or require
physical separation.

Briefly leaving and rejoining does not restore the budget. For the first
experiment, reset budgets between rounds only. Time during pauses or
disconnections does not consume a budget.

This is simpler than a penalty and cooldown system. Its main risk is running
out of useful partners in a small match; measure that before expanding it.

## 9. Location and Player Feedback

Treat the source's sphere of influence as a horizontal distance boundary for
the first version. Multi-floor and indoor play need a different location model
and are out of scope.

Keep attack range, group-link range, and scouting range as separate values.
Sharing one radius for all three makes balance changes difficult to interpret.

A position estimate includes a timestamp and an uncertainty estimate. For
reported distance `d` and uncertainty bounds `u1` and `u2`, use
`d + u1 + u2 <= entry_radius` as a conservative entry check. This check is
meaningful only if the reported bounds have been validated; a device's accuracy
field is not a guarantee.

After confirmed entry, a slightly larger retention radius can prevent boundary
flicker. Continued dwell still requires a fresh estimate whose upper distance
bound is within that retention radius. Uncertainty must never complete an
attack.

Before selecting ranges, measure error, update delay, and battery use in the
actual play area. If the selected tracking method cannot support the desired
encounter distance, increase the distance or change the method. Do not conceal
the error with faster animation.

The main view should show current faction, conversion progress, protection or
grace state, connection quality, round time, and nearby faction counts.

Use short audio or haptic signals for important changes. Players should not
need to watch a map while moving. A stationary or low-movement mode should be
considered in later accessibility work; it must not be assumed equivalent to
the first outdoor ruleset.

## 10. Proposed System Design

Use one authoritative match service for the first version. Clients report
position estimates and group requests. They do not declare conversions,
scores, or protection states.

| Component | Responsibility |
| --- | --- |
| Player client | Report location, display state, and provide encounter feedback. |
| Match authority | Validate inputs, resolve attacks, maintain timers, and assign scores. |
| Host controls | Create, start, pause, resume, and end a match. |
| Event record | Record accepted gameplay transitions and their reasons. |

### Minimum state

- **Match:** phase, roster, ruleset, rule parameters, remaining time, state version.
- **Player:** session identifier, current faction, score, participation state,
  latest position quality, and grace-period expiry.
- **Attack:** attacker, target, faction snapshot, and continuous dwell start.
- **Faction:** active population and hunting-season state.
- **Group experiment:** membership, representative, and remaining pair budgets.
- **Event:** sequence number, authority time, affected players, and result.

The authority owns time. Reject stale, duplicate, or out-of-order position
updates. Clients apply versioned state and request a new snapshot after a gap.
Reconnects receive current state rather than replaying missed attack progress.

If the authority becomes unavailable, pause the match. Do not switch silently
to client-authoritative play. Peer-to-peer operation is a separate design with
different consistency and trust requirements.

Validate coordinates, timestamps, and implausible movement. These checks reduce
mistakes and basic abuse but do not prove a reported location is genuine.
Competitive anti-cheat work is deferred with ranked play.

## 11. Safety and Privacy

- Play only in an agreed area with safe, accessible routes.
- Do not require running, touching, trespassing, or entering restricted areas.
- Let players stop participation without a gameplay penalty.
- Give the host a prominent pause control.
- Collect location only while the player is participating in a match.
- Show nearby counts by default, not exact opponent coordinates or movement history.
- Restrict location access to the active match and its authority.
- Keep raw location samples in short-lived state; exclude them from routine logs.
- Use synthetic trajectories for debugging. Any real-location recording requires
  separate consent, an access restriction, and a defined deletion time.
- Make any retained results opt-in and omit raw coordinates.

The game must remain a consensual social activity. A mechanic that works only
by making someone move faster or separate against their wishes should change.

## 12. Build and Playtest Plan

### Stage 1: Deterministic rules simulation

Implement the core rules with simulated locations before using live devices.
Exercise interrupted dwell, faction changes, multiple attackers, simultaneous
RPS chains, duplicate updates, disconnects, and authority failure.

For hunting season, test simultaneous conversions at the population floor,
reopening, departures, and configurations that could protect all factions.
For groups, test overlapping requests, lost links, representative conversion,
timer expiry, and leave/rejoin attempts.

### Stage 2: Tracking trial

Use the intended devices in the intended area. Measure whether close encounters
can be distinguished reliably. Set entry range, retention range, dwell time,
freshness limit, and uncertainty limit from those observations.

### Stage 3: Core playtest

Run short rounds with a balanced roster. Record accepted conversions, attack
interruptions, faction population changes, repeat opponent pairs, and periods
with no valid targets.

Ask players whether they understood each conversion, felt able to respond, and
spent too much time looking at the device.

### Stage 4: Controlled rule comparisons

Compare Core with Core + protection using the same participants and area.
Then compare the selected ruleset with and without groups. Add pair timers only
after group behavior is understood.

Change one rule at a time. Keep parameters fixed within a round.

### Proposed acceptance criteria

These are starting targets, not measured results:

| Area | Acceptance criterion |
| --- | --- |
| Consistency | The same recorded inputs produce the same events and scores. |
| Protection | No accepted conversion batch breaches the configured faction floor. |
| Location handling | Stale or rejected estimates never complete a conversion. |
| Comprehension | At least 80% of participants can explain the RPS rule after onboarding and the cause of sampled conversions. |
| Feedback | At least 95% of accepted conversions reach both players' interfaces within one second in the supported network environment. |
| Social mixing | The group/timer variant increases each player's median number of distinct encounter partners over the no-timer group variant. |
| Flow | No involuntary no-target period lasts more than 30 seconds without a visible explanation or host intervention. |

Set a numerical tracking-error target after choosing an encounter distance.
Measure conversion disputes separately from technical latency. A responsive
system can still produce unfair encounters.

## 13. Decisions Needed Before Implementation

1. **Experience:** Is Monk primarily a casual social activity, an individual
   score game, or faction competition? The proposed first score mode favors
   individual contribution.
2. **Environment:** What devices, play area, and reliable connectivity are
   available? These determine the viable location method.
3. **Tracking limits:** What encounter distance and dwell time feel natural once
   position error is measured?
4. **Protection:** Should hunting season be standard, optional, or replaced by
   round resets when a faction disappears?
5. **Groups:** Is automatic proximity grouping essential to the concept, or is
   opt-in grouping acceptable?
6. **Participation:** Who can host, pause, or reassign factions, and how should
   a round end when players leave?

Resolve the experience and environment questions first. They constrain the
other choices. Do not select a technology stack or tune advanced rules before
those decisions are clear.
