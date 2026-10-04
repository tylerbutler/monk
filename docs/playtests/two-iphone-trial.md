# Two-iPhone outdoor trial

Use exactly two iPhones for the first field trial. Synthetic software checks
do not measure GPS accuracy. Results apply only to the tested phones, iOS
versions, browser modes, and outdoor conditions.

## Before collection

Use **https://monk-test.tylerbutler.com** after deployment. A plain HTTP LAN
address cannot replace it.
Agree on a bounded outdoor area and safe routes. Mark known separations with
a tape measure. Do not run, touch other players, enter roads, or trespass.

Open Monk on both phones. On the first phone, select **Create room** to join
as the host player. Join the second phone with the invite link or eight-character
code. The code does not give host control.

Keep both screens on and apps visible. In the lobby, expand **Host diagnostics**,
then **Optional location measurement**.
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
and grace with the actual phone pair. GPS uncertainty
is reported evidence, not a guaranteed physical boundary.

## Try a two-player round

New rooms use entry 30 m, retention 40 m, maximum uncertainty 15 m,
dwell 2000 ms, grace 3000 ms, and a ten-minute round. Influence expires after
30 seconds without a new usable position. These values do not establish GPS
accuracy. Measurements are optional; you can start without them.

Select **Create room** to join as the host player. Share **Copy invite link**;
the other player opens the link and selects **Join room**. Watch the player list
update in the waiting room.

Expand **Advanced settings** to change range, uncertainty, dwell, grace,
or duration before starting. Saved settings take priority over the defaults.
The 30-second inactivity rule is fixed.

The host selects **Start game** with two joined players, with or without GPS.
Each player selects **Share location** when ready. The app uses the first
available watch fix and sends further positions as callbacks arrive.
If access is blocked, change browser and device location settings, then retry.
No clock or freshness check is part of starting or resuming.

Check that lobby and paused radar show available positions. Cached,
approximate, and old markers stay visible. At 30 seconds, influence stops
but the last-known marker remains. Stop sharing without leaving, then
share again; a repeated capture must not extend its original deadline.
Invite another player during play and check the roster and grace period.

Try safe approaches and departures. Check outgoing and incoming attack
progress, interruption reasons, faction symbols, and post-change grace.
Conversion notifications stay on screen until you dismiss them. An off-screen
history entry does not count as visible feedback.
On the host phone, expand **Change player factions** to change a faction.
This is a manual change, not a conversion; it must clear both attack roles
and give grace only once.
Pause the round and verify that time and grace stay fixed while location
sharing and radar continue. Select **Resume round** without a GPS check.
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

Record device limits with the trial results. Ordinary rounds require no
mode switch or parameter approval. Initial two-iPhone measurements do not
prove mixed-device or Android accuracy.

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
