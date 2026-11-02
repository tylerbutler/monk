# Beryl protocol integration

Date: 2026-11-01

Status: Architecture and recovery rules approved in conversation. This written
specification awaits review.

## Purpose

Replace Monk's custom WebSocket connection lifecycle with `beryl_protocol`,
Roost, and the official Phoenix JavaScript client. Detect dead connections,
recover channel membership, correlate replies, and reject stale channel work
without maintaining another implementation of these protocol rules in Monk.

Keep the current game authority, authorization, location rules, private views,
and storage guarantees. A transport migration must not apply a command twice,
send an old position after reconnect, or expose another player's private events.

The user approved replacing both ends of the connection and requested no
compatibility support. Remove the old wire protocol and client capability
negotiation. Do not add a dual-protocol server or a migration window.

## Current system and integration boundary

`src/client/connection.ts` uses native WebSockets. It handles first-frame
authentication, reconnect backoff, command retries, diagnostic clock messages,
and stream recovery. It has no application heartbeat. It reports a connected
status after authentication, before the initial snapshot.

`src/worker/match-authority.ts` handles authentication, application messages,
private broadcasts, WebSocket attachments, and game updates. It serializes
operations and saves command outcomes with game state before broadcasting.
Its constructor restores a running game as paused and clears transient
location data.

Keep those application guarantees. Delegate channel lifecycle and connection
health to the selected libraries:

```text
Svelte controller
  -> connectMatch adapter
  -> official Phoenix client
  -> same-origin WebSocket
  -> Roost framing and beryl_protocol transitions
  -> Durable Object action interpreter
  -> existing Monk authority, rules, and storage
```

Use one channel, `match:<code>`, per WebSocket. The Durable Object remains the
authority for one match. Do not add BEAM processes, distributed PubSub, a
generic transport framework, or a second game engine.

## Dependencies and build

The reviewed protocol source is in `tylerbutler/beryl`, under
`packages/beryl_protocol`. Gleam supports Git dependencies with a package path
from version 1.18. Monk's existing compiler pin supports this configuration:

```toml
beryl_protocol = { git = "https://github.com/tylerbutler/beryl.git", ref = "0a778cafec53dfff0725de8b53e2da20d58da032", path = "packages/beryl_protocol" }
roost = { git = "https://github.com/tylerbutler/roost.git", ref = "17a2db06b147c82a77fc76cbbc21fee6fe043c7e" }
```

Add these dependencies to `rules/gleam.toml`. Add a direct `gleam_json`
dependency for the bridge's imports and use Gleam to regenerate the manifest.
Add `phoenix` as a browser runtime dependency. Select and lock its release
during implementation; add its TypeScript declarations if that release needs
a separate declarations package.

Build a small Gleam host bridge in the existing JavaScript-target package.
Use generated declarations at the TypeScript boundary, as the engine adapter
does today. A small JSON interop helper is acceptable where Roost's Gleam
types require it. Keep protocol transitions in `beryl_protocol`; the bridge
only normalizes frames, exposes host actions, and translates outbound frames.

Do not install or include the BEAM-only `beryl` package. Do not change the
compiler pin or create another build pipeline. The existing rules build must
generate both game and channel modules for local use, CI, and Cloudflare.

## Routing and authentication

Keep the HTTP room creation and player join APIs. They issue the same private
room credentials and continue to update the authoritative roster.

The Phoenix client uses `/api/matches/<code>/socket` as its endpoint. The
Worker accepts the resulting GET upgrade at
`/api/matches/<code>/socket/websocket`, with exactly one `vsn=2.0.0` query
parameter. Reject unknown or duplicate query parameters and other versions.
Keep existing HTTPS and same-origin checks. HTTP APIs continue to reject
query parameters.

Pass host and player tokens only in the channel join payload. Do not use
socket URL parameters, transport authentication headers, or subprotocols for
credentials. Verify the requested topic against the routed match and derive
the actor from verified credentials. Reject invalid credentials, expired
rooms, and unauthorized topics before application delivery.

