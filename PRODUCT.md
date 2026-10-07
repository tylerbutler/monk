# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Monk is for friends who want a casual outdoor game to play together. One
person creates a private room and shares an invitation with the group.

## Product Purpose

Monk brings a group into a shared physical play area. Players find each other,
change factions, and keep playing after a conversion.

## Positioning

Monk takes Rock, Paper, Scissors into an outdoor multiplayer game. Sustained
proximity can convert a vulnerable opponent. Conversion changes a player's
side; it does not remove the player from the game.

## Operating Context

Players use a mobile browser on a connected phone. They agree on an outdoor
play area and safe movement rules. During play, the app must stay visible and
the screen must stay on.

The product target is a PWA for iPhone and Android. The first physical trial
is limited to two iPhones; its results are still pending.

## Capabilities and Constraints

- Private rooms support invitation links, optional names, and late joining.
- Factions are Rock, Paper, and Scissors, with cyclic conversion rules.
- Radar helps players find others. Position estimates are not exact.
- Location sharing is optional and controlled by each player.
- Hosts can start, pause, resume, and end rounds.
- Current location data is held in temporary server memory.
- Physical GPS accuracy, Android behavior, and playtest results are not
  established by the automated tests.
- The current build has no offline cache or service worker.

## Brand Commitments

- The product name is Monk.
- The requested marketing identity is minimalist but distinct.
- The primary marketing audience is friends seeking a casual outdoor game.
- The first deliverable is an identity kit: logo, wordmark, typography,
  colors, voice, and sample applications.
- The app uses the Side by Side identity across entry, lobby, gameplay, and
  installed-app assets. Game rules and location-sharing behavior stay unchanged.
- The app currently identifies Rock in red, Paper in yellow, and Scissors
  in blue, with named Tabler hand icons. These remain unchanged in the app.
- The selected identity is Side by Side: a custom lowercase wordmark with
  paired arches. The approved palette revision shares the game's exact
  faction colors: Rock red `#eb6256`, Paper yellow `#f2cf45`, and Scissors
  blue `#69b5f5`, supported by ink `#171719` and white `#ffffff`. Its lead
  line remains "Change sides. Keep playing."
- Faction meanings stay fixed; identify factions with names and hand icons
  as well as color. Marketing compositions use one dominant color field,
  with the other two colors as accents. Use ink text on all three colors
  or white, and white text only on ink.
- The app extension preserves paired-arch geometry, Hanken Grotesk,
  ink/white wordmarks, and the one-color small symbol.
- Running and paused gameplay use a larger own-faction color field. Player
  distances stay visible, with approximate values, stale-position warnings,
  and labeled radar ranges. Technical location details remain optional.
- Room entry precedes the short rules; invitations prioritize joining.
  Invalid room codes retain input and return focus to the code field.
- Entry keeps the paired arches visible on phones beside a compact yellow
  introduction. Room actions remain within the first small-phone viewport.
- The waiting room pairs a yellow invitation area with the player list on
  desktop and stacks them on phones. An empty radar stays hidden in the
  waiting room; it appears when a reference position is available.
- The marketing identity kit is separate from the app, under `brand/`.
- The website build includes the public identity kit at `/brand/` and the
  linked faction workups at `/brand/studies/`. Internal design-tool records
  stay private to the repository.

## Evidence on Hand

- `README.md` describes current capabilities and practical limits.
- `src/client/` contains the working browser interface.
- `DESIGN.md` is a game and system concept document, not a visual identity
  guide. Preserve it as game-design context.
- `docs/playtests/two-iphone-trial.md` contains the physical trial checklist.
- No testimonials, adoption figures, or physical trial results have been
  provided for marketing use.

## Product Principles

- Keep players involved when they change sides.
- Make faction relationships and changes clear.
- Support shared outdoor play rather than prolonged screen attention.
- State location limits honestly.
- Keep location sharing under the player's control.
