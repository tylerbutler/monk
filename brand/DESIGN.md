---
name: "Monk - Side by Side"
description: "Change sides. Keep playing."
colors:
  ink: "#171719"
  white: "#ffffff"
  faction-rock: "#eb6256"
  faction-paper: "#f2cf45"
  faction-scissors: "#69b5f5"
  secondary: "#535353"
  line: "#d9d9d9"
typography:
  display:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: "clamp(3rem, 6.2vw, 6rem)"
    fontWeight: 750
    lineHeight: 1
    letterSpacing: "-.04em"
  headline:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: "clamp(2rem, 3.6vw, 3.5rem)"
    fontWeight: 700
    lineHeight: 1.05
    letterSpacing: "-.035em"
  title:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-.02em"
  body:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: ".95rem"
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: ".875rem"
    fontWeight: 400
    lineHeight: 1.5
  metadata:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: ".85rem"
    fontWeight: 400
    lineHeight: 1.5
spacing:
  rem-1: "1rem"
  rem-1-5: "1.5rem"
  rem-2: "2rem"
  rem-2-5: "2.5rem"
  rem-3: "3rem"
  rem-4: "4rem"
---

# Design System: Monk - Side by Side

## Overview

**Creative North Star: "Side by Side"**

Two equal arches, drawn from reversible team bibs, make a custom lowercase
Monk wordmark. Colors exchange while both forms remain. The identity is
minimalist but distinct: flat fields, open space, and short, friendly lines.
The lead line is "Change sides. Keep playing."

This record covers the built identity kit in `brand/` and its approved app
application below. It records the approved palette-only revision
of the code-led Side by Side direction; there was no approved image comp.
Geometry, typography, and composition structure remain intact. The prior
palette's review disposition does not certify this revision; no external
review verdict for this revision is recorded here. The repository's
`PRODUCT.md` remains product truth; root `DESIGN.md` remains the game/system
concept document.

The bounded app extension received a finish disposition of **ship, no material
fixes**, based on seven required captures and sampled source. This confirms
the inherited identity's app application, not a new visual world or a full
marketing-kit re-review; it does not extend the prior palette review.

**Key Characteristics:**
- Custom path lettering and two matching arches.
- Three exact faction colors shared with gameplay, supported by ink and white.
- Hanken Grotesk supporting copy in sentence case.
- Flat, spacious compositions with a short line and a large mark.

Evidence: [direction contract and kit](index.html), [stylesheet](styles.css),
[asset guidance](README.md), and the original SVGs linked below. Frontmatter
records reused values; spacing names are documentation labels, not existing
CSS variables. Component-specific preview details are below and in the
repository's scoped sidecar, `.impeccable/design.json`. The sidecar is not
published with the website and does not define a new app component API.
The public kit's path remains `/brand/`. Its color guide links to the separate
faction workups at `/brand/studies/`, including all three PNG downloads,
the side-by-side preview, and the hand icon license.

## Colors

Three equal primary colors share their meanings with gameplay; ink and
white support them. The frontmatter preserves the exact source palette
without adding tonal ramps.

### Primary
- **Rock red:** first arch in the paired download, hero, and avatar; an
  accent in both marketing samples.
- **Paper yellow:** hero copy, social graphic, and avatar fields; the second
  arch in the blue invite.
- **Scissors blue:** second arch in the paired download, hero, and avatar;
  the dominant field in the square invite.

### Neutral
- **Ink:** main type and marks on white or any faction color; reversed
  wordmark sheets and dark controls.
- **White:** open space, reversed lettering, and text on ink.
- **Secondary:** muted kit notes and metadata, not a second brand accent.
- **Line:** thin kit borders and dividers, not a faction or mark color.

**The Shared Factions Rule.** Brand and gameplay share the same three colors. Red stays Rock, yellow stays Paper, and blue stays Scissors. Identify factions with names and hand icons as well as color; the app's faction assignments remain unchanged.

**The Dominant Field Rule.** Use one dominant faction-color field per marketing composition, with the other two colors as accents.

**The Readable Pairings Rule.** Use ink text on white and all three faction colors. White text belongs only on ink, not on red, yellow, or blue.

The light symbol-preview stage (`#f5f5f5`), action-hover shade (`#303033`),
and tap highlight (`#f2cf4566`) are local preview treatments, not additions
to the identity palette.

