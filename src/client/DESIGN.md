---
name: "Monk app - Side by Side"
description: "Change sides. Keep playing."
colors:
  ink: "#171719"
  white: "#ffffff"
  faction-rock: "#eb6256"
  faction-paper: "#f2cf45"
  faction-scissors: "#69b5f5"
  muted: "#535353"
  line: "#d9d9d9"
  surface-subtle: "#f5f5f5"
  threat: "#85221b"
  incoming-surface: "#fff1eb"
  control-hover: "#303033"
  field-line: "#17171966"
typography:
  display:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: "2.5rem"
    fontWeight: 750
    lineHeight: 1.2
    letterSpacing: "-.035em"
  headline:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: "1.75rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-.025em"
  title:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: "1.15rem"
    fontWeight: 700
    lineHeight: 1.55
  body:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.55
  caption:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: ".8rem"
    fontWeight: 400
    lineHeight: 1.55
  metadata:
    fontFamily: '"Hanken Grotesk", sans-serif'
    fontSize: ".85rem"
    fontWeight: 400
    lineHeight: 1.55
rounded:
  control: ".25rem"
spacing:
  rem-0-5: ".5rem"
  rem-0-75: ".75rem"
  rem-1: "1rem"
  rem-1-25: "1.25rem"
  rem-1-5: "1.5rem"
  rem-2: "2rem"
  rem-2-5: "2.5rem"
  rem-3: "3rem"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: ".7rem 1rem"
  button-primary-hover:
    backgroundColor: "{colors.control-hover}"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: ".7rem 1rem"
  button-secondary-hover:
    backgroundColor: "{colors.surface-subtle}"
  input:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: ".65rem .75rem"
  game-hud:
    padding: "1.5rem"
  game-hud-phone:
    padding: "{spacing.rem-1}"
---

# Design System: Monk app - Side by Side

## Overview

**Creative North Star: "Side by Side"**

The app extends the supplied paired-arch identity into a clear, flat interface
for outdoor play. Local Hanken Grotesk, original SVG marks, exact faction
colors, ink controls, and thin dividers do the work; there is no new world,
image comp, authored shipping raster, or splash animation.

This scoped record is authoritative for **app-specific layout, sizing, and
controls** in `src/client/`. It inherits marks, palette, font, and identity
geometry from [the kit guide](../../brand/DESIGN.md) and
[kit assets](../../brand/assets/). The kit's earlier app measurements do not
override the current stylesheet recorded here. [Root DESIGN.md](../../DESIGN.md)
remains the separate game/system concept; [PRODUCT.md](../../PRODUCT.md) remains
product truth. Visitor mode is **Operate**, not a mode imposed on other surfaces.

**Key Characteristics:**
- Flat yellow entry and invitation fields; an own-faction field during running and paused play.
- Supplied paired arches remain visible on phones; lettering remains artwork.
- Named factions and hand SVGs support color; distances and clocks use tabular numerals.
- Nearby players, conversion state, and consent controls stay legible; technical detail uses disclosures.
- Persistent entry/rules and invitation components preserve input and interaction continuity.

Evidence: [styles.css](styles.css), [Entry.svelte](Entry.svelte),
[RoomInvite.svelte](RoomInvite.svelte), [InviteQr.svelte](InviteQr.svelte),
[Match.svelte](Match.svelte), [Radar.svelte](Radar.svelte),
[app.svelte.ts](app.svelte.ts), and [main.ts](main.ts).
The first body child is the direction-contract comment in both
[index.html](../../index.html) and [dist/index.html](../../dist/index.html).
The shipped implementation, not that contract's intentions, supplies the values.
Frontmatter spacing and role names are documentation labels, not new CSS variables.

**Finish scope:** the supplied reviewer disposition is **SHIP, no material
fixes**, covering sampled source and all twelve required captures in
[the review directory](../../.impeccable/review/): `desktop.png`, `mobile.png`,
`small-mobile.png`, `entry-641.png`, `entry-768.png`, `lobby-desktop.png`,
`lobby-mobile.png`, `game-desktop.png`, `game-mobile.png`, `radar-desktop.png`,
`radar-mobile.png`, and `paused-mobile.png`. This is the bounded app finish,
not broad marketing-kit approval, visual certification of unpictured states,
or physical GPS validation. The supplied detector result was `[]`; no new
detector run is part of this record. No raster was authored for this extension.
Invitation PNGs are runtime-generated QR exports, not authored identity imagery.

## Colors

Three fixed faction colors supply identity and game meaning; ink, white, and
quiet neutrals keep the operational interface clear.

