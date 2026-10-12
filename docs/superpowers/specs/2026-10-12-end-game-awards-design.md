# End-game awards and trophy announcements

Date: 2026-10-12

Status: Direction approved. Written specification awaiting user review.

Related design:
[Player awards and data collection](2026-10-07-player-awards-design.md).

## Purpose and approved direction

Give friends a shared end-of-round celebration. Show the full player group
in the results and announce the winners of up to five trophy categories.
Recognize different achievements without changing the conversion rules.

The user approved category awards, repeat winners, shared ties, a short
ceremony, and a complete results list. The user also requested entrances
that feel different from the live conversion animations, plus a demo page
with all award animations for testing.

Use the existing Side by Side colors, Hanken Grotesk, paired arches, and
named faction symbols. Give each award its own motion sequence. Keep the
results available after the ceremony.

## Scope

Select awards from the saved collector, disclose a small results projection
at round end, and add the ceremony and complete results interface. Ship a
dedicated animation demo with the same stage components as the live game.
Support both timer expiry and a host ending the round.

Keep the current gameplay, collection rules, room credentials, location
handling, and 24-hour room expiry. Do not add accounts, public results,
cross-round history, new dependencies, or a separate scoring system.
Do not change access rights for players who leave the room.

## Results and player inclusion

For complete collection coverage, include each player ID in
`awardData.players`, including players who left, late joiners, and players
with no conversions. Use saved display labels. A host who did not join as
a player does not receive a player row.

Retain separate entries when two players have the same display label.
Use player IDs for keys and winner references. Do not merge rows by name.
The collector includes room participants from its first tracked frame;
do not claim that a zero score proves the player took part in active play.

Rank the complete list by conversions made, descending. Equal counts
share a competition rank: 1, 1, 3. Order equal scores by label, then player
ID, using a deterministic server comparator. This ordering does not break
a trophy tie.

Each row shows rank, player name, conversions made, and earned trophy
names. Mark the current player as "you". Derive badges from category
winner membership so the list and announcements agree.

Render the complete list as ordinary, scrollable content. Do not apply a
top-N cutoff, hide zero-score players, or limit the list to the current
100-player roster. Departed players can make the retained list larger.
Provide an "All players (N)" heading and a semantic ordered list.

## Award selection

Use these five categories in this announcement order:

| Category | Qualifying condition | Winners | Displayed achievement |
| --- | --- | --- | --- |
| Hat Trick | At least one accepted conversion made as each faction. | All qualifying players. | "Converted as Rock, Paper, and Scissors." |
| Comeback Kid | A non-null fastest completed comeback in the collector. | Lowest eligible milliseconds, including a valid zero. | Fastest comeback duration, labeled as eligible play time. |
| Social Butterfly | At least one distinct conversion counterpart. | Highest counterpart count. | Number of distinct conversion counterparts. |
| Hot Streak | At least two conversions in the longest outgoing streak. | Highest qualifying streak count. | Number of conversions in that streak. |
| Conversion Champion | At least one conversion made. | Highest conversion count. | Total conversions made. |

The Hot Streak minimum of two is a presentation qualification proposed
for this release; the collector remains unchanged.

Compare exact saved integers. Do not break duration ties using rounded
display values, or break count ties using event order or player name.
Award each tied winner the same trophy. The same player can win several
categories.

Hat Trick is a shared achievement, not a ranking of qualifying players.
Do not select an arbitrary subset when several players earn it.

Omit categories that nobody qualifies for. Aim for three to five
announcements when the round supports them, but permit zero, one, or two
rather than create unearned trophies. If nobody earns a category, show
the complete results with "No trophies earned this round."

Comeback copy must explain that eligible play time excludes pauses,
conversion grace, and unusable-location time. Social Butterfly counts
conversion counterparts in either direction; do not describe it as
outgoing conversions or all nearby players.

## Ceremony

For a visible client that receives a live update changing a running or
paused round to ended, show a brief "Round complete" introduction, then
the earned awards in the order above. Keep the complete results mounted
behind the ceremony and reveal them when it ends.

Use one shared stage for layout and timing, with separate award entrance
variants. Do not reuse the conversion takeover or its effects.

| Category | Entrance |
| --- | --- |
| Hat Trick | The Rock, Paper, and Scissors hands enter from different directions and lock into a trio. Reveal the winner names below the symbols. |
| Comeback Kid | A trophy follows a low-to-high turnaround path and settles above the winner names. |
| Social Butterfly | The paired arches enter from opposite sides. Reveal the trophy and winner names between them. |
| Hot Streak | Three short streaks cross the stage in sequence. Bring in the trophy and winner names after the final streak. |
| Conversion Champion | Two stage panels open sideways like curtains. Raise a larger trophy onto a podium for the final announcement. |

