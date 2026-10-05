# Simulated Location Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify location-driven gameplay without physical travel, with repeatable rule checks and two-player browser tests.

**Architecture:** Keep Vitest, jsdom, and the Workers runtime tests for controlled inputs and exact time boundaries. Add Playwright tests that supply browser geolocation while the real Svelte UI, WebSocket client, local Worker, Durable Object, and Gleam rules process each interaction. Keep simulated inputs in test code.

**Tech Stack:** Existing TypeScript, Svelte, Gleam, Vitest, jsdom, and Cloudflare test tools; add `@playwright/test` with Chromium and WebKit.

**Spec:** The testing approach approved in this conversation, recorded under Scope and Acceptance below. Use `README.md`, `src/shared/protocol.ts`, and the current tests as the behavior references. The original outdoor-playtest spec and plan contain superseded startup, mode, and freshness requirements; do not restore them.

## Global Constraints

- Use Node 24.21.0 and Gleam 1.18.1 from `mise.toml`.
- Preserve production defaults: 30 m entry radius, 40 m retention radius, 15 m uncertainty limit, 30-second conversion time, three-second grace, and a ten-minute round.
- Influence expires at 30 seconds without a usable new capture. Repeated captures do not extend the deadline.
- Confirmed range includes both players' reported uncertainty: distance + accuracy A + accuracy B.
- Keep approximate and last-known markers visible when they cannot influence.
- Do not require location permission to create, join, start, or resume a room.
- Do not add a production simulation switch, synthetic-location endpoint, clock override, or test-specific game rule.
- Use local loopback serving. Do not deploy, contact the deployed test site, or require Cloudflare credentials.
- Use separate browser contexts for players. Do not copy credentials or saved browser state between them.
- Keep existing `npm test` behavior. Provide a separate `npm run test:e2e` command and run both in CI.
- Do not record real coordinates, credentials, or raw authenticated traffic in committed fixtures or CI artifacts.
- Use ASD-STE100 where possible. Do not add co-author trailers to commits.

## Review Focus

1. Two players can accidentally share a geolocation override or session. Task 2 checks independent factions and reciprocal radar directions.
2. A test can pass with stale UI left from an earlier position. Tasks 2 and 3 wait for the expected radar change before checking influence.
3. Distance tests can ignore uncertainty and approve an invalid encounter. Task 1 checks entry, retention, and per-player accuracy separately.
4. A malformed fix or storage failure can send invalid or unsequenced data. Task 1 checks explicit status errors and no position delivery.
5. Browser time control can leave the server clock unchanged and produce misleading timing results. Tasks 1 and 3 separate exact-time assertions from real-clock integration checks.

## Scope and Acceptance

The work adds automated coverage, not a location simulator product.

| Layer | Coverage | Work |
| --- | --- | --- |
| Browser API, jsdom | Permission errors, cached timestamps, cancellation, hidden pages, wake locks, clock changes | Preserve current tests; add invalid-fix and storage-failure cases. |
| Pure rules and location policy | Conversion duration, age, range, uncertainty, interruption | Preserve timing tests; add production-range and accuracy boundaries. |
| Workers integration | Real protocol, authority, expiry, duplicate captures, disconnects, persistence | Reuse the existing suite without copying it into Playwright. |
| Real browser integration | Create/join, native geolocation overrides, radar, progress, conversion, interruption | Add Chromium and WebKit tests against Wrangler. |
| Physical checks | GPS error and cadence, OS prompts, compass quality, locking/background behavior | Retain a short device checklist; do not claim these from simulation. |

Acceptance requires:

- `npm test` retains the existing 29,999/30,000 ms expiry and conversion assertions.
- Browser tests prove both players see the same accepted conversion through their own UI.
- Browser tests prove range exit and stopping sharing remove both influence roles.
- Browser tests prove a nearby but inaccurate location remains visible without influence.
- Both browser projects pass on a fresh checkout with documented commands.
- CI runs the browser suite without deployment secrets.