### Primary
- **Rock red:** Rock identity, rules tile, faction markers, and the player's Rock field.
- **Paper yellow:** Paper identity and markers; the branded entry and room/invitation field.
- **Scissors blue:** Scissors identity, rules tile, faction markers, and the player's Scissors field.

### Secondary
- **Threat:** incoming conversion, error/warning text, and threat role treatment outside the colored HUD; it is not another faction.
- **Incoming surface:** pale backing for incoming conversion panels, incoming player rows, and errors.

### Neutral
- **Ink:** primary text, strokes, controls, and the circular in-game radar face.
- **White:** page and input surfaces, reversed controls, and details within the ink radar face.
- **Muted:** secondary information on white. Yellow room fields and colored game fields locally resolve muted copy to ink.
- **Line:** thin separators and progress tracks on white.
- **Surface subtle:** secondary hover and neutral waiting surfaces.
- **Control hover:** primary and pressed-control hover shade.
- **Field line:** translucent ink separators on faction fields and the room status divider.

**The Shared Factions Rule.** Red stays Rock, yellow stays Paper, and blue stays Scissors. Keep faction names and supplied hand SVGs alongside color.

**The Readable Pairings Rule.** Use ink text on white and faction fields; reverse text on ink. White radar labels, halos, and link underlays belong to the ink radar drawing, not a new white-on-faction body-text treatment.

The source aliases accent to ink and surface to white; no additional palette
is implied. The sidecar's synthesized eight-step OKLCH strips are panel-only
swatch previews, not shipped tonal tokens or permission to vary faction colors.

## Typography

**Display and Body Font:** local Hanken Grotesk, with sans-serif fallback.
The variable TTF in `brand/assets/` supports weights 100–900, loads with
`font-display: swap`, and disables synthesized font styles. Retain its OFL.
There is no separate display system font, mono face, or icon font.

**Character:** short, friendly, sentence-case headings paired with direct
instructions. The ramp is role-based rather than a geometric scale.

### Hierarchy
- **Display:** the frontmatter role describes the own-faction heading during play. The rules heading shares the desktop size with slightly different tracking.
- **Headline:** regular section and non-playing HUD headings.
- **Title:** subheadings and the player-list heading.
- **Body:** browser-relative base size; paragraphs cap at 70ch.
- **Label:** grid-based form labels. Buttons and disclosure summaries use a slightly stronger weight (650), not the label token.
- **Caption / metadata:** reference notes, QR captions, location state, and faction labels; do not promote these into headings.

Component-specific applications, not extra global type tokens:
- Entry lead: desktop (3.75rem, 750, line-height 1, tracking -.04em); 641–900px (2rem); <=640px (1.75rem, line-height 1.05); <=480px (1.5rem).
- Entry lead copy: desktop (1.15rem, line-height 1.5); intermediate (1rem); phone (.9rem, line-height 1.4); narrow phone (.85rem).
- Entry action heading: desktop uses the headline role; phone (1.4rem), narrow phone (1.25rem).
- Room heading: desktop (2.25rem, 750, tracking -.035em); phone (1.75rem).
- Playing faction heading and clock: desktop (2.5rem); phone (2rem); narrow phone (1.75rem). Heading weight is 750 with 1.2 leading; clock weight is 700 with 1.15 leading.
- Player distance numerals remain (1.8rem, 700, line-height 1.1, tracking -.025em); their approximate qualifiers are (.75rem).

**The Lettering Is Artwork Rule.** Use the supplied path wordmark and paired arches; Hanken Grotesk supports the identity, never substitutes for its lettering.

**The Stable Numbers Rule.** Use tabular numerals for clocks, distances, conversion readouts, compact in-game room codes, measurements, and history times.

## Layout

The normal app container is centered (maximum 64rem, width `min(100% - 3rem,
64rem)`), with desktop top/bottom padding (2rem / 3rem). Entry expands to
76rem while retaining those side gutters. At <=640px both use `calc(100% -
2rem)` with 1rem top padding. The masthead wordmark is 128px wide on desktop,
104px on phones. Dividers replace repeated card wrappers.

Repeated spacing runs from half-rem gaps through three-rem panel padding,
with quarter-rem intermediate steps. Large white-space separates entry from
rules (4rem desktop, 2.5rem phone); this is surface-specific, not a universal
section spacing requirement.

