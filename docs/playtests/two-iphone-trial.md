# Two-iPhone outdoor trial

Use exactly two iPhones for the first field trial. Synthetic software checks
do not measure GPS accuracy. Results apply only to the tested phones, iOS
versions, browser modes, and outdoor conditions.

## Before collection

Use **https://monk-test.tylerbutler.com** after deployment. A plain HTTP LAN
address cannot replace it.
Agree on a bounded outdoor area and safe routes. Mark known separations with
a tape measure. Do not run, touch other players, enter roads, or trespass.

Open Monk on both phones. On the first phone, create a match, then select
**Join as a player on this phone**. Join the second phone with the eight-character
code. The code does not give host control.

Keep both screens on and apps visible. Expand **Two-iPhone location trial**.
Enter both phone models, iOS versions, browser modes, and outdoor conditions.
Do not enter names or coordinates.
Use Safari tabs first. Repeat with **Add to Home Screen** and open the installed
PWA. Installation does not enable offline play.

## Measure

1. Select both players and enter the marked reference separation.
2. Request trial consent. Each player must agree before collection starts.
3. Stand at the marks. Read distance, reported uncertainty, sample age, update
   gaps, clock uncertainty, and capture-to-receipt bounds.
4. Move together and apart on safe routes. Stop the trial before changing the
   reference separation, then request consent for the next measurement block.
5. Check permission denial, screen locking, hidden pages, wake-lock release,
   internet loss, and return to the app. Stale fixes must not count as fresh.
6. Stop the trial. Use **Export measurement summary** only if you want to keep
   the grouped measurements. No raw locations, session credentials, player
   names, or per-fix movement records are included.

One summary keeps the compatible reference-separation blocks. Before changing
phones, conditions, or parameter candidates, export the current summary and
select **Discard measurement summary**. Start a new summary for the new setup.

Recommendations are provisional. Diagnostic freshness is 5000 ms; it is not
a gameplay value. Evaluate candidate radii, uncertainty, freshness, dwell,
and grace with the actual phone pair before a normal round. GPS uncertainty
is reported evidence, not a guaranteed physical boundary.

## Try a two-player testing round

Stop any active location trial before starting a round. New Testing-mode rooms
use uncalibrated starter values: entry 30 m, retention 40 m, maximum
uncertainty 15 m, freshness 5000 ms, dwell 2000 ms, grace 3000 ms, and a ten-minute
round. The settings are saved automatically; no play-area field or setup form
is required. These values do not establish GPS accuracy; you can try a Testing
round before taking measurements.

Select **Create room** to join as the host player. Share **Copy invite link**;
the other player opens the link and selects **Join room**. Watch the player list
update in the waiting room.

Expand **Advanced settings** to use measured or other provisional values and
describe the device limits. Keep **Testing mode** checked for two-player rounds.
Saved settings take priority over the preset.

The guest selects **Allow location for this round**. The host selects
**Start game**. Both actions request browser access when needed and discard the
permission-check fix. If the site is already blocked, change browser and device
location settings, then retry; the browser may not show another prompt.
The app does not report location until a trial, round, or freshness check needs it.
The ten-second check requests fresh fixes;
it does not run the gameplay clock. A trial is not a start prerequisite.
If it times out, check consent, clock, connection, and reported uncertainty,
then start a new check.

Try safe approaches and departures. Check outgoing and incoming attack
progress, interruption reasons, faction symbols, and post-change grace.
Conversion notifications stay on screen until you dismiss them. An off-screen
history entry does not count as visible feedback.
On the host phone, expand **Change player factions** to change a faction.
This is a manual change, not a conversion; it must clear both attack roles
and give grace only once.
Pause the round and verify that time and grace stay fixed. Request a resume
check. Cancel it once, then repeat and provide fresh fixes on both phones.
Leave without a score or gameplay penalty.

## Record limits and later work

Keep the grouped export only with participant agreement. Record the tested
phone pair, software/mode, marked separations, sample counts, errors, update
gaps, and failures. Do not add raw coordinates or player names to the report.
Repeat the same route and separations in tab and installed-PWA modes.

Parameter candidates in an export are the settings saved before that trial
block. To compare another candidate set, save the new settings and run another
block. False-entry samples and interruptions evaluate the location gates;
dwell and grace balance still need gameplay observations.

Before a normal round, obtain six consenting participants and approve a saved
measured parameter set with its device limits. A change to parameters resets
that approval. Initial two-iPhone measurements do not prove mixed-device or
Android accuracy.

Later tests measure whether 80% of players can explain eligibility and sampled
conversions, and whether 95% of accepted conversions appear on both visible
interfaces within one second. Count missing acknowledgements as failures.
Authority-to-acknowledgement time is a conservative display-delay upper bound,
not one-way network latency. These targets are not initial trial results.

## Install icons

Source artwork is `public/icons/icon.svg`. Regenerate the PNG assets with
ImageMagick:

```sh
convert -background none public/icons/icon.svg -resize 192x192 public/icons/icon-192.png
convert -background none public/icons/icon.svg -resize 512x512 public/icons/icon-512.png
```
