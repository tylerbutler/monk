# End-game awards implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five distinct trophy entrances, complete player results, and a
demo page that uses the production animations.

**Architecture:** A pure worker selector projects saved award summaries into
typed results after the round ends. A shared, age-driven Svelte stage renders
the trophy entrances in both the live ceremony and the standalone demo.
The existing persistent match view controls live autoplay.

**Tech stack:** TypeScript, Svelte 5, Zod, CSS/SVG, Vite, Cloudflare Durable
Objects, Vitest, and Playwright. Use installed dependencies.

**Spec:** [End-game awards and trophy announcements](../specs/2026-10-12-end-game-awards-design.md).

## Global constraints

- Keep gameplay, the Gleam engine, and award collection rules unchanged.
- Use the existing Side by Side colors, Hanken Grotesk, marks, and hand icons.
- Give each category a distinct entrance; do not reuse conversion effects.
- Include departed, late-joining, and zero-score players in complete results.
- Allow repeat winners and shared ties; omit unearned categories.
- Use a 500 ms introduction and 3,000 ms per award: at most 15,500 ms.
- Require at least two conversions for Hot Streak.
- Keep incomplete results unranked and without scores, trophies, or autoplay.
- Publish aggregates only after end, to authorized players and the host.
- Preserve the existing credentials, location consent, and 24-hour room expiry.
- Add no dependencies, public results service, or cross-round history.
- Use ASD-STE100 where possible; do not add Co-authored-by commit trailers.

## Review focus

- A departed player's still-open socket must not receive the new results,
  even though their name and achievements remain in other players' results.
- Distinct saved durations that round to the same display value must not
  create a tie; a saved zero-duration comeback must remain eligible.
- A root reparent or same-state update must preserve ceremony age and
  restore native modal behavior without starting the animation again.
- Literal markup in names, duplicate names, and a group above 100 must
  retain separate readable rows without HTML interpretation or truncation.
- A mid-sequence reduced-motion change or backward demo seek must remove
  stale effects and preserve the current category's information.

---

## File map and task dependencies

| Task | Files and responsibility | Prerequisites |
| --- | --- | --- |
| 1 | `src/shared/protocol.ts`: results contracts. New `src/worker/round-results.ts`: selection and ranks. Unit checks beside both. | None |
| 2 | `src/worker/match-authority.ts`: committed end-only projection and capability. `src/client/connection.ts`: opt-in. Worker and connection checks. | 1 |
| 3 | New `src/client/award-view.ts`: shared copy and timeline. New `src/client/AwardAnnouncement.svelte`: category stage. `src/client/styles.css`: distinct motion. | 1 |
| 4 | New `src/client/RoundResults.svelte`: complete list and modal ceremony. Existing match view and app: live lifecycle and reconnect action. Client and live-browser checks. | 2, 3 |
| 5 | New demo entry, fixture module, and Svelte controls under `brand/`. Vite registration, README/brand links, and demo browser checks. | 3, 4 |

Keep setup and documentation with the task that needs them. Do not extract
a new service, general motion framework, or unrelated app architecture.

### Task 1: Results contracts and pure selection

**Files:**
- Modify: `src/shared/protocol.ts`
- Create: `src/worker/round-results.ts`
- Create: `src/worker/round-results.test.ts`
- Modify: `src/shared/protocol.test.ts`

**Interfaces:**
- Consumes: `AwardData` from `src/worker/award-data.ts`.
- Produces: `awardIdSchema`, `roundAwardSchema`, `roundResultsSchema`,
  and inferred `AwardId`, `RoundAward`, `RoundResults`,
  `RoundResultPlayer = RoundResults["players"][number]`.
- Produces:
  `selectRoundResults(data: AwardData | null, roster: readonly Pick<PlayerSnapshot["roster"][number], "id" | "label">[]): RoundResults`.
- Adds optional `snapshot.roundResults: RoundResults` and optional
  authenticate `supportsRoundResults: boolean`.

Use category IDs `hat_trick`, `comeback_kid`, `social_butterfly`,
`hot_streak`, and `conversion_champion`. Each award has `id`, nonempty
unique `winnerIds`, and `value`. Hat Trick has `value: null`; other awards
have a safe integer measure, with Comeback Kid in milliseconds.

Use a coverage-discriminated result union: `complete`, `partial`, and
`unavailable`. Each branch has `players` and `awards`. Player rows have
`id`, `label`, `rank`, and `conversionsMade`. Complete rows require a
positive integer rank and nonnegative integer score. Other branches
require null ranks and scores, with an empty awards array.