Do not add route recording, real movement history, maps, a scenario-file format, a mock backend, or a new test framework for the existing unit tests.

## File Map

| File | Responsibility |
| --- | --- |
| `src/client/location.test.ts` | Add invalid-position and storage-failure coverage with current browser mocks. |
| `src/worker/engine.test.ts` | Add production range and uncertainty boundary cases. |
| `package.json`, `package-lock.json` | Add one test dependency, E2E script, and E2E type check. |
| `playwright.config.ts` | Local server lifecycle, browser projects, timeouts, and outputs. |
| `tsconfig.e2e.json` | Type-check browser automation without Worker globals. |
| `tsconfig.test.json` | Exclude the Playwright config from the existing `*.config.ts` inclusion. |
| `test/e2e/fixtures.ts` | Two independent players, native location overrides, UI-only room setup, and teardown. |
| `test/e2e/location.spec.ts` | Successful conversion and interrupted/invalid-location scenarios. |
| `.gitignore` | Ignore browser reports and test outputs. |
| `.github/workflows/ci.yml` | Install browsers and run the new suite in its own job. |
| `README.md` | Commands, coverage limits, and desktop location override instructions. |

No production source changes are expected. If a new test exposes a product defect, reproduce it in the smallest existing test layer and review the required behavior before adding a fix.

## Execution Order

Task 1 has no dependency on Task 2. Task 3 depends on Task 2. Task 4 depends on Tasks 1, 2, and 3. Native, sequential execution is recommended because the browser scenarios share one small fixture. Implementation requires a separate user request.

## Task 1: Complete Deterministic Location Checks

**Files:** Modify `src/client/location.test.ts` and `src/worker/engine.test.ts`.

**Interfaces:**
- Reuse `startLocation(onFix, onStatus): () => void` and the existing `position(timestamp)` browser fixture.
- Reuse `command`, `fix`, `lobbyFixture`, `advanceEngine`, `snapshotFor`, and `gamePreset`.
- Produce regression tests only; do not add a shared simulation API.

- [ ] **Step 1: Establish the targeted baseline.**

  Run:

  ```sh
  npm run build:rules
  npm run test:unit -- src/client/location.test.ts src/worker/locations.test.ts src/worker/engine.test.ts src/client/app.test.ts
  ```

  Expected: existing cases pass. Record a pre-existing failure before making changes.

- [ ] **Step 2: Add invalid browser-fix and storage tests.**

  Extend `position(timestamp: number, coordinates?: Partial<GeolocationCoordinates>): GeolocationPosition` in the same test file. Merge overrides into its current coordinates. Add these named cases:

  | Test | Inputs and assertions |
  | --- | --- |
  | `rejects invalid coordinates without consuming a sequence number` | Table: latitude `NaN`, latitude `91`, longitude `181`, accuracy `0`, accuracy `-1`, accuracy `Infinity`. No fix; reason `"Location values are invalid. Wait for a new fix."`; collection remains active. A subsequent valid fix has `seq: 1`. |
  | `stops before starting a watch when the stored sequence is invalid` | Table: `"NaN"`, `"-1"`, `String(Number.MAX_SAFE_INTEGER)`. No watch call, no fix, `collecting: false`, and the existing explicit storage/sequence error. |
  | `does not report a fix when persisting its sequence fails` | After starting the watch, make `Storage.prototype.setItem` throw `DOMException`. Deliver a valid fix. Assert no fix, `clearWatch(1)`, `collecting: false`, and `"Session storage is unavailable. Allow storage before reporting location."` A late callback also sends nothing. |

  Use `try/finally` to stop collectors. Restore spies and test globals with the existing cleanup.