### Painted-bounce motion study

The separate [motion preview](motion.html) draws the paired mark as paint
left by an implied bouncing ball. No ball is visible. Yellow paints both
arches, then red follows through the first and blue finishes the second.
Each color starts 0.1 seconds before the previous color finishes. Both yellow
arches stay beneath red and blue. Blue covers red at the shared stem. Every color
draws at a constant speed, taking 0.7 seconds per arch, with no easing at
the apex or baseline. The center turn stays flat at the baseline; no
yellow curve extends below it. The finished paint stays still; the mark
does not stretch, rotate, or rebound.

The vector Lottie has 2.6 seconds of motion and a 0.4-second final hold
within a 3-second, 60-fps sequence. Playback is once, not a loop. The final
state preserves the red-left/blue-right symbol. Reduced motion shows the
static SVG, as does a loading failure. Replay, half speed, and a timeline
are preview controls only; the game remains unchanged.

## Typography

**Display and Body Font:** Hanken Grotesk, with sans-serif fallback.
The local variable font supports weights 100-900, uses `font-display: swap`,
and disables font synthesis. Keep [the OFL](assets/OFL-HankenGrotesk.txt)
with [the font](assets/HankenGrotesk.ttf). The source attribution is the
Hanken Grotesk Project Authors via the Google Fonts distribution.

### Hierarchy
- **Display:** large, tight lead lines. Sample headlines reuse its weight,
  leading, and tracking but scale to their own containers.
- **Headline:** fluid section headings. The type specimen uses the same
  weight, leading, and tracking at its own preview size.
- **Title:** subsection headings; bold swatch names share the size.
- **Body:** regular instructions. The kit inherits the browser's base size
  rather than fixing pixels; `1rem` records that relationship.
- **Label:** navigation and usage notes.
- **Caption:** asset captions; mobile exceptions are local to the preview.
- **Metadata:** license, definition labels, and swatch explanations.

The ramp is role-based, not a fixed ratio. Introductory copy uses slightly
larger body sizes (1.1rem and 1.2rem). Paragraphs cap at 70ch; section
introductions and type/voice copy narrow to 47ch. Headings use balanced
wrapping. Sentence case, bold short headlines, and regular instructions
carry the voice; there is no separate mono or icon font.

The frontmatter hierarchy above describes the kit, not the app's fixed-rem
sizes. The app uses body text (1rem, line-height 1.55), section headings
(1.6rem), and subheadings (1.15rem). Entry lead type is 3rem, reducing to
2rem at 640px or less. Running/paused faction headings and clocks use 2rem,
reducing to 1.75rem at 480px or less. Player distance numerals stay 1.8rem
with 1.1 leading; distances and clocks use tabular numerals.

**The Lettering Is Artwork Rule.** Hanken Grotesk supports the identity; it is not the wordmark. Use the supplied SVG paths instead of typing or redrawing "monk".

## Layout

The kit preview has a centered maximum width (1440px) and fluid side gutters
(`clamp(1.25rem, 5vw, 5rem)`). Repeated spacing steps organize captions,
panels, and sections; section top space is fluid
(`clamp(4rem, 8vw, 7rem)`). This is preview layout evidence, not an app grid.

At desktop widths, the hero pairs a yellow copy field with red/blue arches
on a white symbol field (1.15fr / 1fr). Section introductions, wordmark
sheets, and type/voice use two columns; symbols use three. The primary
palette uses three equal columns (`repeat(3, minmax(0, 1fr))`) for Rock,
Paper, and Scissors. A separate support-neutral row uses two equal columns
for ink and white, with a 120px minimum swatch height.

At `max-width: 700px`, the hero, introductions, wordmark sheets, type/voice,
and invite row stack. Symbols remain three across. The primary swatches
stack in one column; the support-neutral row stays two columns. The swap
symbol becomes 180px wide, and the footer stacks. The masthead gap tightens
from 2rem to .75rem (12px at the default 16px root size). The masthead
wordmark stays 104px wide at all breakpoints: its link uses `flex-shrink: 0`
to prevent compression below that minimum.
At `min-width: 1600px`, only the hero gains side borders.
These breakpoints describe the identity-kit preview, not the app or fixed
PNG exports.