- [ ] Write failing selector and schema checks.

  Define a local `dataFor(players, coverage = "complete"): AwardData`
  test helper with `createAwardData` and an ended, coordinate-free frame.
  Check categories against the specification, including exact ties,
  the Hot Streak minimum, all qualifying Hat Trick winners, and missing
  comeback values. Include these assertions:

  ```ts
  it("shares ranks and keeps a zero-score player", () => {
    const data = dataFor([
      { id: "p1", label: "Alex" }, { id: "p2", label: "Alex" },
      { id: "p3", label: "Casey" },
    ]);
    data.players.p1.conversionsMade = 4;
    data.players.p2.conversionsMade = 4;
    const result = selectRoundResults(data, []);
    expect(result.players.map(p => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(result.players.map(p => p.rank)).toEqual([1, 1, 3]);
    expect(result.awards.find(a => a.id === "conversion_champion")?.winnerIds)
      .toEqual(["p1", "p2"]);
  });
  ```

  Add named checks for zero versus null comeback durations, 1,201 versus
  1,249 ms without a false tie, repeat category winners, empty groups,
  partial/null collection, and 120 retained players with duplicate names.
  Reject unknown/duplicate winner IDs, duplicate categories, unsafe or
  invalid measures, scores in partial results, and results before end.

- [ ] Run the red checks:

  `npm run build:rules && npm run test:unit -- src/shared/protocol.test.ts src/worker/round-results.test.ts`

  Expect failure because the results exports and selector do not exist.

- [ ] Implement the shared schemas and exported types.

  Validate results within the optional ended snapshot field. Keep old
  snapshots and authentication messages valid when the fields are absent.
  Bound awards to five, but do not cap retained result rows at 100.

- [ ] Implement `selectRoundResults` without mutating `data`.

  For complete data, use the saved player dictionary, descending totals,
  competition ranks, and lexical label/ID ordering with direct string
  comparisons. Select awards in specification order. For partial data,
  union collected and current roster IDs using saved labels for known
  players. For null data, use the current roster and unavailable coverage.

- [ ] Run the task's unit checks and confirm they pass.
- [ ] Commit as `feat: select end-of-round trophies`.

### Task 2: Publish authorized results after a committed end

**Files:**
- Modify: `src/worker/match-authority.ts`
- Modify: `src/client/connection.ts`
- Modify: `src/client/connection.test.ts`
- Modify: `test/worker/helpers.ts`
- Create: `test/worker/round-results.test.ts`
- Modify: `test/worker/awards.test.ts` only where new end-result assertions
  belong beside existing collection/privacy checks.

**Interfaces:**
- Consumes: Task 1's `selectRoundResults`, schemas, and optional fields.
- Produces: the same results in ended snapshots and updates for opted-in,
  authorized clients, derived after `accept` commits.
- Extends the socket attachment with optional `supportsRoundResults`.
- Extends the test helper to
  `connect(credentials: SessionCredentials, supportsRoundResults = true)`.

- [ ] Write failing worker and connection checks.

  ```ts
  it("publishes results only when the host ends the round", async () => {
    const match = await runningMatch();
    match.host.send({ version: 1, type: "snapshot_request" });
    expect((await match.host.next("snapshot")).snapshot.roundResults)
      .toBeUndefined();
    const ended = await hostCommand(match.host, { type: "end" });
    expect(ended.snapshot.phase).toBe("ended");
    expect(ended.snapshot.roundResults?.coverage).toBe("complete");
    expect(ended.snapshot.roundResults?.players.map(p => p.id).sort())
      .toEqual([...match.ids].sort());
  });
  ```

  Update the helper's test-side authentication to send the new capability.
  Add checks for timer expiry, post-end reconnect, Durable Object eviction,
  incomplete recovery, legacy capability absence, and room expiry.
  Inject one failed transaction before end; assert no ended results
  broadcast and no new committed ending record.

  Retain a departed player's open socket and request an ended snapshot.
  Assert no result projection on that socket or its broadcasts; assert
  that the departing player remains in authorized clients' result rows.
  Keep the existing rejected-reauthentication behavior.

  Reject private collector field names in the projection. Assert that
  the browser connection sends `supportsRoundResults: true`.

- [ ] Run the red checks:

  `npm run test:unit -- src/client/connection.test.ts`

  `npm run test:worker -- test/worker/round-results.test.ts test/worker/awards.test.ts`

  Expect missing capability and results assertions to fail.