- [ ] **Step 3: Add production range and accuracy tests.**

  Configure a `lobbyFixture(["rock", "scissors"])` with `gamePreset` before starting. Construct observations from `fix`, replacing `expiresAtMs` with `nowMs + 30000` and supplying the chosen `accuracyM`. The shared fixture uses a 1,500 ms lifetime; do not mistake that for production behavior.

  | Test | Inputs and assertions |
  | --- | --- |
  | `includes both uncertainty radii in entry range` | Both accuracy values `1`. Separation `27.9` m starts influence; `28.1` m does not. |
  | `accepts an exact thirty-metre upper bound` | Co-located players, both accuracy values `15`. Upper bound is exactly `30`; influence starts. |
  | `uses retention range only for an existing encounter` | Start at `10` m. At `1000` ms, move to `37.9` m with both accuracy values `1`: influence remains. At `1500` ms, move to `38.1` m: influence stops with `"Outside confirmed range."` An independent fresh encounter at `37.9` m must not start. |
  | `checks the per-player uncertainty limit independently of distance` | Co-located players; one accuracy value `1`, the other `15` or `15.01`. The first case starts influence; the second does not, although its upper distance remains below `30`. |

  Assert the authority outputs, not only `distanceBetween`:

  ```ts
  expect(snapshotFor(accepted.state, "p1", nowMs).outgoing?.targetId).toBe("p2");
  expect(snapshotFor(rejected.state, "p1", nowMs).outgoing).toBeNull();
  expect(snapshotFor(rejected.state, "p2", nowMs).incoming).toEqual([]);
  ```

  Keep the existing exact conversion-time and inactivity tests unchanged. The `0.1` m margin avoids asserting equality after floating-point distance calculations.

- [ ] **Step 4: Run the targeted tests and check sensitivity.**

  Repeat Step 1's test command. Expected: all cases pass. These additions specify existing behavior, so an initial pass is valid. Temporarily invert one new expected result in each edited file, confirm that its selected test fails, then restore only those deliberate edits. Do not change production behavior to manufacture a red test.

- [ ] **Step 5: Commit the deterministic coverage.**

  ```sh
  git add src/client/location.test.ts src/worker/engine.test.ts
  git commit -m "test: cover location input and range boundaries"
  ```

## Task 2: Prove Two-Player Conversion in Real Browsers

**Files:** Create `playwright.config.ts`, `tsconfig.e2e.json`, `test/e2e/fixtures.ts`, and `test/e2e/location.spec.ts`. Modify `package.json`, `package-lock.json`, `tsconfig.test.json`, and `.gitignore`.

**Interfaces:**

```ts
// test/e2e/fixtures.ts
import type { Page } from "@playwright/test";

export type Duel = {
  host: Page;
  guest: Page;
  moveGuest(eastM: number, accuracyM?: number): Promise<void>;
};
// Export test = base.extend<{ duel: Duel }>(...) and re-export expect.
```

The fixture supplies a running room with host `"Test Rock"` as Rock and guest `"Test Scissors"` as Scissors. Both share location with accuracy `1` m. The host is at latitude/longitude `0, 0`; the guest starts `60` m east. `moveGuest` defaults to accuracy `1` and changes only the guest context's native geolocation override.

- [ ] **Step 1: Add the dependency and runner configuration.**

  Add a compatible stable `@playwright/test` dev dependency with an exact version, then update the lockfile with npm. Do not upgrade existing dependencies.

  Configure:

  - `test:e2e`: `playwright test`.
  - `testDir: "./test/e2e"`; `testMatch: "**/*.spec.ts"`.
  - Projects `chromium` and `webkit`; use their corresponding `browserName`.
  - One worker, no retries, test timeout `45000`, assertion timeout `10000`, and `forbidOnly` in CI.
  - Base URL and readiness URL `http://127.0.0.1:8788`.
  - Web server command `npm run dev -- --local --ip 127.0.0.1 --port 8788 --persist-to .wrangler/e2e`.
  - Startup timeout `120000`; `reuseExistingServer: false`; graceful shutdown with `SIGTERM` and `5000` ms.
  - Line reporter plus HTML report with `open: "never"`. Ignore `playwright-report/` and `test-results/`.
  - Disable traces, video, and automatic screenshots for the first suite. Traces can contain authentication frames; do not upload them.

  Wrangler's existing build hook builds the app. Do not start a separate Vite server or add an extra prebuild to `test:e2e`.

  Make `tsconfig.e2e.json` extend `tsconfig.json`, with DOM/DOM.Iterable/ES2023 libraries, Node types, and includes for `playwright.config.ts` and `test/e2e/**/*.ts`. Append `tsc -p tsconfig.e2e.json` to `typecheck`. Exclude `playwright.config.ts` from `tsconfig.test.json`.