Marketing samples preserve their wide (1200 / 630) and square (1 / 1)
aspect ratios. Container-relative headline sizes (7.4cqw wide, 8.4cqw square)
and percentage positioning keep their composition proportional; these are
two shipped sample layouts, not a universal spacing scale.

The app instead centers a 48rem shell within `100% - 2.5rem`; at 480px or
less its width is `100% - 2rem`. Homepage width is capped at 72rem within
`100% - 2rem`; valid-invite entry is capped at 36rem. Desktop radar/list
columns are `minmax(0, 20rem) minmax(0, 1fr)` with a 1.5rem gap.
The player list has an 18rem maximum height with vertical scrolling. At 640px or less,
entry stacks and gameplay orders players, readout/controls, radar, then
details; radar width becomes `min(100%, 17.5rem, 36svh)`.
The later landscape exception at `max-height: 500px` restores equal
two-column radar/list layout with a 1rem gap and radar width
`min(100%, 52svh)`, overriding the list-first layout even below 640px.
Running/paused HUD padding is 1rem, reducing to .75rem at 640px or less;
the game shell also respects safe-area insets.

## Elevation & Depth

The kit uses flat color fields and thin line-color borders (1px), with no
shadows or gradients. Contrast and whitespace separate areas. Borders are
native to the kit; a blanket "no borders" rule would misdescribe it.

**The Flat Fields Rule.** Keep identity applications flat. Separate fields with color, space, or thin borders; do not add effects to the marks.

## Shapes

### Original mark geometry

The supplied SVG paths are authoritative, not a reconstruction recipe:

- [Primary wordmark](assets/wordmark.svg) and
  [reversed wordmark](assets/wordmark-reversed.svg): identical geometry in
  a 522 x 160 viewBox. The arches sit 40 units below the top of the
  ascender. The `n` repeats the arch geometry. The `o` has outer ellipse
  radii 52 / 60 and inner radii 24 / 32; the `k` has a 28-unit stem.
- [One-color symbol](assets/symbol.svg) and
  [paired symbol](assets/symbol-paired.svg): 140 x 120 viewBox. Each arch
  is 84 units wide, with outer radius 42, inner radius 14, and stem width
  28. The second arch is translated 56 units horizontally; they overlap
  on one shared stem. The second path paints over that overlap.
- [Avatar](assets/avatar.svg): square 512 x 512 Paper yellow field. The
  Rock red and Scissors blue arches use `translate(116 136) scale(2)`,
  giving 280 x 240 artwork centered in the square. The export itself has
  square corners and accommodates a circular crop.

**The Same Shape Rule.** Exchange the paired arches' colors without moving, removing, or changing either form or the combined silhouette.

**The Stem Space Rule.** Leave at least one stem-width of clear space around a mark: 28 source units, scaled with the artwork. Use the wordmark at least 104px wide and the symbol at least 24px wide; below 48px, use the one-color symbol.

Most preview fields have square corners. The download action alone uses
a small radius (.3rem); the avatar preview alone uses a 28% corner radius.
Neither establishes a general corner scale or changes the SVG geometry.

## Components

### Marks and asset sheets

The wordmark leads; the symbol serves tight spaces. Use ink lettering on
white or any faction color and the supplied white lettering on ink. The
paired download uses red and blue on white; the social graphic uses that
mark on yellow. The square invite uses red/yellow arches with ink type and
the ink wordmark on blue. Small marks remain one color.

Asset sheets pair large artwork with a caption and a download link. Wordmark
sheets have roomy padding and a dark reversed variant; symbol stages have
a local pale background (`#f5f5f5`). They are presentation sheets, not an
app card family.

### App application

The app reuses the original wordmark, paired symbol, local Hanken Grotesk
font, ink/white controls, and exact faction colors. Entry leads with room
actions and a compact yellow introduction; valid invitations prioritize
joining. Short rules follow entry, with full rules in a closed disclosure.
Malformed room-code submissions retain inputs, mark the field invalid,
associate the error text, and return focus to the code field. App keyboard
focus uses a 3px ink outline with a 3px offset, separate from kit focus.
Location sharing remains off until explicitly chosen, with a visible
sharing state and Stop sharing action; gameplay and privacy are unchanged.