- [ ] Extend authority projection and socket capability handling.

  `view(actor)` adds results only for an ended committed record and an
  actor who is the host or remains in the current roster. In `send`,
  omit `snapshot.roundResults` for state messages when the socket lacks
  the capability. Preserve existing faction-history compatibility.
  Do not put results into the checkpoint or modify authentication rights.

- [ ] Opt the browser connection into round results on authentication.
- [ ] Run the task's unit and worker checks and confirm they pass.
- [ ] Commit as `feat: publish committed round results`.

### Task 3: Shared award stage and deterministic timeline

**Files:**
- Create: `src/client/award-view.ts`
- Create: `src/client/award-view.test.ts`
- Create: `src/client/AwardAnnouncement.svelte`
- Modify: `src/client/styles.css`

**Interfaces:**
- Consumes: `AwardId`, `RoundAward`, `RoundResultPlayer`.
- Produces: `awardTitles: Record<AwardId, string>`,
  `awardAchievement(award: RoundAward): string`, and
  `awardTiming = { introMs: 500, announcementMs: 3000 }`.
- Produces:
  `awardSequenceAt(awards: readonly RoundAward[], elapsedMs: number): AwardSequence`.
- Produces:
  `awardSequenceDuration(awards: readonly RoundAward[]): number`, returning
  zero for no awards and `500 + 3000 * awards.length` otherwise.
- `AwardSequence` is `{ kind: "intro" }`,
  `{ kind: "award"; award: RoundAward; index: number; ageMs: number }`,
  or `{ kind: "results" }`.
- `AwardAnnouncement` props:
  `{ award: RoundAward; winners: readonly Pick<RoundResultPlayer, "id" | "label">[]; ageMs: number; reducedMotion: boolean }`.

- [ ] Write failing timing, copy, and mounted-stage checks.

  Use the jsdom annotation and Svelte mounting pattern in `app.test.ts`.
  Mount each category at entrance and hold ages. Assert the category's
  `data-award` value, specific artwork selectors, all supplied winner
  labels as text, and the lack of conversion effect classes.

  ```ts
  it("uses exact ceremony boundaries", () => {
    const award: RoundAward = {
      id: "conversion_champion", winnerIds: ["p1"], value: 4,
    };
    expect(awardSequenceAt([award], 499)).toEqual({ kind: "intro" });
    expect(awardSequenceAt([award], 500)).toEqual({
      kind: "award", award, index: 0, ageMs: 0,
    });
    expect(awardSequenceAt([award], 3500)).toEqual({ kind: "results" });
    expect(awardSequenceAt([], 0)).toEqual({ kind: "results" });
  });
  ```

  Check all five categories at 15,499 and 15,500 ms, and duration values
  0, 3,500, and 15,500 ms for zero, one, and five awards. Check
  singular/plural counts and comeback copy that explains eligible play
  time. Format comeback milliseconds as seconds with three decimal
  places so the display preserves the selector's precision.

- [ ] Run the red checks:

  `npm run test:unit -- src/client/award-view.test.ts`

  Expect missing helper/component imports to fail.

- [ ] Implement copy and timeline exports in `award-view.ts`.

  Keep timeline selection pure and reusable for seeking in either
  direction. Callers supply finite, nonnegative elapsed time.

- [ ] Implement the five stage compositions and their CSS/SVG entrances.

  Use the specification's 0-200, 200-850, 700-1,000, 1,000-2,800,
  and 2,800-3,000 ms phases. Sample paused CSS keyframes with
  `--award-age`; clip exits without hiding default content on script
  failure. Give each category its specified artwork and travel path.
  Use existing faction symbols and paired-arch geometry.

  Stage markup exposes `[data-award]`, `[data-award-winner]`, and
  `.award-artwork` for checks. Decorative artwork is aria-hidden.
  The component does not start a timer, request data, or announce frames.
  A reduced-motion class replaces travel with opacity reveals; make it
  responsive to browser preference changes supplied by its parent.

- [ ] Run the task's unit checks and confirm they pass.
- [ ] Commit as `feat: add distinct trophy entrances`.

### Task 4: Complete results and the live ceremony lifecycle

