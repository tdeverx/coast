# Playback and reusable sharing audit

Scope: current working tree, 15 October 2026. Read-only engineering review of source planning, personal audio/video sessions and progress, browser controller, native/HLS branches, subtitles, trailers/crop/hero visibility, reusable sharing authority, viewer budgets/leases/cleanup/history and shared Active streams attribution. No application changes, provider requests, database access, running services or credentials were used. Synced-party internals belong to the social review.

Relevant functions were followed across route, service, provider, schema and outbox boundaries. Large cross-domain modules were read in relevant sections, not every unrelated function or CSS rule. The JSON companion records substantively read files separately from search/targeted-scan coverage. Existing pure tests ran successfully; two bounded in-memory harnesses exercised current compiled code with mocked dependencies.

## Coverage and healthy patterns

- The pure planner examines sources across candidates, preserves policy ceilings and prefers compatible direct delivery over transcoding. Relay responses preserve ranges, enforce server/item namespace validation, use pinned provider transport, bound response sizes/deadlines and cancel rejected bodies.
- HLS child resources are encrypted capabilities bound to their playback session. Shared dispatch additionally checks its viewer and grant; source account replacement invalidates shared grants. Stable resource paths replace only encoding-session/device/bitrate parameters.
- Shared admission is owner-scoped across links and uses short transactions without provider I/O. Preparation publication/finally cleanup uses UUID ownership tokens. Replay drains retired encoders; failed stops keep durable retry flags. The current request-lease and replay fixes are present and are not reported again as old defects.
- Sharing progress is separate from personal history/listens/scrobbles. Shared history follows the playback-session record across viewer replays. Stream hydration groups sources and uses bounded keyset pages; device-based duplicate exclusion is present.
- Persistent native elements, HLS engine/crop teardown, observer/listener cleanup, conservative black-bar detection and foreground-video hero hiding are explicit. Listen accounting excludes seek jumps and clamps reports by elapsed time. UI preview state is injected separately.
- 55 focused existing pure tests passed, covering planner/path/manifest contracts, sharing policy, failure buffering, crop, listening, time formatting, hero visibility and stream presentation. Database sharing tests contain meaningful concurrency, generation, replay, cleanup and source-isolation scenarios; they were inspected but not executed.

## Prioritized findings

### PLAYBACK-01 — P2 — Personal playback can publish scrobbles into a replacement source account

Confidence: strong-static.

Start personal audio/video under Jellyfin account A. Keep the player active while linking account B to the same Coast connection. Allow a subsequent progress/pause/end report from A playback. Buffered playback makes this possible even if B cannot stream the old item.

New reports survive the old-action cancellation and are stamped with B generation. The worker sends A session/item IDs using B credentials. If B can access that item and Jellyfin accepts the report, its progress/history can be changed. At minimum stale session requests are sent under the wrong account. No cross-account disclosure or live upstream mutation was demonstrated.

Evidence:

- `src/lib/server/db/schema.ts:818` — Personal sessions retain the connection ID and provider IDs, but no account-generation binding.
- `src/lib/playback/service.server.ts:438` — Progress admission checks session ID, Coast user and expiry, then rejects shares; it never checks the originating account generation.
- `src/lib/playback/service.server.ts:486` — Audio reports enqueue provider actions using the old session connection ID; video does the same at line 520.
- `src/lib/sync/changes.server.ts:391` — Playback intent inserts a fresh jellyfin.scrobble action against that connection ID.
- `drizzle/0016_collection_and_music.sql:234` — The outbox insertion trigger binds the action to the connection generation current at insertion, rather than the playback origin.
- `drizzle/0022_verified_trakt_identity.sql:18` — An account switch rotates the connection generation and cancels existing actions, but does not invalidate playback sessions.
- `src/lib/sync/jellyfin.server.ts:925` — Scrobble execution reloads the session by user/connection and resolves current Jellyfin credentials at line 941.
- `src/lib/playback/service.server.ts:588` — Media relay also resolves current credentials from an unversioned personal session.