### Entry and invitations
- Above 900px: branded introduction and room actions share a grid (1.15fr / 1fr). The yellow intro has 3rem padding; the actions have 2.5rem vertical / 3rem horizontal padding and a thin border. The paired symbol is 14rem wide with 1.5rem margin.
- At **641–900px inclusive**, panels stack. The intro becomes a compact grid (`minmax(0, 1fr)` / 5rem), with 1.5rem padding and gap; actions also use 1.5rem padding. This protects readable code input, not merely a phone fallback.
- At **<=640px**, intro text sits beside 4rem arches; panel padding and gap become 1rem.
- At **<=480px**, arches become 3.5rem and panels use .75rem padding/gap; form labels shrink to .85rem, join gaps to .5rem, and join-button horizontal padding to .75rem.
- The code field stays beside Join through these ranges (`minmax(0, 1fr)` / auto). Helper and error rows span both columns. Create fills the available width.
- A valid invitation uses a centered yellow join-first panel (maximum 32rem), hides the code label/input, and spans Join across the form; Create becomes secondary. It does not repeat the non-invited intro.
- Rules follow actions: three equal faction tiles and three instruction columns, with the steps stacking on phones. Narrow-phone tiles retain three columns but place icons above labels.

### Waiting room
- Desktop: yellow room/invite area beside the players (`minmax(0, 1.05fr)` / `minmax(0, 1fr)`), with 2.5rem column gap. Room padding is 2rem.
- At <=640px: one column with 1.5rem gap, room padding 1.5rem; <=480px reduces room padding to 1rem.
- The QR shares a row with its actions (10rem QR track / remaining width); the narrow-phone QR track is 9rem. QR and its white quiet zone remain unembellished.
- The lobby player/readout/radar/details order is vertical even on desktop. The empty radar is hidden until a reference position exists.

### Running and paused play
- Both phases use the same own-faction field with 1.5rem padding, reduced to 1rem on phones. Faction and clock share the top row; nearby players remain exposed.
- Desktop radar layout uses a 20rem maximum radar column beside players/readout, with 1.5rem gap and details across both columns.
- At <=640px the order becomes players, readout, radar, details. Radar width is `min(100%, 17.5rem, 36svh)`.
- The player list scrolls after 18rem. Player names/roles and right-aligned distance values have distinct tracks; unavailable distances can wrap.
- Landscape at **<=500px high** restores two equal columns, radar left and players/readout right, with a 1rem gap and radar width `min(100%, 52svh)`. It also uses safe-area-aware horizontal margins.
- Gameplay uses safe-area-aware top/bottom padding. Room/options and safe-play details move below the field; operational warnings still surface when needed.

**The Readout Before Diagnostics Rule.** Keep faction, clock, nearby players, and conversion state exposed. Put technical location detail and secondary room/host tools in disclosures without removing consent, warnings, safe-play notes, or any host action.

## Elevation & Depth

The shipped app has no box-shadow vocabulary. Flat fields, thin borders,
tonal alert backing, and an ink radar disk distinguish regions without
floating cards. The fixed conversion notice uses an ink border (2px), not
a shadow; focus uses an ink outline (3px with 3px offset).

**The Flat Fields Rule.** Separate app regions with color and thin dividers, not elevated generic cards. Preserve functional focus outlines and radar halos.

## Shapes

Large fields and panels are square; small controls have the reused quarter-rem
radius from frontmatter and thin ink borders. Inputs use a neutral stroke
(`#757575`). Relationship labels have small corners (.2rem); conversion
panels use .3rem. These are local shapes, not an expanded radius scale.
Round faction backings, role badges, progress rings, and the radar disk remain
native parts of the interface; flatness does not prohibit circles or outlines.

The supplied paired symbol retains its 140 × 120 viewBox and original paths:
equal arches, shared stem, Rock left and Scissors right. Scale uniformly;
do not redraw, stretch, crop, or turn it into a new decorative silhouette.

## Components

### Buttons
Compact, ink-led controls with explicit text.
- Primary: ink/white, 1px border, frontmatter radius/padding, minimum 3rem height, weight 650. Secondary: transparent/ink with the same border.
- Hover uses the recorded primary or secondary shade; active primary resolves to black. Disabled controls have .55 opacity and `not-allowed`; busy controls use `wait`.
- HUD controls occupy two equal columns with .75rem gap, minimum 2.75rem height, .5rem padding; their phone-narrow text is .9rem. Within the faction field secondary HUD controls have white backing; pressed compass uses ink/white.
- State transition is background-color only (160ms ease-out). Reduced motion removes button transitions. No splash or animation dependency is imported by the gameplay entry.
- All interactive elements use the shared visible focus outline. Supplied Tabler SVGs accompany labels, never replace action names.