**Files:**
- Create: `src/client/RoundResults.svelte`
- Modify: `src/client/Match.svelte`
- Modify: `src/client/match-view.svelte.ts`
- Modify: `src/client/views.ts`
- Modify: `src/client/app.svelte.ts`
- Modify: `src/client/app.test.ts`
- Create: `test/e2e/round-results.spec.ts`
- Modify: `src/client/styles.css`
- Modify: `src/client/DESIGN.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: Tasks 1 and 3's contracts, stage, copy, and timeline.
- `RoundResults` props:
  `{ results: RoundResults | undefined; roster: PlayerSnapshot["roster"]; ownPlayerId: string | null; ceremonyStartedAt: number | null; finishCeremony: () => void; reconnect?: () => void }`.
- Adds optional `HudState.stateSource: "snapshot" | "update"` and
  `HudState.reconnect: () => void`.
- Extends internal `ViewProps` with `ceremonyStartedAt` and
  `finishCeremony`, passing them through `Match`.
- Exports `syncAwardDialog(root: HTMLElement): void` from the match view
  for app renders that reparent an open native dialog.

- [ ] Write failing mounted-app and live-browser checks.

  Assert that a complete 120-player result renders 120
  `[data-result-player]` rows, including duplicate/literal-markup names,
  a departed player, and a zero-score player. Assert ranks 1, 1, 3,
  trophy labels, and the current player's "(you)" label.

  Test visible update transitions from running and paused to ended,
  versus an initial/reconnect ended snapshot. Use a mocked monotonic
  clock to assert that only a connected live update starts the ceremony.
  Check that same-state updates and reparenting do not change its start.
  Assert no ceremonies for partial coverage or an empty awards array.

  Check skip, focus to the results heading, native modal state after
  reparenting, preference changes without restart, hidden/disconnected
  cancellation, and cleanup on unmount or room change. Test the explicit
  missing-results notice and its reconnect action.

  In the live browser fixture, end a round after a real conversion:
  assert the dialog, skip it, and check both players' result rows.
  Reload and confirm results without autoplay. Preserve a visible
  "Round ended" label used by existing fixture cleanup.

- [ ] Run the red client checks:

  `npm run test:unit -- src/client/app.test.ts`

  Expect missing results/dialog behavior to fail.

- [ ] Implement the full list and native modal ceremony.

  Keep `[data-result-player]` rows keyed by ID. Render complete,
  partial, unavailable, empty, and no-award states with the exact spec
  copy. Use `#round-results-heading` with `tabindex="-1"` for focus.
  Show `#award-ceremony` as a labeled native `<dialog>` with a
  `[data-action="skip-awards"]` button. Native modal behavior makes the
  background inert and keeps keyboard focus on the ceremony controls.

  Use one component-owned clock only while `ceremonyStartedAt` is
  non-null. Derive age with `performance.now()`, render Task 3's
  timeline/stage, and finish at the exact results boundary. The initial
  focus goes to skip; completion or skip closes the dialog and focuses
  the results heading. A polite live region changes once per category.

- [ ] Wire source and lifecycle through the persistent match view.

  In `receive`, keep the source message type before replacing snapshot
  state. Pass it through the HUD. Start only for a same-match,
  visible/connected `update` from running or paused to ended with complete
  results and earned awards. A first mount is not a live transition.

  Cancel a current ceremony when live state becomes false, a reconnect
  snapshot arrives, or the match changes. Use `renderActivity` to honor
  the existing visibility/disconnect path. Do not persist a replay flag
  or create an independent server ceremony event.

  After app reparenting, `syncAwardDialog` restores `showModal()` if the
  browser removed the dialog from the top layer; retain its sequence
  age and focused skip control. The results component also opens/closes
  its dialog when the ceremony state changes.

  Replace only the ended Match HUD and current-roster display. Do not
  duplicate them below results. Supply reconnect from the existing app
  connection machinery, including for a connected missing-results state.
  Isolated component callers can omit reconnect; then show the unavailable
  notice without a nonfunctional button. The live app supplies it.

- [ ] Update shipped results/privacy copy in README, app information,
  and the client design guide.

  Add the specification's aggregate-results disclosure. Record the
  award stage and reduced-motion treatment without claiming physical
  playtest evidence.

- [ ] Run client checks, then build and run the live browser checks:

  `npm run test:unit -- src/client/app.test.ts src/client/award-view.test.ts`

  `npm run build && npm run test:e2e -- test/e2e/round-results.spec.ts test/e2e/game-motion.spec.ts`

  Expect all selected checks to pass in Chromium and WebKit.

- [ ] Commit as `feat: celebrate round winners and show all players`.

### Task 5: Production-animation demo and its testing controls

