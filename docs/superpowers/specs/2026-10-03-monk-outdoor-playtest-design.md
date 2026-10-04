# Monk game scope and original playtest design

Date: 2026-10-03

Status: The multiplayer game requirements below supersede the original
playtest requirements for ordinary gameplay. Keep the original design as
historical context and optional measurement guidance.

## Current multiplayer game requirements

- Offer optional display names with numbered fallback. Creation joins the
  host as a player. Keep invitations available during active rounds.
- Permit joins in lobby, running, and paused phases, up to 100 players.
  Apply grace to late joins. Reject joins after the room ends or expires.
- Start with two joined players. Start and resume do not request location,
  require approved parameters, or run a clock or GPS readiness check.
- Share location with explicit browser consent in all non-ended phases.
  Use the first watch callback, including cached positions. Do not poll
  for fresh fixes. Pause stops conversions but keeps radar and sharing.
- Validate reports, coordinates, uncertainty, authorization, and sequence.
  Include nonnegative position age or unknown age separately from the phone
  timestamp. Accept lower timestamps after phone clock changes.
- Keep positions for radar in temporary memory. Influence requires a shared,
  sufficiently precise position less than 30 seconds old. Old, unknown-age,
  and repeated captures cannot refresh progress or bridge an expired gap.
  Stopping sharing or disconnecting stops both influence roles at once.
- Keep north-up radar, rounded distances, faction symbols, named references,
  and marker-offset leaders. Retain last-known and approximate markers.
  Offline and hidden states clear confirmed influence and retain radar;
  local age labels continue without inventing progress or conversions.
- Keep named incoming/outgoing influence and visible conversion notifications.
  Continue play when another player lacks location or a faction disappears.
- Use Monk as the visible identity. Keep Advanced settings and host diagnostics
  closed by default. Remove public mode, calibration, freshness, and device-limit
  setup. Diagnostic consent and clock checks do not block ordinary play.
- Default to 30 m entry, 40 m retention, 15 m uncertainty, two-second dwell,
  three-second grace, and ten-minute rounds. Fix inactivity at 30000 ms.
- Persist credentials, names, factions, events, command outcomes, and timers
  before broadcast. Do not persist locations or movement history. Leave removes
  one position; end, expiry, and restart clear all positions.
- Migrate validated legacy rooms to flexible rules and 30000 ms inactivity
  without losing other settings or private identity. Recover running rounds
  as paused. Clients open during an upgrade must reload the interface.

Use synthetic fixtures for software checks. Physical GPS performance and
field feedback targets require measurements on the selected devices.
See [README](../../../README.md) for current use and verification commands.

## Original playtest specification (superseded for ordinary play)

Implementation plan:
[Outdoor playtest](../plans/2026-10-03-monk-outdoor-playtest.md).

## Purpose and scope

Build a playtest tool to find out whether automatic proximity conversion is
fun and understandable. Players remain in the game when conversion changes
their faction. The first version tests that loop rather than competition.

The product target is a PWA for iPhone and Android. Players use it outdoors,
keep the app visible with the screen on, and have usable internet access.
Desktop users can open or install the same PWA. There is no native wrapper.

The initial location trial uses two iPhones only. Its measurements apply to
those devices, software versions, and conditions. Android and broader iPhone
coverage are later work, not prerequisites for finishing this trial.

Testing mode starts enabled for new matches. It permits two-player rounds
and host-controlled faction changes during play. A later normal gameplay
test starts with six consenting players, two per faction.

Exclude indoor positioning, offline gameplay, peer-to-peer authority,
accounts, public matchmaking, competitive scoring, hunting-season protection,
groups, pair timers, and exact opponent maps from this version.

`DESIGN.md` preserves the broader game concept. This specification defines
the first implementation scope where the two documents differ.

## Architecture and language boundaries

| Part | Language | Responsibility |
| --- | --- | --- |
| PWA | TypeScript | Join, host controls, location reporting, feedback, and trial measurements. |
| Worker | TypeScript | Serve web assets and route authenticated connections to their match. |
| Match Durable Object | TypeScript | Connections, authority time, input validation, scheduling, persistence, and player-specific messages. |
| Rules engine | Gleam compiled to JavaScript | Match transitions, eligibility, dwell, conflict resolution, grace, and faction changes. |

Use one Durable Object per match. CRDTs are not required.

Keep the Gleam engine independent of browser and Cloudflare APIs. Supply
authority time, validated observations, and authorized commands as inputs.
Return the next state and typed events or rejection reasons. The engine
does not read a clock, make network calls, or write storage.