Preserve the supplied mark geometry when separating the paired arches.
Use the installed Tabler icons or small authored SVG shapes for trophy,
podium, and streak artwork. Keep the three faction colors attached to their
named hand symbols.

Use an ink stage with readable white type and yellow trophy artwork.
Avoid conversion bubbles, faction-colored screen takeovers, hand stamps,
and countdown rings. Keep the trophy finale specific to the champion
category, even when the champion won an earlier award.

The introduction lasts 500 ms. Each announcement lasts 3,000 ms:

| Announcement age | Action |
| --- | --- |
| 0-200 ms | Show the category title and its still stage composition. |
| 200-850 ms | Run the category entrance. |
| 700-1,000 ms | Reveal winner names and the achievement. |
| 1,000-2,800 ms | Hold the composition still for reading. |
| 2,800-3,000 ms | Exit into the next announcement or the results. |

Five earned categories take 15.5 seconds including the introduction.
Avoid bouncing, looping, screen shake, and flashes. This feature does
not add audio or alter the existing sound preferences.

Show tied winners together in their category announcement. Wrap long
names and allow the winner area to scroll for a large tie. Include all
winner names in the document and in the lasting results, regardless of
what fits in the announcement viewport.

"Skip to results" stays visible during the introduction and every
announcement. It stops the ceremony, exposes the full list, and moves
focus to the results heading. Normal completion also exposes the list
and moves focus to that heading.

## Animation demo page

Add `/brand/award-motion.html` beside the existing
`/brand/conversion-motion.html` preview. Include it as a Vite build entry
so the deployed build serves the compiled demo. Link it from the brand
index and document its URL in the README.

List all five award categories as labeled preview choices. Use one
responsive stage so testers can compare the entrances without five
simultaneous animations. Opening the page selects Conversion Champion
from the normal fixture at age 1,500 ms, paused. Testers choose when to
play.

Provide these controls:

- Play or replay the selected award from age zero.
- Play the full ceremony, including the introduction and final results.
- Pause or resume playback.
- Scrub a labeled timeline to an exact millisecond.
- Choose a fixture and inspect its complete player results.
- Force reduced motion, or use the browser's system preference.

Use the production award stage, SVG artwork, styles, sequence calculation,
and timing constants. The demo supplies fixture data and a controlled age
instead of a live match. Do not maintain a separate mock implementation
of an entrance. Allow seeking forward and backward without leaving
effects or timers from the previous preview.

Provide named fixtures for a normal five-award ceremony with a repeat
winner, shared ties, long and duplicate names, a large player list with
departed and zero-score players, no earned awards, and incomplete
coverage. Include a large shared Hat Trick group to test overflow.
Label the data as fictional and the page as a testing preview.
If the chosen fixture has not earned the selected category, show
"This trophy was not earned in this fixture" instead of inventing a winner.

Keep replay, pause, and timeline tools on the demo page. They do not add
replay controls to the live end-game interface. The demo must not create
a room, authenticate, request location, open a game socket, or send
fixture data to the authority.

## Motion lifecycle and accessibility

Use a monotonic start time and sequence age. Derive the current category
and its local age from that clock. Drive CSS through an award-age custom
property and deterministic paused-keyframe or equivalent sampling.
App rendering reparents the mounted game interface, so an ordinary
CSS animation start is not a reliable ceremony clock.

Keep the ceremony state in the persistent match view. Duplicate updates
and root reparenting must not restart an entrance. Cancel timers when
the ceremony completes, the user skips, the view unmounts, or the room
changes.

An initial ended snapshot, reconnect snapshot, or page refresh opens the
results without autoplay. If the app becomes hidden or disconnects during
the ceremony, finish the ceremony and show results when the user returns.
Do not replay missed announcements or introduce a replay control.

Honor `prefers-reduced-motion` and changes to that preference. Keep the
same category compositions and readable holds, but replace travel,
curtain movement, and streak sweeps with brief opacity reveals. Reduce
motion without removing the award information.

Provide a labeled ceremony dialog and a keyboard-accessible skip button.
Move focus to that button on opening. While the ceremony is open, keep
the rest of the app inert so keyboard focus cannot move behind the stage.
Announce the category, winners, and achievement once per announcement
through a polite live region. Do not announce animation frames or
decorative SVG content.