- [ ] **Step 2: Write the conversion test before the fixture.**

  Test name: `converts two independently located players through the real server`.

  Assert the starting radar details show `"about 60 m E"` for the host and `"about 60 m W"` for the guest, with no influence. Move the guest to `10` m, wait for `"about 10 m E"`, and assert:

  ```ts
  await expect(duel.host.getByRole("progressbar", {
    name: "Influencing Test Scissors", exact: true,
  })).toBeVisible();
  await expect(duel.guest.getByRole("progressbar", {
    name: "Test Rock is influencing you", exact: true,
  })).toBeVisible();
  await expect(duel.host.getByRole("status", {
    name: "Conversion notification",
  })).toContainText("You converted Test Scissors to Rock.");
  await expect(duel.guest.getByRole("status", {
    name: "Conversion notification",
  })).toContainText("Test Rock converted you to Rock.");
  await expect(duel.guest.locator(".own-faction h2")).toHaveText("Rock");
  ```

  Open `#radar-details-toggle` before checking its text. Use exact accessible names or existing data attributes; do not add product test IDs.

- [ ] **Step 3: Confirm the fixture is missing.**

  Run `npm run test:e2e -- --list`.

  Expected: failure resolving the fixture import. This step does not require browser binaries.

- [ ] **Step 4: Implement the `duel` fixture.**

  Create two contexts from the project's `browser`, each with the local `baseURL`, viewport `1280 x 1000`, and a distinct geolocation. Grant `geolocation` for the loopback origin before navigation. Assert both pages report `document.visibilityState === "visible"`.

  Use the equatorial offset formula already used in `test/fixtures.ts`: `longitude = eastM / 6371000 * 180 / Math.PI`, `latitude = 0`. Implement it locally in this fixture; do not import the engine fixture and compiled Gleam code into the Playwright helper.

  Perform setup through visible UI controls:

  1. Fill `"Display name (optional)"` and select `"Create room"` on the host.
  2. Read `#room-invite-link` and use that URL to join the guest with its own name.
  3. Wait for both players in the lobby. Open Host controls and Advanced settings; assert the initial conversion field is `"30"`.
  4. Change `"Conversion time (seconds)"` to `"5"` and `"Grace period (ms)"` to `"1"`. Save through `"Save round settings"`. Leave range, accuracy, inactivity, and round duration unchanged.
  5. Under Change player factions, select `scissors` for `"Faction for Test Scissors"`. Wait for the guest's own faction heading to show `"Scissors"`.
  6. Select `"Start game"`. Confirm both pages show `"Round running"` before either selects `"Share location"`.
  7. Enable sharing on both pages and wait for reciprocal radar details at `60` m.

  Attach a passive `page.on("websocket")` observer before navigating the host, so the test can observe its connection. Where setup needs an acknowledgement, register a bounded response waiter before the UI action and parse received messages with `parseServerMessage`. Require an accepted configure outcome with `snapshot.parameters.dwellMs === 5000` and `graceMs === 1`. Ignore unrelated frames, report malformed server messages, and remove listeners on completion or teardown. Do not log raw frames, inject responses, send commands from the test, or read private tokens.

  Implement `moveGuest` using `guestContext.setGeolocation`. It resolves when the override completes; each test must then wait for the changed UI. Do not freeze the browser clock, override timestamps, mock WebSocket, or use unbounded sleeps.

  Use fixture teardown with `try/finally` to close both contexts, including partial setup failures. Use a fresh room per test. Never fall back to an already-running server on the chosen port.