Compile Gleam for JavaScript and generate TypeScript declarations. TypeScript
code must use an explicit boundary for Gleam values and protocol data.
Validate data at runtime before it enters the engine; generated declarations
do not validate WebSocket messages or stored JSON.

Verify compilation and Worker bundling in the first implementation milestone.
JavaScript compilation does not provide BEAM or OTP runtime behavior.
The specification does not require a particular frontend framework.

## Match setup and access

The host creates a private match and receives host credentials. Players join
with a match code and receive individual session credentials. The join code
does not grant host permissions. No client may select its role by sending a
role field in a message.

The host may also participate as a player on the same phone. Two-phone trials
do not require a third device for host controls.

Use HTTPS and authenticated WebSockets. Restrict a session to its match and
player. Validate host permissions for start, pause, resume, end, parameter
changes, and manual faction changes.

Freeze the roster when a round starts. Late arrivals wait for the next round.
The host confirms the play area and safe movement rules before starting.

For a normal round, require six active players and assign two to each faction.
Testing mode permits a round with two active players and any faction
distribution. The host can set initial factions in the lobby.

Expose testing mode in the lobby and show its current value to all players.
The host can change it before a round starts. Keep the selected mode and
rule parameters fixed through running and paused phases of that round.

Use an initial round duration of ten minutes, as proposed in `DESIGN.md`.
The host can choose another duration before starting. Round duration is a
test parameter, not a balance claim.

## Core conversion rules

Faction superiority follows this table:

| Attacker | Can convert |
| --- | --- |
| Rock | Scissors |
| Paper | Rock |
| Scissors | Paper |

A player can maintain one attack at a time. Choose the nearest eligible
target when an attack starts, then retain that target until completion or
interruption. Resolve an exact distance tie with a stable player identifier.
Keep distance calculations out of faction-rule definitions.

An attack can progress only while both players:

- Participate in the same running match.
- Have fresh location estimates within the configured uncertainty limit.
- Satisfy the faction-superiority relationship.
- Are outside their post-conversion grace periods.
- Satisfy the confirmed entry or retention distance check.

Require continuous confirmed proximity for the configured dwell duration.
Leaving range, losing location quality, disconnecting, changing faction, or
otherwise losing eligibility clears progress. Show the interruption reason.

Use a conservative distance check. For estimated separation `d` and reported
uncertainties `u1` and `u2`, require `d + u1 + u2 <= entry_radius` to start.
Continue only while the same upper-distance estimate is within the retention
radius and both observations remain fresh. Reported uncertainty is evidence
to evaluate in the trial, not a guarantee of a physical boundary.

Evaluate conversions against one snapshot per resolution step:

1. Apply authorized host commands and invalidate affected attacks.
2. Evaluate ongoing attacks against the resulting snapshot.
3. Order completed competing attacks by continuous dwell start, then stable
   authority-assigned encounter ID.
4. Accept at most one conversion per target.
5. Apply the accepted batch and invalidate unfinished attacks affected by
   faction changes before the next step.

An attacker's faction in the snapshot determines the target's new faction.
An accepted incoming conversion does not cancel that player's accepted
outgoing conversion in the same batch. This permits simultaneous RPS chains.

Apply a grace period after conversion. During grace, a player can neither
attack nor be attacked. Show the new faction with a name and symbol.
Count accepted conversions as playtest observations, not competitive points.

## Testing mode

New matches default to testing mode for this version. The interface displays
`Testing mode` to the host and players throughout the match.

| Behavior | Normal mode | Testing mode |
| --- | --- | --- |
| Start roster | Six active players, balanced factions | At least two active players; incomplete factions allowed |
| Manual faction changes in the lobby | Host may prepare initial assignment | Host may prepare initial assignment |
| Manual faction changes after start | Reject | Host may change factions while running or paused |
| Faction eliminated by conversion | End the round early | Continue |
| Faction absent because of disconnects | Pause the round | Do not pause solely for faction absence |
| Location, grace, and authorization checks | Required | Required |

Send manual changes through the engine as host commands. Apply them at a
resolution boundary, cancel attacks where the changed player is attacker or
target, and apply the normal grace period. In a paused match, preserve the
full grace duration until resumption.

Record a distinct manual-faction-change event with the host, target, old and
new factions, event sequence, and authority time. Do not count it as a
conversion. A request to assign the existing faction reports that no change
occurred; it does not restart grace.