### Inputs / fields
White, ink-text fields with neutral 1px stroke, minimum 3rem height, inherited
font, and the frontmatter padding/radius. Labels use a .35rem gap. An invalid
code gets the threat stroke and linked inline error; entered code persists
and focus returns to the code field. Native validation and busy labels remain.

### Masthead / navigation
An artwork wordmark sits opposite Skip to play before entry, or the compact
room code during play. Skip to play is a real underlined anchor (minimum
2.75rem height, weight 650), not a pill. The masthead has a thin bottom divider;
the playing version reduces vertical spacing rather than hiding the identity.

### Fields / containers
Entry, room invitation, and game HUD are deliberate flat regions, not a card
library. Apply their distinct padding and responsive behavior from Layout.
Use the player's faction for running/paused fields; a non-player host view
falls back to the subtle neutral surface.

### Invitation / QR
Invite players is open by default in the lobby. Copy is secondary; Start is
primary and disabled below two players. Copy/busy/status feedback stays in
the invitation. QR uses ink on white, quartile error correction, and a four-module
border. The default standalone QR maximum is 15rem; room tracks constrain it
as recorded in Layout. Scan caption includes the room code. Runtime exports
are 1024 × 1024 PNG; native file sharing appears only when supported, with
download/copy fallbacks and error/status text retained.

### Player rows / relationship labels
Rows use thin separators, 1rem vertical padding, bold names, named factions
with hand icons, and visible approximate distances. Relationship labels use
current-color borders and weight 650. Stale distances acquire dashed
underlines plus last-known text; unavailable locations use text, not an
invented zero. Incoming rows receive the alert backing. Location details
remain an optional disclosure.

### Radar / conversion readout
The source draws an SVG radar (320 × 320 viewBox), two measured rings, an
entry-radius dashed circle, numbered faction markers, compass labels, and
a textual range caption. In play the radar face is ink, with white grid/halos
and named faction fills; the player list remains the accessible readout.
Numbers match the list. Incoming influence uses threat color and dashed
links; outgoing uses ink. White link underlays preserve visibility on the
disk. Stale markers have dashed strokes. These functional drawing treatments
are not decorative illustration rules.

Conversion panels show direction in words, remaining seconds/confirmation,
percentage, progress, and movement guidance. Incoming panels use threat
and pale backing. Stopped/offline/approximate states retain their text.
The fixed conversion notice is dismissible, width `min(100% - 2rem, 48rem)`,
safe-area-aware, and scrollable within the viewport.

### Disclosures / continuity
Native summaries have minimum 2.75rem height, .6rem vertical padding, and
weight 650. Full rules, room/options, host controls/settings/diagnostics,
radar details, faction history, and safe play remain available. Start,
pause, resume, end, faction changes, settings, diagnostics, and leave are
not removed for visual simplification; paused hosts also get a visible
Resume action outside the host disclosure.

Entry/rules, RoomInvite, and InviteQr are persistent Svelte components;
the controller updates reactive props instead of recreating them on routine
updates. Preserve typed values, selection/focus, disclosure state, and live
status feedback. Location sharing stays explicit opt-in with a visible Stop
sharing control; visual cleanup must not imply consent.

## Do's and Don'ts

### Do:
- **Do** inherit the exact faction palette, local Hanken Grotesk, and supplied SVG geometry.
- **Do** use this app record for current control sizes and breakpoint behavior rather than the kit's earlier app measurements.
- **Do** keep arches on phones and stack entry panels throughout 641–900px so the code field remains readable.
- **Do** preserve approximate/last-known text, visible consent controls, rules, warnings, safe-play notes, and every host action.
- **Do** retain thin dividers, focus outlines, functional circles, and radar halos in the flat system.

### Don't:
- **Don't** swap faction meanings, type the wordmark, or redraw the paired arches.
- **Don't** add elevated generic cards, decorative raster imagery, or a splash-animation dependency to this app extension.
- **Don't** hide distances behind technical disclosures or treat radar positions as conversion confirmation.
- **Don't** globalize this app's Operate mode or its yellow entry/lobby composition to unrelated kit surfaces.
- **Don't** treat synthesized sidecar swatch strips as new palette tokens or the bounded app finish as a marketing-kit or physical-GPS approval.

**Not canonized:** the radar's `T`, `!`, and `=` role glyphs are a carried
glyph-icon defect, not a reusable icon vocabulary; retain existing behavior
without teaching future surfaces to inherit that shortcut. Isolated local
measurements, previous kit app sizes, separate brand motion studies, and
unpictured-state or physical-GPS assurances are likewise not system tokens
or app finish claims.