Keep a five-second initial authorization deadline. Use an explicit 25-second
client heartbeat interval and a 60-second server heartbeat timeout. Configure
one channel and at most 64 pending protocol operations per connection. Keep
the existing 16 KiB inbound frame limit and JSON-only application payloads.
Reject unsupported binary application frames.

Drop malformed JSON or Phoenix framing without application delivery or a
protocol-state change. Reject invalid application payloads with an application
error and no game mutation. Close oversized frames with code 1009 and
unsupported binary frames with code 1003.

Authorization failures and room expiry are terminal client errors. Stop
automatic retries for those failures. Network and recoverable channel failures
use Phoenix reconnect or rejoin behavior.

## Application messages and readiness

A successful channel join returns identity, host permission, room expiry,
and a fresh private snapshot with its stream baseline. Include the same
authorized faction history, trial state, and round results as current views.
The browser validates the reply before it reports a ready connection.

Keep Zod validation at application trust boundaries. Roost validates framing;
it does not validate game payloads or permissions. Remove the old
`authenticate` exchange and the `supportsFactionHistory` and
`supportsRoundResults` capability branches.

Keep the application distinction between a snapshot and a live update.
Snapshot recovery must not replay old conversion effects or trophy ceremonies.
Preserve private stream IDs and sequence numbers for application messages;
Phoenix refs and global game event numbers do not replace them.

Start a new private stream on each successful join. Apply the join snapshot
as its baseline. Drop duplicate application frames. On a stream change or
sequence gap, request one fresh snapshot and block application sending until
the browser validates it, except for the snapshot request itself. Continue
protocol heartbeats during recovery. Do not treat gaps in globally numbered
private events as missing messages for that recipient.

Use Phoenix pushes for private state updates, trial samples, and application
errors. Host-command replies return the saved command outcome with the
caller's current private state and relevant events. Other recipients receive
their authorized update. Keep ordering consistent across reply payloads and
server pushes by using the same application stream counter.

## Command retries and transient reports

Keep stable command IDs and the stored outcome limit. Save an outcome and
its game mutation in the same transaction before sending a success reply or
broadcast. On retry, return the recorded outcome for that ID, even if the
retry has a different Phoenix ref or arrives after reconnect or eviction.
Do not discard deduplication records to make capacity for new mutations.

The controller owns pending command IDs across connection replacement. The
connection adapter tracks current Phoenix requests and their timeouts, but
does not maintain another durable command queue or generate replacement IDs.
Invalidate callbacks from disposed connections and obsolete joins.

Use a five-second command reply timeout and at most five automatic attempts
per join. Pause retries while the connection needs a join or snapshot.
Resend unresolved commands after readiness, using their original IDs. After
the attempt limit, retain the unresolved ID and report that the command is
not confirmed. Keep that state separate from connection health, and provide
an explicit retry using the same ID.

A timeout does not prove that the server rejected or failed to apply a
command. Do not claim exactly-once delivery.

Do not put positions or other transient reports into Phoenix's offline
buffer. Check application readiness and channel readiness before pushing
them. Drop reports while disconnected or recovering. Stop local collection
on connection loss. After recovery, obtain a fresh snapshot and let the
existing visibility and consent rules decide whether to restart collection.

Keep position sequence validation, capture-age rules, and the optional
diagnostic clock exchange. A missing diagnostic clock must not block ordinary
location sharing. Do not turn old locations into fresh observations on retry.

## Durable Object actions and recovery

Execute protocol actions in order within Monk's existing serialized operation
queue. Feed admission and cleanup completion back to the core before later
external input. Use immediate invalidation for channel cleanup: this host has
no independent BEAM worker results to drain.

Generate a new trusted connection epoch for each new WebSocket. Let the core
own channel generations and single-use operation identities. Do not substitute
wire refs, topic names, or player IDs for these capabilities.

Checkpoint protocol consumption before executing outbound actions. Keep a
versioned WebSocket attachment with the protocol export, verified actor,
private stream cursor, authorization deadline, room expiry, and trusted
wall-clock save time. Set a 16,000-byte host budget below Cloudflare's
16,384-byte attachment limit. Close and require reconnect if serialization
or validation fails.