- [ ] **Step 5: Install browsers and run the first integration test.**

  ```sh
  npx playwright install --with-deps chromium webkit
  npm run test:e2e -- --grep "converts two independently located players"
  npm run typecheck
  ```

  Expected: the scenario passes once in each browser project. The test sees native geolocation callbacks, real progress, and notifications on both clients. A browser initialization or missing-dependency error is not evidence of a product defect.

- [ ] **Step 6: Commit the working browser test.**

  ```sh
  git add package.json package-lock.json playwright.config.ts tsconfig.e2e.json tsconfig.test.json .gitignore test/e2e
  git commit -m "test: verify multiplayer conversion with browser geolocation"
  ```

## Task 3: Cover Location Interruptions End to End

**Files:** Modify `test/e2e/location.spec.ts`; extend `test/e2e/fixtures.ts` only if the existing interface cannot support an assertion.

**Interfaces:** Consume `test`, `expect`, and `Duel` from Task 2. No new exported interfaces are required.

- [ ] **Step 1: Add range-exit and stop-sharing scenarios.**

  Parameterize `clears both influence roles after <interruption>` for `"range exit"` and `"stop sharing"`.

  Enter at `10` m. Wait for both influence bars and a host progress value greater than `0` and less than `1`, using bounded `expect.poll` on the progress element's `value`. Then:

  - Range exit: move the guest to `60` m and wait for the changed radar distance.
  - Stop sharing: click `"Stop sharing"` on the guest, and require its `"Share location"` button to return.

  In both cases require:

  ```ts
  await expect(duel.host.locator('[data-direction="outgoing"]')).toHaveCount(0);
  await expect(duel.guest.locator('[data-direction="incoming"]')).toHaveCount(0);
  await expect(duel.guest.locator(".own-faction h2")).toHaveText("Scissors");
  await expect(duel.host.getByRole("status", {
    name: "Conversion notification",
  })).toHaveCount(0);
  ```

  Confirm the stop-sharing case keeps the guest marker in the host radar. Neither case removes a player from the room.

  Recover by moving the guest back to `10` m or selecting `"Share location"` and supplying a new override at `10.1` m. Wait for new influence and then the accepted conversion on both pages. Exact progress reset and dwell timing remain the responsibility of the existing deterministic tests; do not assert exact zero from a real-time UI snapshot.

- [ ] **Step 2: Add the poor-accuracy scenario.**

  Test name: `shows an inaccurate nearby player without allowing influence`.

  Move the guest to `10` m with accuracy `16`. Wait for the host's guest details to show `"GPS uncertainty 16 m."` and `"Location is approximate."`; require a visible radar marker, no influence bars, and no conversion notification.

  This case isolates the uncertainty limit: `10 + 1 + 16 = 27`, below the `30` m entry radius. A failed influence attempt therefore cannot pass merely because the players are out of range.

  Move the guest to `10.1` m with accuracy `1`. Wait for the changed uncertainty label, then require influence and conversion on both pages.

- [ ] **Step 3: Run the scenarios and the timing guards.**

  ```sh
  npm run test:e2e
  npm run test:unit -- src/worker/engine.test.ts src/worker/locations.test.ts src/client/location.test.ts src/client/app.test.ts
  ```

  Expected: four E2E cases pass in each browser project, plus the selected deterministic suite. Use UI assertions and bounded polling. Do not increase global timeouts or enable retries to hide an ordering failure.

  Withhold the recovery action in one local run and confirm its conversion assertion times out. Restore that deliberate edit. This checks that the recovery test requires a real new eligible encounter.