Deduplicate host commands by command identifier. A retry must not apply a
change or grace twice. Testing mode does not permit arbitrary client state
writes, synthetic positions in a live match, or bypasses of location quality.
Synthetic trajectories belong in the separate engine test harness.

## Location inputs and authority time

A location report includes coordinates, reported horizontal uncertainty,
capture time, and a monotonically increasing session sequence number.
The adapter also records receipt time on the authority.

Reject malformed values, invalid coordinates, duplicate or out-of-order
sequences, stale observations, and timestamps outside the supported clock
tolerance. Define the clock-tolerance and freshness checks in the protocol;
use authority time for dwell and match decisions. Do not infer a fresh sample
from a WebSocket heartbeat or a repeated cached position.

Measure capture-to-receipt delay and clock-offset uncertainty in the trial.
Neither receipt time nor an untrusted client timestamp proves when a physical
position was measured. Basic checks reduce mistakes and abuse; this version
does not claim to resist fabricated locations.

Browser location updates can stop when a player is stationary or the page
loses visibility. Trial reporting must distinguish a new fix from a cached
fix. If the browser cannot provide fresh observations, show degraded location
quality and suspend attacks rather than extend the last known observation.

Request a screen wake lock where supported. Show permission failures, released
wake locks, hidden-page state, and connection loss. The authority's freshness
checks remain the fallback when the client cannot send a suspension message.

## Persistence, scheduling, and recovery

Persist roster and session-token verifiers, selected mode and parameters, accepted
faction changes, match phase, clock checkpoints, and event sequence. Commit an
accepted state transition and its events together before announcing success.
Keep raw coordinates and unfinished dwell in short-lived memory.

Schedule round expiry, grace expiry, and observation freshness checks even if
no position message arrives. Use authority time rather than client countdowns.
Process overdue work without awarding progress through missing observations.
Keep resolution steps and command processing idempotent.

If an authority restarts a running match, recover the last committed state as
paused. Preserve lobby, paused, and ended phases as they were. Clear locations,
participation freshness, and unfinished attacks. Preserve the last committed
remaining round duration; outage time does not reduce it.

A normal host pause clears unfinished attacks and stops the round clock.
Freeze remaining grace durations during the pause. A host resume request starts
a freshness check and asks consenting connected clients for new observations.
Keep gameplay and the clock paused during that check. Normal mode requires six
active players with fresh acceptable observations and all factions represented;
testing mode requires two active players with fresh acceptable observations.
If the check fails or the host cancels it, stop sampling and remain paused.
Reconnection receives a
current, versioned, player-specific snapshot. Do not recover unobserved dwell.
Request a snapshot after a gap in the message sequence.

In normal mode, faction extinction by conversion ends the round early and
records the reason. Faction absence due to disconnection pauses the round;
the host waits for reconnection or ends it. Do not reassign factions to repair
a running normal round.

Testing mode suppresses those population stops. A disconnected player still
cannot attack or serve as an eligible target.

## Two-iPhone location trial

Provide a location-only trial view that works with two joined iPhones without
requiring a gameplay round or all three factions. It may run before the host
has selected conversion parameters.

For each trial session, record the two phone models, iOS versions, browser or
installed-PWA mode, and a description of the test conditions. Use marked,
known separations. Repeat stationary tests and approaches and departures.

Show estimated pair distance, reported uncertainties, sample ages, update
gaps, and connection quality. Compare estimates with the entered reference
separation. Check behavior after screen locking, visibility changes, permission
denial, connection loss, and returning to the app.

Offer opt-in exports of measurement summaries without raw coordinates.
Include sample counts, observed distance error, update gaps, and false-entry
or interruption observations for each candidate parameter set. The report
must identify the measured device pair; it must not claim Android validation.

The trial produces provisional entry and retention radii, uncertainty and
freshness limits, dwell duration, and grace duration. Require positive,
finite values, `retention_radius >= entry_radius`, and a parameter set fixed
for each round.

Testing rounds may use host-entered provisional values and must label them
as uncalibrated. Before a normal live gameplay test, the host approves a
measured parameter set and its device limitations. Approval of the initial
two-iPhone measurements does not establish mixed-device accuracy.

The initial trial does not require Android or additional iPhones. Broader
device validation and the six-player gameplay test follow when participants
and devices are available.

## Player feedback

The player view shows faction name and symbol, round time, outgoing and incoming
attack progress, grace state, testing-mode status, nearby faction counts,
connection quality, and location-quality interruptions. Do not rely on color.

Send an explicit attack-start signal to both participants. Show accepted
conversions and manual changes as different events. Support short audio or
haptic cues where the device permits them; keep visible feedback complete.