During running and paused play, a larger color field follows the player's
own faction. Text stays ink on every faction field; an observer without a
faction uses a neutral field. The radar has an ink face, light range rings,
and upright distance labels. Named hand icons and target/threat indicators
retain their game meanings.
Radar ring labels and the caption show half-range and full-range distances.

Player names, roles, and approximate distances stay visible, without a
duplicate Players dropdown in the waiting room. When the distance list is
unavailable, a plain roster stays visible. Start game sits next to Copy
invite link for the lobby host and requires at least two joined players.
The invitation also has an ink-on-white QR code with a four-module quiet
zone. It uses the same public room URL as the link and is generated locally.
A PNG download stays available when native image sharing is unsupported.
Desktop pairs
the list and controls with the radar; at 640px or less they precede the radar.
Short landscape screens retain two columns. Stale positions are labeled,
and GPS details remain in disclosures. App styling lives in
`src/client/styles.css`, separate from the kit preview's layout rules;
entry and state evidence is in `src/client/app.ts`, `Match.svelte`, and
`Radar.svelte` in the same directory.

### Download action and navigation

The preview's primary action is an ink link with white text, an inline SVG
arrow, weight 650, padding (.8rem 1.1rem), a 2rem gap, and minimum height
(48px). Hover changes only its background (`#303033`). Navigation uses
plain text links with an underline on hover. Navigation, download-caption
links, and the swap label have minimum-height targets (44px).

Links use a 1px underline with .25em offset, increasing to 2px on hover
where underlined. Keyboard focus uses a 3px current-color outline with a
5px offset; the action fixes its outline to ink. The skip link appears on
focus. Links, inputs, and labels use the yellow tap highlight (`#f2cf4566`).
These are kit interactions, not app-wide control specifications.

### Swap sides preview

A labeled native checkbox exchanges Rock red and Scissors blue fills on the
two original paths. The geometry and DOM order stay fixed. Only these paths transition:
`fill 320ms cubic-bezier(.16, 1, .3, 1)`. Under
`prefers-reduced-motion: reduce`, only this transition is removed; the
checkbox still swaps colors immediately. No app motion system is implied.

### Sample graphics and provenance

Use flat color, a short line, and one large mark. The wide introduction and
square invitation are marketing graphics, not app screenshots. The social
graphic uses a yellow field, ink type/wordmark, and red/blue mark. The invite
uses a blue field, ink type/wordmark, and red/yellow mark. The avatar uses
red/blue arches on yellow.

| Export | Source | Shipped size |
| --- | --- | --- |
| [Social PNG](samples/social-1200x630.png) | `index.html` / `#social-sample`, `styles.css`, local font and SVGs | 1200 x 630 |
| [Invite PNG](samples/invite-1080.png) | `index.html` / `#invite-sample`, `styles.css`, local font and SVGs | 1080 x 1080 |
| [Avatar PNG](samples/avatar-512.png) | `assets/avatar.svg` | 512 x 512 |

Keep each PNG's embedded `tEXt` entry, keyed `impeccable:prompt`, identifying its
source and headless Chromium export at DPR 1, with no image-generation model.
Refresh that provenance with every export. Current HTML/CSS/SVG sources
govern the revised palette; older PNG colors are not authority.
The SVGs are original geometric artwork created for this identity. No
generated photographs or third-party illustrations are part of the kit;
original artwork is not a trademark-clearance claim.

## Do's and Don'ts

### Do:
- **Do** use the supplied wordmark first and the symbol when space is tight.
- **Do** preserve one stem-width of clear space and the stated minimum sizes.
- **Do** keep both arches present when their colors exchange.
- **Do** keep faction meanings fixed and identify factions with names and hand icons as well as color.
- **Do** use one dominant faction-color field per marketing composition, with the other two as accents.
- **Do** use sentence case and short, friendly invitations, led by "Change sides. Keep playing."
- **Do** keep the font license and raster provenance with the distributed assets.

### Don't:
- **Don't** stretch, rotate, outline, redraw, or add effects to the marks.
- **Don't** typeset the wordmark in Hanken Grotesk or another font.
- **Don't** use a paired-color symbol below 48px wide.
- **Don't** use white text on faction-color fields; use ink text on all three colors.
- **Don't** reassign faction colors or change gameplay through visual updates.
- **Don't** present sample graphics as app screenshots or claim trademark clearance.