Support 320 px phone widths, short phone viewports, landscape phones,
desktop layouts, safe-area insets, and browser text enlargement.
Keep the skip control reachable and allow names and results to wrap.
Use text and icons with color, rather than color alone.

## Data flow and access

Add a pure worker results selector over the committed `AwardData`.
Keep counting in `award-data.ts`. Compute deterministic results from
stored summaries; do not add a persisted results table or service.

The authority saves the ending checkpoint and award data through the
existing transaction before it publishes results. Derive results for
ended snapshots and updates from that committed record. Storage failure
must preserve the existing explicit error behavior and must not publish
trophies for an uncommitted transition.

Extend the shared schemas with a typed, optional end-of-round results
projection. Its fields contain coverage, the player list and ranks,
category IDs, winner IDs, and the aggregate values needed for the
achievement copy. Validate unique player IDs, known winner references,
unique categories, nonnegative integer measures, and at most five awards.

Send this projection only after the round ends, to authenticated current
players and the host. Continue listing and awarding departed players,
but preserve the existing rule that a departed player cannot
reauthenticate with their old player token.

Use an optional `supportsRoundResults` authentication capability, following
the existing `supportsFactionHistory` pattern. Store it in the socket
attachment and omit the new snapshot field for clients that did not opt
in. New clients opt in; missing capability values mean false.

Do not disclose counterpart IDs, open encounters, running eligibility clocks,
location reports, coordinates, movement histories, or conversion event
histories as part of results. Publish only the aggregate measures in
the approved player rows and award announcements.

Add a short disclosure to the room's existing information:
"At round end, room members can see player names, conversion totals,
and earned trophies." Keep the current location consent controls.
Expire all results with the existing room record.

## Incomplete data and errors

For partial collection coverage, show "Round statistics are incomplete."
List the known collected players plus any current roster entries missing
from that collection. Do not show full-round ranks, conversion totals,
trophies, or an autoplay ceremony. State that the list may omit players
who left before collection began.

For a valid legacy record with no collection, show available roster
names with "Round statistics are unavailable." Leave ranks and scores
absent. Do not replace unknown totals with zero or call this a complete
participant list.

If a new client receives an ended state without a results projection,
show an explicit unavailable notice with the existing reconnect action.
Keep available roster names visible while withholding award claims.
Reject malformed results and corrupt stored collection data through the
existing protocol and authority error paths.

An empty complete participant list shows "No players in this round."
A complete round with players and zero conversions shows their zero
scores and shared ranks, with the no-trophies message.

## Integration

Add the pure selector and its unit checks in the worker. Extend the
existing shared protocol and authority projection/capability handling.
Keep the Gleam conversion engine and collector logic unchanged.

Add a focused end-state Svelte component and a shared award stage used
by both the game and demo. The stage takes category data, winner labels,
motion preference, and announcement age; it does not own a network
connection. Use the existing persistent match view to supply the live
ceremony start. Replace the ended HUD and its current-roster-only display
with the results component. Keep room actions, errors, location information,
and safety details available after the ceremony; do not render a second
competing player list.

Put the award motion styles beside the existing client styles, with
separate category selectors and reduced-motion rules. Update
`src/client/DESIGN.md` and the relevant README results/privacy guidance
after implementation so they describe the shipped behavior.

## Verification and acceptance

Use the existing Vitest and Playwright tooling. Add selector checks for
category qualification, repeat winners, exact ties, shared ranks,
zero-duration comebacks, incomplete coverage, and deterministic ordering.
Check participant inclusion for departures, late joins, zero scores,
duplicate names, and a retained participant count above 100.

Worker checks must cover host end, timer expiry, save-before-broadcast,
recovery, room expiry, capability compatibility, and the absence of
private collector fields from the results payload. Keep live-round
messages free of results.

Client checks must cover skip and focus, reduced motion, shared-winner
names, all-player rows, duplicate updates, HUD reparenting, hidden tabs,
disconnects, initial ended snapshots, refreshes, and room changes.
Use controlled clocks to check the 500 ms introduction, 3,000 ms
announcements, and 15,500 ms maximum normal sequence.

Inspect phone and desktop captures together, including long names and
large ties. Confirm that each category has its own entrance and that
the award stage does not reuse the conversion takeover. Run the relevant
type checks and build before claiming the feature complete.

Add Playwright checks for the demo route, all five category previews,
individual replay, full-sequence playback, pause, forward and backward
timeline seeking, fixture changes, reduced motion, and the final player
list. Check that the built demo route works and does not trigger room,
socket, or location operations. Use its controlled timeline to inspect
the entrance and still hold for each category.
