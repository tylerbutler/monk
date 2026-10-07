# Monk: Side by Side

Open `index.html` in a browser to view the identity kit. It works from disk,
uses a local font, and does not need a server. The app also uses this identity;
its game rules and named faction hand icons stay unchanged.

The website also serves the kit at `/brand/`; `/brand` redirects there.
The regular website build copies this page, stylesheet, guides, assets,
samples, and studies into `dist/brand/`. The internal `.impeccable/` record
is not public. The color guide links to the three faction workups at
`/brand/studies/`, with downloads for each workup and a side-by-side preview.
This approved revision changes the main Side by Side palette only; geometry,
typography, and the kit's composition structure remain intact.

**Lead line:** Change sides. Keep playing.

Monk is an outdoor Rock, Paper, Scissors game for friends. Sustained proximity
can convert an opponent. A converted player changes sides and stays in the
game.

## Files

| File | Use |
| --- | --- |
| `assets/wordmark.svg` | Primary ink wordmark on white or any faction color |
| `assets/wordmark-reversed.svg` | White wordmark on ink |
| `assets/wordmark-paired.svg` | Wordmark reveal's static finish: red/blue m with ink onk |
| `assets/symbol.svg` | One-color symbol, including small sizes |
| `assets/symbol-paired.svg` | Rock red and Scissors blue symbol on white or Paper yellow, 48 px or wider |
| `assets/monk-entrance.json` | Different stops: all colors start on the left, with red stopping after the first arch |
| `assets/monk-entrance-all-arches.json` | All arches: yellow/blue/red at four times the original speed, then red clears from the second |
| `assets/monk-loading.json` | Continuous yellow/blue/red sweeps with realistic bounce timing through a fully visible m |
| `assets/monk-entrance-realistic.json` | Yellow/blue/red entrance with a fast launch, slow peak, and accelerating descent |
| `assets/monk-entrance-wordmark.json` | Realistic bounce, then a leftward m move and an ink onk reveal |
| `motion.html` | Standalone animation preview with replay, slow motion, and a timeline |
| `assets/avatar.svg` | Red/blue arches on yellow; safe within a circular crop |
| `samples/avatar-512.png` | 512 x 512 avatar |
| `samples/social-1200x630.png` | Yellow wide social graphic with ink type and red/blue mark |
| `samples/invite-1080.png` | Blue square invite with ink type/wordmark and red/yellow mark; send with a real room link |
| `studies/index.html` | Rock, Paper, and Scissors marketing workups |
| `studies/rock.png` | 1080 x 1080 Rock workup |
| `studies/paper.png` | 1080 x 1080 Paper workup |
| `studies/scissors.png` | 1080 x 1080 Scissors workup |
| `studies/comparison.png` | Side-by-side preview of the three workups |
| `studies/LICENSE-tabler.txt` | Hand icon license |
| `assets/HankenGrotesk.ttf` | Variable font, weights 100-900 |
| `assets/OFL-HankenGrotesk.txt` | Font license |
| `DESIGN.md` | Visual system and usage rules |

SVG marks use paths rather than text. They do not require a font to render.
The two equal arches share a stem. Their colors can change, but both forms
stay in place.

## Motion study

After `npm run build`, open `/brand/motion.html` on the local or deployed
website. Unlike the static identity kit, the motion preview needs the web
build and a server. The app does not load the Lottie player or animation.

An implied ball paints two bounces from left to right; no ball is drawn.
The treatment selector switches between five versions:

- **Different stops:** yellow paints both arches. Red follows from the
  left and stops after the first. Blue also starts on the left and crosses
  both, clearing its first-arch trail as it paints the second.
  Red starts at 1.3 seconds and blue at 1.9 seconds. The entrance takes
  3.3 seconds, followed by a 0.4-second hold, for 3.7 seconds total.
- **All arches:** yellow, blue, and red each paint both arches at four
  times the original speed, taking 0.175 seconds per arch. Blue starts
  at 0.325 seconds and red at 0.65 seconds, with 0.025-second color overlaps.
  Once red finishes at 1 second, its second-arch trail clears over
  0.175 seconds to reveal blue. A 0.1-second hold brings the total to
  1.275 seconds.
- **Loading:** yellow, blue, and red sweep through a fully visible m.
  Each color crosses both arches in 0.7 seconds, using the Realistic bounce
  quadratic ease-out on ascent and ease-in on descent. A red underlay joins
  the end to the start of the 2.1-second loop. There is no final hold
  or red-left/blue-right finish.
- **Realistic bounce:** yellow, blue, and red each cross both arches,
  taking 0.5 seconds per arch, with 0.05-second color overlaps.
  Blue starts at 0.95 seconds and red at 1.9 seconds. Quadratic timing
  slows each ascent to a stop at the peak, then accelerates the descent.
  Red finishes at 2.9 seconds; its second-arch trail clears over 0.5 seconds.
  A 0.3-second hold brings the total to 3.7 seconds.
- **Wordmark reveal:** Realistic bounce plays unchanged for 3.7 seconds,
  including its white upward guides and final symbol hold. The finished m
  moves left and scales down uniformly over 0.55 seconds, with quadratic
  ease-out. The original o, n, and k shapes fade in over 0.45 seconds, all
  in ink, starting 0.1 seconds apart. A 0.8-second hold brings the total to 5.5 seconds.
  The full wordmark is 240 units wide on the 280 x 220 canvas and runs at 60 fps.
  Its m stays red/blue; the original static ink wordmark is unchanged.

