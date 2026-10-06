# Monk: Side by Side

Open `index.html` in a browser to view the identity kit. It works from disk,
uses a local font, and does not need a server. This kit does not change the
app's interface, icons, or gameplay.

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
| `assets/symbol.svg` | One-color symbol, including small sizes |
| `assets/symbol-paired.svg` | Rock red and Scissors blue symbol on white or Paper yellow, 48 px or wider |
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
Do not rotate, stretch, outline, or add effects to the marks.

Use Hanken Grotesk Bold for headlines and Regular for body copy. The wordmark
is custom geometry, not typeset Hanken Grotesk; do not rebuild it by typing
the name.

Brand and gameplay now share colors. Red stays Rock, yellow stays Paper,
and blue stays Scissors; identify factions with names and hand icons as
well as color. The app's faction assignments and named hand icons remain
unchanged.

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