**Files:**
- Create: `brand/award-motion.html`
- Create: `brand/award-motion.ts`
- Create: `brand/AwardDemo.svelte`
- Create: `brand/award-fixtures.ts`
- Modify: `brand/index.html`
- Modify: `vite.config.ts`
- Modify: `tsconfig.browser.json`
- Modify: `README.md`
- Create: `test/e2e/award-motion.spec.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, and 4's contracts, stage, timeline, and results.
- Produces: `/brand/award-motion.html` in the deployed Vite assets.
- Produces typed fixtures:
  `awardFixtures: Record<AwardFixtureId, RoundResults>`.
- `AwardFixtureId` values: `normal`, `ties`, `long_names`, `large_group`,
  `large_hat_trick`, `no_awards`, and `partial`.

- [ ] Write failing Playwright checks for the demo route and controls.

  Select each category and seek to 400, 850, 1,500, and 2,900 ms;
  assert the category-specific artwork and hold-state winner names.
  Sample actual element transforms to check trio convergence, the
  turnaround path, paired-arch convergence, streak order, and podium/
  curtain placement. Do not treat five changed titles as proof of five
  distinct entrances.

  Verify that replay resets the selected award to age zero; pause stops
  the timeline; seeking backward removes effects from a later age.
  A mid-preview motion-preference change must preserve the selected
  category and names while removing spatial motion.

  ```ts
  test("opens a paused champion preview", async ({ page }) => {
    await page.goto("/brand/award-motion.html");
    await expect(page.getByLabel("Sequence position")).toHaveValue("1500");
    await expect(page.locator("[data-award]"))
      .toHaveAttribute("data-award", "conversion_champion");
    await expect(page.locator("[data-award-winner]")).not.toHaveCount(0);
  });
  ```

  Verify full playback reaches results at 15,500 ms, fixture changes
  stop the previous playback, and the 120-player fixture retains all
  rows. Check partial/no-award fixtures and the missing-category notice.
  Observe network and location hooks; assert no room API requests,
  game sockets, or location calls. Check links to the demo.

- [ ] Run the red browser checks:

  `npm run build && npm run test:e2e -- test/e2e/award-motion.spec.ts`

  Expect the missing built route or preview controls to fail.

- [ ] Implement typed fictional fixtures using the shared schemas.

  `normal` earns all five awards with a repeat winner. `ties` includes
  shared champion and comeback winners. `long_names` includes an
  80-character name, duplicate names, and literal markup text.
  `large_group` includes 120 players with former members and zero scores;
  `large_hat_trick` includes 120 shared winners. `no_awards` has complete
  zero scores and no trophies. `partial` has null scores/ranks.
  Do not import the worker selector or collector into the public demo.

- [ ] Implement the demo entry and controlled playback.

  The HTML entry imports the existing client styles and mounts
  `AwardDemo`. Register `awardMotion: "brand/award-motion.html"` in
  Vite's multi-page inputs. Include `brand/**/*.svelte` in browser
  type checking. Add the brand-index and README links.

  The Svelte controller has selected category, fixture, playback mode,
  elapsed milliseconds, and paused/running state. It supplies age to the
  production stage; full playback uses `awardSequenceAt` and renders
  `RoundResults` with `ceremonyStartedAt: null` at the results boundary.
  Use the same saved start/offset approach for pause and seeking.
  Cancel playback on fixture/category changes and unmount.

  Expose labeled category choices, "Replay award", "Play full ceremony",
  "Pause"/"Resume", "Fixture", "Sequence position", and
  "Motion preference" controls. Motion choices are system or reduced;
  do not override a system reduced-motion preference with full travel.
  Individual mode has timeline range 0-3,000 ms. Full mode uses the
  shared `awardSequenceDuration`; disable playback for zero awards.

  Open paused at 1,500 ms in the normal champion preview. Mark the
  page as a fictional testing preview. For an absent category, render
  the specification's fixture notice.

- [ ] Verify the demo and inspect desktop/phone captures in one batch.

  `npm run typecheck && npm run build`

  `npm run test:e2e -- test/e2e/award-motion.spec.ts test/e2e/round-results.spec.ts test/e2e/conversion-motion.spec.ts test/e2e/game-motion.spec.ts`

  Check 320 px and desktop widths, long names, large ties, and reduced
  motion. Fix material defects in one batch and confirm with at most one
  further capture round. Expect the compiled demo route and all selected
  browser checks to pass.

- [ ] Commit as `feat: add trophy animation testing demo`.

## Final verification and handoff

Run the targeted unit and worker checks from Tasks 1-4 once more after
integration. Use the existing commands; expand to full suites only when
targeted results reveal a wider regression. Confirm the final type check,
build, and selected Chromium/WebKit checks from Task 5.

Review the branch against the specification, including all five Review
Focus conditions. Keep the demo and live stage identical, complete player
results persistent through recovery, and collector internals private.
Do not claim the animations or demo shipped until the implemented behavior
and compiled route have fresh verification evidence.