Minimal correction: Pin the selected connection accountGeneration in personal playback sessions; recheck it when publishing preparation, relaying, accepting progress and executing scrobbles. Reject/retire stale sessions before inserting outbound intent. Use the existing account lock/generation boundary so account replacement cannot race the check; do not stamp stale intent with the new account generation.

Verification: Disposable DB/provider fixture: start A; replace external_user_id/credentials on the same connection with B so the trigger rotates generation; submit old-session progress and inspect outbox plus fixture requests. Assert no B-generation scrobble or B-authenticated relay is emitted, and a fresh B session works. Cover replacement during delayed PlaybackInfo as well.

### PLAYBACK-02 — P2 — Stopping playback does not invalidate an in-flight preparation

Confidence: confirmed.

Delay POST playback. Call stopPlayback before its response arrives, then resolve the request. A concrete UI route is leaving the invitation page while its shared source is preparing.

The supposedly stopped player returns to playback and can autoplay after teardown. A late shared session can also survive after API routing has returned to the personal endpoint, so its progress/error operations use the wrong route. The server prepared session is not retired by the earlier stop because its ID was not yet known.

Evidence:

- `src/lib/playback/client.svelte.ts:48` — stopPlayback delegates to the controller without cancelling or invalidating preparation.
- `src/lib/playback/client.svelte.ts:110` — The preparation request has no AbortSignal or operation-generation capture.
- `src/lib/playback/client.svelte.ts:122` — The response unconditionally publishes its session and sets role to playback, even after stop/teardown.
- `src/lib/ui/components/PersistentPlayer.svelte:195` — The controller close path clears the present session but has no pending-prepare invalidation.
- `src/routes/share/+page.svelte:34` — Share-route teardown stops playback and resets API routing, so a late shared preparation can repopulate the root player after leaving the route.

Minimal correction: Give preparation a client-owned AbortController and revision. Invalidate it on explicit stop/teardown; publish only when the revision is still current. Keep the internal old-session stop used during replacement separate from explicit cancellation. Retire any already-created late session through the transport captured for that preparation, rather than the mutable global API mode.

Verification: Compiled-current-client mock reproduced: delayed preparation -> stopPlayback -> deliver session yielded sessionAfterStopAndDelivery=late and role=playback. Add a focused client regression expecting idle/null after the same sequence, including share teardown and a subsequent fresh playback request. No browser/autoplay or server allocation runtime was exercised.

### PLAYBACK-03 — P2 — Audio Try again resumes the failed session instead of preparing a replacement

Confidence: confirmed.

Let direct or HLS audio enter the persistent player error state, then press Try again. This also affects a shared audio session already retired by the error endpoint.

Retry neither replaces the source/session nor clears the error through the session-reset effect. An unrecoverable decode/source failure remains on the same element; a retired shared session cannot be revived by play(). Closing and reopening is required.

Evidence:

- `src/lib/ui/components/PersistentPlayer.svelte:330` — Audio retry calls playMedia(session.mediaId,{mediaType:audio,fromStart:false}).
- `src/lib/playback/client.svelte.ts:83` — Those arguments satisfy the same-item playback shortcut; it calls controller.resume at line 96 and never prepares another session.
- `src/lib/ui/components/PersistentPlayer.svelte:433` — Controller resume calls media.play on the existing failed element.
- `src/lib/ui/components/PersistentPlayer.svelte:550` — The displayed Try again button invokes this switchEdition path.

Minimal correction: Distinguish explicit recovery from ordinary same-item resume. Have the existing retry path request a fresh session while retaining resume position; bypass the shortcut only for that recovery, and clear the error when the replacement is published.

Verification: Compiled-current-client mock using the exact audio retry arguments yielded resumes=1, preparationRequests=0, session=failed. Add a client/controller fixture that faults audio, clicks recovery, asserts a new preparation/session and cleared error. Cover direct and HLS audio plus shared-session retirement.

### PLAYBACK-04 — P2 — Slow shared cleanup overlaps maintenance ticks and delays ordinary scheduling

Confidence: confirmed.

