# Independent playback consistency follow-up

Baseline: `ea01908`, implementation working tree, 15 October 2026. Read `docs/performance.md`, current implementation ledger and original independent playback report. Inspected personal audio/video controller, hero, party client/server, reusable browser/external playback, request/quality leases, provider body relay and server-stream observation lifecycle. Initial discovery was read-only; coordinator subsequently requested implementation of the two findings below. No DB, containers, services, providers, credentials, browser, full checks/builds or production dependency changes were used.

## Evidence

`/private/tmp/coast-criteria-playback-followup-probe.ts` executes the actual share onMount callback and preparePlayback candidate loop through Bun.Transpiler, replacing transport/media/time boundaries. Raw results: `/private/tmp/coast-criteria-playback-followup-probe.json`. Bun 1.4.3. These are control-flow/operation counts, not browser memory, native-codec, DB/WAL or real-provider measurements.

## Confirmed findings

### PB-F01 — P2, high confidence — Reusable share route retains async authority after disposal

`src/routes/share/+page.svelte:13-15,24-34` clears the interval but neither aborts nor fences its pending state request or mount preparation. Actual-source trigger: enter share, hold the state GET, navigate away, attach successor playback, then settle the old request. A success performs one alignment against the successor; a failure performs one additional `stopPlayback` against the successor after cleanup's stop. Holding the initial `stopPlayback` until after disposal also produces API authority writes `[false,true]`, leaving shared authority selected after the route departed. The route single-flight check correctly bounds ordinary overlap to one request, but each discarded route may retain one asynchronous owner until network completion; no deadline is imposed by its fetch.

Smallest repair: one route-owned AbortController/disposed predicate; pass signal through the route's optional state/claim requests, fence all post-await state/playback/authority publication and release authority only while still owned. Serialize cleanup with the mount stop/preparation and stop playback using the captured share authority; do not let an old cleanup reset a later owner's authority. Preserve essential together polling while participating, transient playback tolerance, final report drain and ability to reopen. Tests: held state GET success/error after disposal must neither align nor stop successor; delayed initial stop cannot reinstall authority; repeated close/reopen leaves current owner authoritative; pending claim/open cannot start after disposal.

### PB-F02 — P2, high confidence — Playback preparation cancellation stops at the provider boundary

`src/lib/playback/service.server.ts:204-223` checks its caller signal before/after provider awaits but calls `adapter.identity` and `adapter.playbackInfo` without it. The adapter methods (`src/lib/providers/jellyfin/adapter.server.ts:225-234,392-464`) cannot currently accept the owner signal, although `call` and secureProviderFetch already support RequestInit.signal. Actual candidate-loop probe: start PlaybackInfo, abort, flush microtasks: preparation remains unfinished and PlaybackInfo has no signal argument; release held provider reply: only then does preparation reject AbortError. This retains one obsolete in-flight/queued provider operation per canceled owner, bounded by existing global admission and provider deadlines. It does not prove a memory leak, pool starvation or an unbounded queue.

Smallest repair: optional signal on the existing Jellyfin identity/playbackInfo methods and forward into their existing call's RequestInit; supply the preparation signal from its shared owner. Keep identity/account validation and post-await generation checks, provider pacing/deadlines and cancellation cleanup. Do not cancel the destructive encoder-stop publication path midway: its deliberate consistent-generation recovery remains correct. Tests: held actual adapter transport observes signal, abort releases caller promptly; pre-abort doesn't issue owned work; ordinary callers remain unchanged; guarded playback/account-generation fixture confirms no session publication after abort.

## Healthy patterns / checked nonfindings

- Progress reports now use one sender and replace only consecutive pending same-session progress; ordered lifecycle/final drain and played accounting remain intact.
- Quality preparation now observes optional request cancellation; durable token finally-release and consistent generation publication after remote stop remain present. Dispatch/drain waits use abortable capped adaptive polling (50,100,200,250 ms) and preserve durable capacity/expiry.
- Party revocation UPDATEs restrict to joined rows; ordinary heartbeat writes remain necessary liveness, rather than no-op candidates.
- Personal source replacement destroys HLS/crop/failure timers and unloads native media; lazy HLS import checks cancellation before allocating its engine.
- Hero geometry is frame-coalesced; trailer lookup cancellation is already under coordinator repair. Hero source/crop visibility suppression remains bounded to one root surface.
- Provider relay pulls on demand, caps body bytes, handles downstream cancel/abort and frees timers/listeners. Bounded manifests alone are materialized. Request leases intentionally end at headers rather than holding an eight-slot lease through an entire film.
- Server stream recording serializes by instance, validates account generation and active job attempt, rejects old captures and preserves existing sessions after failed reads. Stream listing is bounded/keyset paginated. Per-stream scan timestamp writes express observation freshness and are not established no-op defects.

## Evidence gaps / follow-ups, not confirmed findings

Long-play HLS buffer retention, native HLS/codecs/autoplay, real-device close/reopen buffers, live 16-member party payload/locking, playlist crypto at realistic maximum segment counts and large stream census DB plans remain separately evidence-gated. No HTTP 200 or source/default-policy inference is used to claim a playback defect. Party client currently generation-fences old results but does not pass cancellation to heartbeat/attach calls; a deliberately unresolved old poll may retain its single-flight flag across room replacement. A dedicated actual-module reproduction is needed before adding this as a separate flag or broadening the accepted repair.

## Implemented repair and focused verification

Coordinator authorized the two fixes after reviewing the evidence. `/share` now owns one AbortController, passes it through optional claim/state work, fences post-await state/alignment/open publication, and prevents delayed mount completion after teardown. `setPlaybackApi` returns a revision-scoped release, so old cleanup cannot revoke a reopened owner's authority; captured final playback report authority continues to work. No UI markup/styles changed.

The common playback preparation supplies its signal to Jellyfin identity and PlaybackInfo; the existing adapter methods forward it through their existing RequestInit transport, rejecting pre-aborted calls before provider work. No new queue, timeout policy, dependency, schema or production provider behavior was introduced.

Focused final run: **56 passed, 0 failed, 228 assertions across nine files**, using Bun 1.4.3: shared-playback-lifecycle, jellyfin-playback-cancellation, ui-client, media-lifecycle-client, sharing-waits, playback-reports, synced-client, jellyfin-queries and jellyfin-access-proof. The new actual-route tests prove both late poll outcomes cannot control successor playback, disposed preparation cannot reinstall authority/start playback, ordinary together polling stays single flight, and a late claim cannot issue state/play work. Real adapter tests observe the exact caller signal and cancellation at transport, including pre-abort zero work. ui-client tests verify captured cleanup authority and reopened-owner release fencing.

`tests/playback-generation-db.test.ts` adds a guarded end-to-end preparation/provider-boundary cancellation case verifying no published session. It was parsed but **not executed here** (seven DB tests skipped under the ordinary guard); coordinator owns the disposable DB run. `git diff --check` passed. No service, real provider, browser or full build/check was run. Existing separate HLS/device/live party evidence gaps remain unchanged.