- [ ] **Step 4: Check repeatability.**

  Run `npm run test:e2e -- --repeat-each=3`.

  Expected: 24 successful cases, no retries, leaked contexts, or occupied server port after completion. Investigate any failure before committing.

- [ ] **Step 5: Commit the interruption coverage.**

  ```sh
  git add test/e2e/location.spec.ts test/e2e/fixtures.ts
  git commit -m "test: cover simulated location interruptions"
  ```

## Task 4: Add CI and Document the Testing Boundary

**Files:** Modify `.github/workflows/ci.yml` and `README.md`.

**Interfaces:** Consume the existing `npm test` and `npm run typecheck` commands and Task 2's `npm run test:e2e`.

- [ ] **Step 1: Add a separate `browser` CI job.**

  Keep the existing `verify` job. Use the repository's current checkout and mise actions, Ubuntu, and a 15-minute job timeout. Run:

  ```sh
  npm ci
  npx playwright install --with-deps chromium webkit
  npm run test:e2e
  ```

  Let Playwright build and manage Wrangler. Keep `contents: read`; add no secrets, deploy step, or browser cache in this first version. Keep no retries.

  Upload `playwright-report/` on failure with `actions/upload-artifact`, using the repository-compatible stable major, a seven-day retention limit, and `if-no-files-found: ignore`. Do not upload `.wrangler/`, profiles, storage state, or raw traffic.

- [ ] **Step 2: Document automated and desktop testing.**

  Extend README's Software verification section with:

  ```sh
  # Existing deterministic and Workers checks
  npm test

  # Once after npm ci, or after a Playwright browser-version change
  npx playwright install --with-deps chromium webkit

  # Real local app, synthetic locations
  npm run test:e2e

  # Watch one browser project
  npm run test:e2e -- --project=chromium --headed
  ```

  Explain the test-only five-second conversion and one-millisecond grace settings. The production defaults stay unchanged; the deterministic suite verifies the 30-second rules.

  Add Chrome DevTools instructions: start `npm run dev`, open two independent player sessions in visible windows, select **Show Sensors**, and set a **Custom location** per page. Explain **Location unavailable**. Include synthetic equatorial coordinates for `0` m and approximately `60` m east (`0, 0` and `0, 0.00053959`). State that browser permission is still required.

  State that WebKit automation is not a physical iPhone or installed-PWA test. Link the existing `docs/playtests/two-iphone-trial.md` for device checks. Keep physical GPS accuracy, stationary/moving update cadence, compass quality, OS permissions, and lock/background behavior unverified by this suite. Do not change the recorded status of the physical trial.

- [ ] **Step 3: Run final acceptance from the documented setup.**

  ```sh
  npm test
  npm run typecheck
  npm run test:e2e
  ```

  Expected: deterministic, Worker, browser, and type checks pass. Existing CI continues its build and bundle checks. Confirm the browser job starts without credentials and the local server stops when the suite ends or is interrupted.

  Review `git diff --check` and the changed-file list. Confirm that no production source, game default, raw location history, generated report, or credential file entered the change.

- [ ] **Step 4: Commit CI and documentation.**

  ```sh
  git add .github/workflows/ci.yml README.md
  git commit -m "ci: run simulated location browser tests"
  ```

## Reference Documentation

- [Playwright geolocation emulation](https://playwright.dev/docs/emulation#geolocation)
- [Playwright local web server](https://playwright.dev/docs/test-webserver)
- [Playwright CI setup](https://playwright.dev/docs/ci)
- [Chrome Sensors location override](https://developer.chrome.com/docs/devtools/sensors#geolocation)

## Completion Boundary

This work is complete when the documented local and CI checks verify gameplay with simulated locations. It does not certify GPS accuracy, physical separation estimates, mobile power behavior, or field latency. Keep the device trial separate from software regression checks.