Exclude tokens, coordinates, application payloads, callbacks, pending
position reports, and clock measurements from attachments and durable
protocol storage. Restore host authority from the match record before
delivering application work. Check restored actors against the current room
sessions and roster.

Pass validated elapsed wall time to the core on wake-up. Preserve established
membership when restoration permits it. Require fresh authorization and a
snapshot when the core reports lost in-flight work. Close invalid,
unsupported, oversized, or backward-clock attachments. Reconnect starts a
new epoch.

Preserve the current game recovery rule: reconstructing the authority pauses
a running match and clears transient observations. A restored protocol
membership must not resume play, restore positions, or bypass consent.
Establish a fresh application stream and snapshot after authority recovery,
including for sockets whose channel membership survives.

Channel leave, replacement, disconnect, and heartbeat expiry invoke cleanup.
Suspend a player's influence when no other authorized joined connection for
that player remains. Clear socket-local clock and trial resources. Do not
remove the player from the roster or revoke their room session because a
transport or channel closed. Only explicit game leave removes membership.

## Deadlines

Use the existing Durable Object alarm. Choose the earliest of initial
authorization deadlines, the core's connection deadlines, the existing
game-recovery deadline, and room expiry. Do not create a second alarm owner.

Process due deadlines after a delayed alarm and recompute the next alarm
after relevant transitions. Check heartbeat expiry through the core using
host-supplied time. Application traffic must not extend the heartbeat
deadline.

Retain the existing active-game tick behavior. Do not use per-socket
heartbeat timers that disappear on eviction or prevent idle hibernation.
Do not use a fixed Cloudflare auto-response for Phoenix heartbeats, which
require correlated replies.

## Verification

Use existing Vitest, Workers-runtime, and Playwright tooling. Test the actual
Phoenix client against the Durable Object through a test transport that uses
the Workers runtime. The beryl portable example provides a reference for
that transport and its forced-eviction tests.

Required checks:

- Successful host/player joins and fresh snapshots; credential, origin,
  topic, version, expiry, malformed-frame, and frame-limit rejection.
- No application readiness or location sends before join and snapshot
  validation; no stale positions flushed after reconnect or rejoin.
- Heartbeat replies, half-open connection detection, and deadline enforcement
  after idle periods, delayed alarms, and eviction.
- Duplicate joins, stale join refs, single-use replies, and old connection
  callbacks that cannot affect a replacement channel.
- Private stream gaps and duplicate frames, including a snapshot-request
  limit while recovery is pending and private global-event gaps.
- Lost command replies before and after durable commit, stable-ID retries,
  outcome replay, attempt exhaustion, and manual retry without duplicate
  mutations or a false connection failure.
- Eviction with established membership and lost in-flight work; invalid and
  oversized attachments; recovery as paused with no retained positions.
- Cleanup with multiple connections for one player, explicit game leave,
  private event isolation, faction history, trials, and ended-round results.
- Existing conversion, location interruption/recovery, invitation, and awards
  behavior through browser tests.

Run focused checks during implementation, then the existing full verification
commands and affected browser projects. A successful build alone does not
establish protocol compatibility or recovery behavior. No deployment or
physical-device claims form part of this work.

## Reference material

- [Reviewed beryl source](https://github.com/tylerbutler/beryl/tree/0a778cafec53dfff0725de8b53e2da20d58da032/packages/beryl_protocol)
- [Portable Durable Object example](https://github.com/tylerbutler/beryl/tree/0a778cafec53dfff0725de8b53e2da20d58da032/examples/portable_channels)
- [Reviewed Roost source](https://github.com/tylerbutler/roost/tree/17a2db06b147c82a77fc76cbbc21fee6fe043c7e)
- [Gleam Git dependency package paths](https://github.com/gleam-lang/gleam/blob/main/changelog/v1.18.md)
- [Cloudflare WebSocket attachments](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)
- [Phoenix JavaScript client](https://hexdocs.pm/phoenix/js/)