Different stops takes 0.7 seconds per arch, with 0.1-second color overlaps.
Different stops draws at constant speed at 60 fps; All arches uses
constant-speed motion at 120 fps. Loading, Realistic bounce, and Wordmark
reveal use realistic bounce timing at 60 fps.
Yellow stays beneath red and blue. The center turn is flat at the baseline,
with no paint extending below it. The three symbol-entrance final frames match the paired symbol:
red on the left, with blue on the right and on the shared stem.
Replay, half speed, the timeline, and the download use the selected treatment.

All five downloadable JSON files are vector-only, with a transparent 280 x 220 canvas.
They use paths, fills, strokes, and trim paths, with no images, fonts,
expressions, or effects. Wordmark letters use the supplied geometric shapes,
not typeset text.
Thin white guides outline only the upward strokes and disappear at the peak.
This motion-only exception does not change the static marks.
Play entrances once (`loop: false`) and hold their last frame. Play Loading
with `loop: true`. The preview pauses when the document is hidden. Show the static paired
symbol when reduced motion is requested, or `wordmark-paired.svg` for Wordmark reveal.
The selected static finish also stays visible when an animation cannot load.
Without JavaScript, the preview shows the default paired symbol.

Edit `scripts/generate-mark-animation.mjs` to adjust the timing, then run
`npm run build:mark` to regenerate all five `assets/monk-*.json` files.
The normal build also runs this step. Keep the final geometry and faction
colors fixed.

## Basic use

Use the exact faction colors: Rock red `#eb6256`, Paper yellow `#f2cf45`,
and Scissors blue `#69b5f5`, with ink `#171719` and white `#ffffff` as
support neutrals. Use ink text on white and all three faction colors;
white text belongs only on ink. Use one dominant color field per marketing
composition, with the other two colors as accents.

The kit's hero uses a yellow copy field beside red/blue arches on white.
The native "Swap sides" checkbox exchanges those two fills without changing
the geometry. Three equal primary swatches sit above a separate two-column
support-neutral row; at widths of 700px or less, the primary swatches stack
in one column while the neutral row stays two columns.

Leave at least one stem-width of clear space around a mark. Use the wordmark
at 104 px wide or larger, and the symbol at 24 px wide or larger. Below
48 px, use the one-color symbol. Keep the supplied proportions and colors.
Do not rotate, stretch, outline, or add effects to the static marks.
Only the supplied motion treatments use temporary white upward-stroke guides.

Use Hanken Grotesk Bold for headlines and Regular for body copy. The wordmark
is custom geometry, not typeset Hanken Grotesk; do not rebuild it by typing
the name.

Brand and gameplay now share colors. Red stays Rock, yellow stays Paper,
and blue stays Scissors; identify factions with names and hand icons as
well as color. The app's faction assignments and named hand icons remain
unchanged.

## App use

The app imports the supplied wordmark, paired symbol, and local font. Its
homepage puts room entry before the rules. The installed-app icons and
browser favicon use the avatar's red/blue arches on yellow.
During running and paused play, the main game panel uses the player's own
faction color with ink text; a host without a faction has a neutral panel.
Player distances stay visible beside the radar on desktop and above it on
phones. Range labels, approximate values, and last-known warnings remain
explicit. These changes affect presentation, not game rules or location privacy.

## Voice

Write as a friend explaining what to do. Keep competition light. Explain
conversion as changing sides, not elimination.

- Lead: "Change sides. Keep playing."
- Invite: "Meet outside. Start a room. Bring your friends."
- Explanation: "Get close to convert an opponent. Change sides and keep
  playing."

Use the longer product description when the rules matter: conversion needs
sustained proximity and a vulnerable faction. Do not claim instant or
precise tracking, background play, proven field accuracy, or public
matchmaking.

## Sources and exports

The SVG marks are original geometric artwork created for this identity.
They are not a trademark-clearance result.

[Hanken Grotesk](https://github.com/marcologous/hanken-grotesk) is by the
Hanken Grotesk Project Authors. The unmodified variable font and its license
come from the [Google Fonts distribution](https://github.com/google/fonts/tree/main/ofl/hankengrotesk).
The SIL Open Font License permits redistribution with the included license.
Keep that license with the font.

The social and invite PNGs are browser exports of `#social-sample` and
`#invite-sample` in `index.html`, at 1200 x 630 and 1080 x 1080. The avatar
PNG comes from `assets/avatar.svg` at 512 x 512. Keep each PNG's source in
embedded provenance metadata and refresh that metadata with every export.
The current HTML, CSS, and SVG sources govern the palette, not older PNG
colors. No generated photographs are part of this kit.

The faction workups use the game's unmodified Tabler hand icons.
Their MIT license is included in `studies/LICENSE-tabler.txt`; keep it with
the icons. The workup PNGs and comparison preview are browser exports of
`studies/index.html` and include embedded source metadata.

The prior palette's review disposition does not certify this revision.
No external review verdict for the three-color revision is recorded here.