Nearby counts use only active, fresh, acceptable positions. Do not send exact
opponent coordinates to a player or provide a movement-history view.
Provide the host with a prominent pause control.

Testing-mode rounds also provide a north-up player radar. The server derives
relative distance rounded to 5 m and bearing rounded to eight compass points
from temporary observations. Send these derived values, fix age, and reported
uncertainty, not raw coordinates. Use the player's usable fix as the reference.
A host without a player session uses the first usable player fix as a named
reference. Do not substitute another reference for a player with an unusable fix.
Exclude missing, expired, or excessive-uncertainty fixes from position markers.
Do not show radar positions in the lobby, paused or ended phases, or Normal mode.
Clear live positions and influence on connection loss, app hiding, or local
snapshot expiry. Keep derived positions out of checkpoints, logs, and exports.

Label confirmed outgoing attack progress as influence on a named player, and
identify incoming attackers. Highlight those participants on the radar with
solid outgoing and dashed incoming links. A radar estimate alone is not
confirmed influence. Use accepted conversion events for personal conversion
notifications and use interruption events to explain why influence stopped.

## Safety and privacy

Players agree to a bounded outdoor area and safe routes. Do not require
running, touching, trespassing, or physical separation against a player's
wishes. A player can stop participating without a gameplay penalty.

Explain location use before requesting permission. Collect it only while
the player participates in a trial, active round, or an explicit resume
freshness check. Stop regular collection during pauses. Stop all collection
after leaving or when the match ends. Resume grace and attack evaluation
only after the freshness check succeeds.

Do not include coordinates or session secrets in routine logs, retained
events, or exported summaries. Use synthetic trajectories for engine tests.
This version does not record real trajectories.

Expire server-side match records and session credentials within 24 hours of
match creation. Notify connected clients when a match expires and stop play.
Participants may opt to retain exported summaries on their own devices.

## Verification and acceptance

The implementation plan must cover these checks:

| Area | Required evidence |
| --- | --- |
| Language integration | A compiled Gleam module runs in the Worker/Durable Object build with generated TypeScript declarations. |
| Determinism | Identical initial state, ordered inputs, parameters, and authority times produce identical events and state. |
| Eligibility | Stale, rejected, or insufficient-quality observations cannot complete dwell. |
| Resolution | Competing attacks, simultaneous RPS chains, faction changes, and exact ties follow the specified batch rules. |
| Testing mode | The default is on; only the host can change factions; manual changes clear affected dwell and apply grace without adding a conversion. |
| Mode isolation | Two-player/incomplete-faction rounds work in testing mode; normal mode retains roster and population stops. |
| Recovery | Pause, visibility loss, disconnects, sequence gaps, duplicate commands, and authority restart do not recover unseen progress. |
| Privacy | Player messages omit opponent coordinates; logs and exports omit raw locations and credentials. |
| Initial field evidence | Two-iPhone measurements identify device/software conditions and report limitations. |

Use synthetic rules tests independently of the field trial. The initial
two-phone measurements do not substitute for engine correctness checks.

For the later six-player gameplay test, retain the draft's starting targets:

- At least 80% of participants can explain RPS eligibility and the cause of
  sampled conversions after onboarding.
- At least 95% of accepted conversions reach both visible player interfaces
  within one second in the supported network environment.

Measure visible feedback rather than only message transmission. Record sample
counts and failures. These are experimental targets, not results already
achieved or release claims for untested devices.

## Implementation sequence

1. Establish the Gleam-to-JavaScript build and TypeScript authority boundary.
2. Implement and verify the deterministic core, including testing-mode rules.
3. Provide private match sessions and the two-iPhone location-only trial.
4. Add host faction controls and two-player test rounds with provisional
   parameters.
5. Collect initial field measurements and select a measured parameter set.
6. Prepare normal rounds and the later six-player gameplay test.

The first implementation plan covers software delivery through step 4 and
instructions for the two-iPhone trial. Field measurements in step 5 require
the user's phones and play area. Do not claim completion of that field work
from synthetic inputs. Steps 5 and 6 depend on measurements and participants,
not speculative tracking accuracy.

## Documentation references

- [Broader game concept](../../../DESIGN.md)
- [Gleam JavaScript and TypeScript declarations](https://github.com/gleam-lang/gleam/blob/main/changelog/v1.1.md)
- [Durable Object coordination](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Geolocation visibility requirements](https://www.w3.org/TR/geolocation/#request-a-position)
- [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)
