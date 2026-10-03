# Two-iPhone outdoor trial

Use exactly two iPhones for the first field trial. Synthetic software checks
do not measure GPS accuracy. Results apply only to the tested phones, iOS
versions, browser modes, and outdoor conditions.

## Before collection

Use a deployed HTTPS origin. A plain HTTP LAN address cannot replace it.
Agree on a bounded outdoor area and safe routes. Mark known separations with
a tape measure. Do not run, touch other players, enter roads, or trespass.

Open Monk on both phones. On the first phone, create a match, then select
**Join as a player on this phone**. Join the second phone with the eight-character
code. The code does not give host control.

Keep both screens on and apps visible. Enter both phone models, iOS versions,
browser modes, and outdoor conditions. Do not enter names or coordinates.
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

Recommendations are provisional. Diagnostic freshness is 5000 ms; it is not
a gameplay value. Evaluate candidate radii, uncertainty, freshness, dwell,
and grace with the actual phone pair before a normal round. GPS uncertainty
is reported evidence, not a guaranteed physical boundary.

## Install icons

Source artwork is `public/icons/icon.svg`. Regenerate the PNG assets with
ImageMagick:

```sh
convert -background none public/icons/icon.svg -resize 192x192 public/icons/icon-192.png
convert -background none public/icons/icon.svg -resize 512x512 public/icons/icon-512.png
```
