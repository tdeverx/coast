# Fresh reading consistency follow-up

2026-10-15; current working tree, Bun 1.4.3/macOS ARM64. Read the strengthened `docs/performance.md`, consolidated audit and prior reader report. No DB, network, provider, browser, service, dependency or schema changes in discovery. Safe probe: `/private/tmp/coast-criteria-reading-probe.ts` (actual comic module, transpiled actual client writer, verbatim production navigator callback; synthetic DOM/decoder/API boundaries).

## Validated findings

### READ-F1 — Navigator continuation publishes after renderer disposal

P2, high confidence. `src/lib/reading/Reader.svelte:38` writes global `reader.location` and invokes `recordReading` after awaiting `result.go`, without the abort/session checks used by the adjacent changed/resize callbacks. Cleanup at line 40 clears the registered navigator but does not revoke a callback already running. Actual CBZ canceled navigation resolves intentionally (`reader/comic.ts` cancellation catch/finally), so clearing the reference is insufficient.

Trigger: open tiny two-page comic, hold page-two decode, invoke actual `alignReading`, then perform effect cleanup and clear session/location. Observed: changed pages `[1]`, closed session `null`, yet location becomes `{format:'cbz',page:2,total:2}` after canceled alignment. Zero bookmark writes in this closed-session case. This confirms stale closed-state publication; it does **not** independently prove cross-session DB corruption.

Smallest fix: fence the component navigator's completion by captured controller, session ID and navigation revision; fence its shared `external` state release too, resetting that flag in cleanup. Do not change renderer cancellation's successful stale/no-op contract or preserve hidden renderers. Test pending navigation → close/replacement and late completion, no stale location/write, and newest alignment ordering.

### READ-F2 — Acknowledged bookmark snapshots are posted again on flush/close

P2 (avoidable operations), high confidence. `src/lib/reading/client.svelte.ts:76,84-95`. Actual client probe: three awaited records of the same CBZ location yield three location POSTs; closing then yields a fourth location POST and one close POST. Existing coalescing bounds concurrent writers but does not remember a successful acknowledgement. Typical production trigger is closing/switching a reader whose current page was already saved; the ordinary `changed` callback already avoids settled duplicates.

The server intentionally uses `reading_sessions.updatedAt` for social presence (`src/lib/social/presence.server.ts:11`) and resume ordering (`sessions.server.ts:67`); do **not** blanket skip identical server moves. `updateReading` already no-ops unchanged progress (`core/reading/service.server.ts:52`). Explicit visible-reader heartbeats have their own 60-second owner (`Reader.svelte:17`) and `touchReading` writes activity independently (`sessions.server.ts:129`).

Smallest fix: retain one acknowledged `{sessionId,location}` in the existing client writer; skip duplicate snapshots after successful acknowledgement, including close, while retaining changed pending state, latest drain and failed-save retries. Do not seed acknowledgement from a new session's location or introduce another writer/timer/cache. Keep authoritative server permissions and touch behavior. Verify successful duplicates, identical pending drain, first+latest changes, failure retry, final close, and unchanged 60-second heartbeat ownership.

### READ-F3 — Canceled file readers retain queued permission metadata work

P2, high confidence. `src/lib/reading/sessions.server.ts:107` calls `adapter.readingItem` without a signal; only the later Download receives `request.signal`. `prepareReading:45` likewise cannot propagate its optional signal into metadata. `src/lib/providers/jellyfin/adapter.server.ts:361` and `reading.server.ts:14-18` expose no reading-item signal and invoke transport without a RequestInit. The shared provider queue cancels waiting work correctly when supplied a signal; these adapters do not supply one.

Safe reproduction `/private/tmp/coast-criteria-reading-cancellation.ts` runs the actual `streamReading` source, actual JellyfinAdapter and actual shared queue. Authentication/credentials/provider response are synthetic controlled boundaries. With one held active origin request, the file permission lookup queues behind it. Aborting the incoming file Request leaves **2 outstanding / 1 waiting** unchanged, stream unsettled, transport signal absent. Releasing the held request executes **one obsolete metadata lookup after abort**; the later Download rejects `AbortError` and performs zero downloads. Queue drains to zero. This is confirmed obsolete admission/work, not a production latency, pool-starvation or memory claim.

Smallest repair: thread an optional signal through `JellyfinAdapter.readingItem` and `jellyfinBook` to transport, pass preparation's signal and the file Request signal. Retain exact permission/version revalidation for every live request. Test queued abort removes the request before execution, active lookup receives the signal, and successful reader permission/identity behavior stays unchanged. Adapter-file coordination belongs to the playback auditor/root, who is already adding related signal plumbing there.

## Coverage / checked nonissues