Leave several cleanup_pending sessions for a connected Jellyfin source whose stop endpoint times out or responds slowly. A cleanup pass takes longer than the one-minute maintenance interval.

Later ticks enter cleanup while earlier ticks are still waiting. Pending sessions can receive duplicate stop attempts, and each tick postpones normal scheduling until its cleanup returns. Per-origin pacing limits concurrent remote calls but does not coalesce these maintenance callers. No production leak, OOM, sustained backlog size or measured outage duration is claimed.

Evidence:

- `src/lib/sharing/leases.server.ts:107` — A lifecycle pass serially releases up to 20 expired viewers, each awaiting remote stop.
- `src/lib/sharing/leases.server.ts:111` — It then selects up to 20 pending stopped sessions and awaits each provider retry; failures remain pending.
- `src/lib/sharing/leases.server.ts:69` — Each cleanup can wait for dispatch leases and then call the provider before completing.
- `src/lib/providers/maintenance.server.ts:277` — maintenanceTick awaits cleanup before provider scheduling and retention.
- `src/lib/providers/maintenance.server.ts:290` — A new asynchronous tick starts every 60 seconds without an in-flight guard; startup also launches a tick at line 298.
- `src/lib/server/security/provider-fetch.ts:180` — Provider fetches allow a 15-second default response deadline, so a count-bounded serial cleanup batch need not complete within one minute.

Minimal correction: Coalesce cleanup into one process-local in-flight pass and let normal scheduling proceed without awaiting network cleanup. Preserve durable cleanup_pending retry flags and the existing owner/dispatch fences; use a modest per-pass time/work budget if needed instead of increasing transport concurrency.

Verification: A bounded mock ran the current maintenanceTick/startProviderMaintenance source unchanged with fake interval callbacks and deferred cleanup. Startup plus two simulated minute ticks produced cleanupCalls=3 and scheduledCalls=0; releasing the promises produced scheduledCalls=3. Add this fake-clock regression and assert only one cleanup pass runs while ordinary scheduling continues. Separately use a disposable provider fixture with multiple delayed stops to test the chosen batch budget.

## Boundaries and uncertainties

The generation finding is a source-to-sink defect: account-switch triggers cancel old intent, but a surviving unversioned personal session creates *new* intent that the insertion trigger binds to the replacement account. Its exact remote effect depends on Jellyfin accepting the old item/session under the replacement credentials; no remote mutation or disclosure was demonstrated.

The client harness compiled the actual current playback module and replaced transport, controller, diagnostics, reading/sync dependencies and the capability-probe document. It reproduced control flow without rendering or decoding. The maintenance harness executed the current scheduler tail with deferred cleanup and fake interval callbacks; no real delay or production backlog was measured.

Actual Safari/iOS/native-HLS autoplay, decoding, source quality handoffs, subtitle rendering, provider disconnect/replacement during I/O and remote encoder shutdown still require disposable browser/provider fixtures. The database suites were not run. In particular, successful fixture segment responses alone cannot certify uninterrupted bitrate transitions or strict egress shaping.

The Jellyfin reviewer owns the companion endpoint's missing DeviceId observation; the auth reviewer owns settings reset dropping administrator bitrate limits. These are not duplicated here. No additional naming/placement findings were raised merely because the persistent player and session service are large; their current ownership matches the organisation guide.

## Minimal ordered recommendations

1. Pin and enforce personal playback account generation before new outbound effects; exercise account replacement during both preparation and ongoing buffered playback.
2. Fence client preparation by an operation revision and cancellation signal, including share-route teardown and retirement through the original transport.
3. Make explicit audio recovery prepare a new source/session while keeping ordinary resume behavior.
4. Coalesce network cleanup independently of the minute scheduling loop, preserving durable cleanup flags and existing owner/request fences.
5. Run the focused new client/mock regressions first, then the existing disposable sharing/provider database suites and real direct/native-HLS/hls.js browser fixtures for the changed paths. Preserve the approved UI.

Checks: the exact existing-test command and mock-harness outcomes are recorded in `07-playback-sharing.json`. No check/build, DB test, provider or browser command was run by this reviewer.
