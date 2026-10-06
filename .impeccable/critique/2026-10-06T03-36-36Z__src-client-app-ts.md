---
target: homepage
total_score: 26
max_score: 40
na_heuristics:
p0_count: 0
p1_count: 2
timestamp: 2026-10-06T03-36-36Z
slug: src-client-app-ts
---
⚠️ DEGRADED: single-context (the file-only visual reviewer could not resume; I completed the design review from fresh screenshots and source, with separate browser measurements).

## Homepage critique

**The page explains the game well, but makes starting it feel secondary.** It reads more like a rules document than the entrance to a game for friends.

Reviewed [the main homepage](https://monk-test.tylerbutler.com/) at desktop and mobile sizes, including invite entry and invalid-code recovery. This is a heuristic assessment, not a user study. No app files were changed.

### Design specificity

The faction icons, colors, and conversion rules are distinctly Monk. The surrounding design—system type, green buttons, pale background, and a long instructional column—is more generic.

The biggest opportunity is to **make the first screen an invitation to play**, while keeping the rules easy to find. The new identity could help, but its absence is not a regression: you deliberately kept the app separate from the brand work.

### Design health: 26/40 — Acceptable

| Heuristic | Score | Main finding |
|---|---:|---|
| System status | 3/4 | Buttons disable during requests, but lack explicit progress text |
| Familiar language | 3/4 | Familiar game; “usable locations” adds technical detail early |
| User control | 3/4 | “Skip to play” provides a useful shortcut |
| Consistency | 3/4 | Coherent controls and faction language; some repeated guidance |
| Error prevention | 2/4 | Room-code format is explained only after an invalid submission |
| Recognition over recall | 3/4 | Named icons help; invitation context is buried |
| Efficiency | 2/4 | Hosts and invited players both pass through the long rules page |
| Minimalist design | 2/4 | Clean presentation, but too much information before the main task |
| Error recovery | 2/4 | Helpful error text and retained values, but keyboard focus is lost |
| Help and documentation | 3/4 | Useful, honest instructions; too little progressive disclosure |
| **Total** | **26/40** | **Improve entry flow and form recovery first** |

### What works

- **The faction strip teaches the core relationship quickly.** Names, hand icons, and colors work together.
- **The reading and control basics are sound.** Strong measured contrast, visible focus, controls at least 44px high, and no horizontal overflow at the inspected widths.
- **The limitations are honest.** Approximate positions, optional location sharing, and safe-play guidance set useful expectations.

### Priority issues

1. **P1 — Starting or joining is too far down the page.** At 390px wide, the room section begins about **1,381px down** and “Create room” at **1,550px**. Even a valid invitation leaves “Join room” around **1,779px down**. “Skip to play” helps, but it is a workaround for the hierarchy. Put a short game introduction and room actions first; make the join panel the primary content for an invitation. Keep the rules accessible below.
   **Source:** `src/client/app.ts:483–505` · **Command:** `/impeccable layout`

2. **P1 — An invalid room code breaks keyboard recovery.** Submitting `bad` shows “Enter the eight-character room code” and preserves both fields, which is good. But focus moves to the document body. The next Tab returns to **“Skip to play” at the top**, rather than the field needing correction. Keep or restore focus to the code field, connect the error with `aria-describedby`, set `aria-invalid`, and show the eight-character requirement before submission.
   **Source:** `src/client/app.ts:106,491–505` · **Command:** `/impeccable harden`

3. **P2 — The page teaches too much before the player needs it.** Conversion timing, interruptions, grace periods, host settings, location conditions, and safety all precede room entry. Safety and screen-visibility guidance then appear again in the expanded footer. Keep a short three-step explanation and essential safety note; move detailed rules into a clear disclosure and show operational guidance beside the relevant controls. Do not remove the privacy information.
   **Source:** `src/client/app.ts:37–73,613–617` · **Command:** `/impeccable distill`

4. **P2 — The homepage does not yet express the new identity.** Plain “Monk” text and utility-green styling make the entrance feel more administrative than playful. The custom wordmark, Hanken Grotesk, and “Change sides. Keep playing.” could give this page character without changing the radar or active-game interface. This needs your approval to extend the brand beyond the kit.
   **Source:** `src/client/app.ts:460–462`; `src/client/styles.css:1–14` · **Command:** `/impeccable typeset`

### Cognitive load and emotional flow

**Moderate load: 3 of 8 checklist items need attention**—task focus, task hierarchy, and progressive disclosure. There is no excessive-choice problem; the issue is how much reading comes before two simple actions.

The journey is **clear introduction → extended instructions → room entry → more operational detail**. The room-entry moment should arrive sooner.

### Persona red flags

- **Casey, using a phone outdoors:** the group is waiting, but room actions are below a long explanation.
- **Jordan, opening an invitation:** the page initially looks like generic instructions; the invitation confirmation is much farther down.
- **Sam, using a keyboard:** a mistyped code sends the next Tab back to the page header.

### Minor observations and detector evidence

Keep the restrained column width; unused desktop space is not itself a problem. Add explicit “Creating room…” and “Joining…” feedback rather than relying only on button dimming.

The static detector reported **0 findings**, but uses regex for this TypeScript-generated interface. The browser detector produced **1 `gradient-text` flag**, rejected as detector self-contamination after comparison with the uninjected page. No human-visible live overlay is available. These results do not constitute a full accessibility audit.