- Prior pending CBZ URL/decode and PDF failed-raster retry repairs remain present, including separate pending/displayed ownership and successful-page identity.
- PDF/EPUB/CBZ imports and digest worker remain demand-loaded. Hashing is incremental in a separate worker, with abort-driven worker termination.
- EPUB preparation still validates declared and actual extraction output, metadata caps, duplicate/unsafe paths and finally-closes both archives; a compressed-byte cap is not a total browser-memory guarantee.
- Visible-reader heartbeat is 60 seconds, skips document-hidden state, and effect cleanup clears it, disconnects resize observation and aborts/destroys renderer. No extra polling/timer introduced by the proposed repairs.
- Reading metadata caches are finite (60 discovery/100 search/200 detail/200 edition); canonical saved metadata remains available without per-card remote calls. Server SQL catalogue/history paths use bounded pages; no unsupported scan-cost claim from offset alone.
- File relay retains own-user session/account-generation checks and exact edition permission/version revalidation before bounded single-range streaming. Request-local repeated connection hydration is a possible cost to measure, not authority to weaken checks.
- Session retention exists: bounded deletion preserves the newest bookmark per edition (`server/storage/retention.server.ts:22`); sessions are not an unbounded-per-open history defect.
- Canonical progress already avoids unchanged row/webhook writes. Repeated file observations maintain access timestamps/scan evidence, so no blanket unchanged-observation suppression proposed.

## Explicit gaps / candidates

- EPUB peak memory, predecode image pixel admission and extreme PDF canvas size remain prior evidence gaps; no real large-file decode, RSS/OOM or leak claims.
- No full browser lifecycle heap plateau, mobile/native codec, multi-account party or real remote range acceptance was run. Synthetic decoder/API counts do not certify those cases.
- Permission-fetch cancellation is now reproduced as READ-F3 above; no claim that canceling the eventual Download cancels earlier metadata work.
- Direct PDF resize bursts, EPUB queue teardown and archive peak lifetime need separate controlled probes before claiming additional defects.

## Accepted implementation and focused verification

READ-F1 now fences navigator completion/error publication by captured abort controller, session ID and latest navigation revision. Current decoder failures still reject; stale failures settle without surfacing into the next owner. Cleanup invalidates the revision and resets external navigation state. READ-F2 remembers one successful acknowledgement within the existing client writer, skipping identical settled/pending snapshots and final close flush while keeping failed retries and newest changed drain. Any failed delivery invalidates acknowledgement because the server may have applied the update before its response was lost; returning to an older page therefore sends it again. Server activity timestamps, authentication, explicit heartbeat and schema are unchanged.

`bun test tests/media-lifecycle-client.test.ts tests/reading-renderer-lifecycle.test.ts tests/reading-reader.test.ts`: **20 passed, zero failures, 86 assertions**. New cases execute the Svelte-compiled actual client and the actual Reader component script against controlled engine/timer boundaries: delayed close/replacement success/failure, observable current failure, latest alignment, successful/failing identical snapshots, lost-response recovery, first+newest drain and the explicit visible 60-second heartbeat plus hidden/disposal behavior. Existing actual comic/PDF decoder lifecycle regressions also pass. Scoped `git diff --check` passes. Root owns type/style/build/full-suite and rendered acceptance; these focused checks do not substitute for those gates. No services/DB/providers/dependencies/schema/commits touched.

READ-F3 is now repaired through the existing provider transport/queue: `JellyfinAdapter.readingItem` and `jellyfinBook` accept/forward an optional signal; preparation supplies its signal and file delivery supplies the incoming Request signal. Already canceled item lookup rejects before transport, and already canceled file delivery rejects before authorization queries. Per-live-request permission and exact file identity checks remain intact.

The new isolated `tests/fixtures/reading-request-cancellation.ts` imports the actual sessions module, Jellyfin adapter/helper and shared queue; only database authorization/config/credentials and the eventual Download boundary are mocked. Both preparation and file delivery now move from **2 outstanding / 1 waiting** to **1 outstanding / 0 waiting immediately on abort**, then reject AbortError; after releasing the unrelated blocker, queue metrics reach zero and **zero obsolete metadata executions / zero downloads** occur. Active permission reads receive cancellation; ordinary successful identity and mismatched-file rejection remain covered. The fixture never starts a DB connection or sends network traffic.

Final combined focused run: `bun test tests/reading-request-cancellation.test.ts tests/jellyfin-playback-cancellation.test.ts tests/media-lifecycle-client.test.ts tests/reading-renderer-lifecycle.test.ts tests/reading-reader.test.ts`: **24 passed, zero failures, 95 parent-process assertions**, with additional assertions inside the isolated request fixture. Scoped diff check passes. No production dependency/schema changes or services/full gates were run.
