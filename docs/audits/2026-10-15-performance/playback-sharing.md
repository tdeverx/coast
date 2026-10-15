# Independent performance audit: playback, parties and reusable delivery

Baseline: `ea01908` on `codex/performance-criteria`, 2026-10-15 UTC. Read-only phase. Reviewed `docs/performance.md`, `docs/architecture.md`, prior October 3 performance evidence, October 15 playback/reading implementation and audit, and current player/hero/client/party/delivery/provider code. No production files, DB state, provider configuration, dependencies or Git state changed. No database, live provider, browser, full check or build was used.

## Evidence boundary

Two temporary probes execute actual current function source through `Bun.Transpiler`, replacing only transport, SQL, media/DOM boundaries and clocks. These establish work counts/control flow, **not browser layout costs, memory leaks, playback acceptance or production latency**.

- `/private/tmp/coast-playback-perf-probes.ts` and `.json`: actual `report`, hero `reposition`, `withSharedRequest` and `waitSharedRequests`.
- `/private/tmp/coast-playback-perf-extra.ts` and `.json`: actual `streamForViewer` and `roomState`.
- `/private/tmp/coast-perf-playback-focused.log`: 47 existing pure/compiled tests passed, 0 failed, 204 assertions across 11 suites. Included crop, visibility, failure tolerance, retry, media lifecycle, sync client/model, sharing policy, maintenance lifecycle and listening accounting. No guarded DB suites were enabled.

## Findings

### PB-PERF-01 — P2 — Slow progress delivery retains every obsolete progress snapshot and holds stop behind the whole backlog

**Confirmed control flow and operation counts.** `src/lib/ui/components/PersistentPlayer.svelte:135-169` appends every invocation to one `reports` Promise chain. Periodic reports arrive every ten seconds (`:258-260`), while seek/play/pause paths can add more. `close` awaits `report('stop')` before removing the player (`:194-209`). The browser transport has no automatic request deadline (`src/lib/ui/client.ts:34-57`). A slow request therefore retains all following snapshots and delays teardown/session replacement. It later replays obsolete positions, each performing a server progress transaction and potentially scheduling provider work.

Actual-source fixture: hold the first transport call; enqueue 60 progress snapshots and a stop. While blocked only one request is active (good), but after release **61 calls** execute, with stop at index **60**, replaying positions 0 through 590 before final 600. No real-time threshold or memory-slope claim is made.

**Smallest fix:** retain the single in-flight request and ordered lifecycle events, but replace a *consecutive pending progress* snapshot with the newest one, scoped to session ID and captured transport. Do not coalesce across start/pause/ended/stop boundaries, do not discard lifecycle events, and preserve failed-start acknowledgement recovery, stop draining, audio `playedSeconds`, final position and existing retry notice. A small bounded drain helper is simpler than another polling framework. Do not change ordinary media reporting intervals to conceal the backlog.

**Acceptance:** actual-controller fixture holding a request must send first + latest consecutive progress + stop, maintain ordered start/pause/resume/stop boundaries and session identity, preserve monotonic listened-time accounting and retry a start before later progress when its acknowledgement failed. Closing must drain final state rather than silently lose history. Network failures must never stop buffered media merely to clear a tracking queue.

### PB-PERF-02 — P2 — Hero geometry bypasses the shared frame-coalesced layout rule

**Confirmed work amplification.** `src/lib/ui/heroes/presentation.svelte.ts:153-157` reads `getBoundingClientRect` and assigns a fresh reactive rectangle synchronously on each window scroll/resize. The guard checks only matching title ID, not hero intersection/visibility. The separate ResizeObserver (`:177-180`) performs another read/write path.

Actual extracted handler fixture: 120 modeled frames × four events produced **480 layout reads**, even with `heroPlayer.visible=false`. This is an event-count proof, not a forced-layout trace or FPS estimate.

**Smallest fix:** coalesce geometry reads into one owner-scoped pending animation frame for scroll/resize and share the update with its observer where practical. Check matching owner at execution time, cancel on effect cleanup, suppress no-change rectangle writes, and avoid off-screen updates; refresh once on renewed intersection before showing the persistent trailer. Preserve immediate initial attachment geometry and nested detail-modal/route ownership. Do not replace observers with per-card/global polling.

**Acceptance:** multiple scroll/resize events before one frame read once; hidden hero causes zero scroll reads and reentry refreshes position; destroyed/switched owners cannot publish late geometry. Validate production build scroll, modal/detail positioning and trailer/foreground video transitions in a real browser, with reduced motion and teardown.

### PB-PERF-03 — P2 — Shared quality handoff performs obsolete work after its caller has already aborted

**Confirmed actual entrypoint control flow.** `src/lib/sharing/service.server.ts:127-141` executes share checks, reservation and `ensureSharedEncoding` before `withSharedRequest` first observes `request.signal`. `src/lib/sharing/leases.server.ts:43-67` has no signal parameter, waits up to 25 seconds for a preparation fence and may wait for dispatches/stop the encoder/change its generation. `waitSharedRequests` (`src/lib/sharing/request-leases.server.ts:40-48`) also has no caller cancellation input. Ordinary replay/cleanup uses this same drain, so cancellation cannot simply be made mandatory everywhere.

Actual `streamForViewer` fixture with an already-aborted Request still called **assertShare → reserveViewer → ensureSharedEncoding → withSharedRequest**, then finally failed. The provider boundary was mocked, so no actual remote stop was performed or claimed.

**Smallest fix:** reject aborted delivery at entry; thread an optional signal into request-owned quality preparation/drain, check before and after awaited DB/drain/provider boundaries and use an abortable short wait. Always release the UUID preparation token in finally. Request cancellation must stop obsolete delivery work; durable lifecycle cleanup/replay fencing must retain its independent responsibility. In particular, once a destructive remote stop has occurred, do not abandon publication/repair in a way that leaves the old provider session advertised indefinitely; maintain a consistent recoverable generation or let the next delivery safely retry. Do not weaken dispatch fences or lease duration safety.

**Acceptance:** pre-abort produces no reservation/quality/provider work; abort while waiting on another preparation or dispatch fence releases the waiter promptly with no encoder stop and no leaked token; abort during a completed remote stop leaves a recoverable session and a later fresh request succeeds. Existing parallel resource, replay/quality-drain, permission/generation and crash-lease DB cases must remain green.

### PB-PERF-04 — P2 — Lease saturation and crash recovery poll the DB far more often than the durable deadlines require

**Confirmed operation counts.** `src/lib/sharing/request-leases.server.ts:14-28` retries every 50 ms. A saturated viewer repeats a row-lock transaction, expired-lease delete and active count. Drain (`:42-47`) repeats delete + lookup every 50 ms. This is bounded in elapsed lifetime, but needlessly aggressive in SQL and lock churn precisely when a viewer/server is busy.

Actual-source fake-clock fixtures:

- Eight occupied dispatch slots held for one second: **21 transactions / 65 SQL statements**, 20 sleeps, before one successful admission and release.
- A simulated still-valid crashed request lease for 35 seconds: **1,402 SQL statements**, 700 sleeps, before drain completes.

These are control-flow counts with mocked SQL; no DB contention, timeout or pool starvation was measured.

**Smallest fix:** retain prompt first retry, then bounded adaptive backoff (for example 50 → 100 → 200 → 250 ms), checking abortion and deadlines at each boundary; consider retaining existing indexed expiry cleanup rather than running broad extra scans. A process-local optimization may reduce repeated waiters, but must never replace the database admission fence or fail across workers. Do not add LISTEN/NOTIFY, another queue, indefinite caches, weaker leases or higher concurrency without evidence.

**Acceptance:** same fake-clock fixture shows bounded, substantially lower SQL counts; a released slot still becomes available within the capped wait; max eight admitted dispatches, 25-second dispatch deadline, 35-second durable expiry and 40-second drain contract remain intact; cancellation is prompt. Run existing DB concurrency fixtures, including simultaneous viewers, replay, quality stop ordering and expired crash leases. Count SQL/lock wait under a deliberate saturation fixture before claiming improved throughput.

### PB-PERF-05 — P2 — Heartbeats repeatedly rewrite already-revoked party memberships

**Confirmed query shape; tuple/WAL cost not measured.** `src/lib/playback/synced/service.server.ts:110-116` issues three revocation UPDATEs per state read without restricting them to currently joined memberships. A participant revoked for friendship removal or an expired source remains matched on every subsequent read and is updated again to the same `joined=false,buffering=false` values. This applies to GET state as well as heartbeats. `src/routes/+layout.svelte:78` polls every two seconds while participating; the room limit is 16.

Actual `roomState` source run with SQL boundaries mocked executes **three revocation UPDATE statements even for read-only state**, and none has a `p.joined` guard. At 16 active clients, the schedule alone permits **480 state polls / minute and 1,440 revocation UPDATE statements / minute** before other checks; that is a derived upper bound, not measured traffic. PostgreSQL can create needless new row versions for matched already-false rows. An actual disposable DB test is still needed to quantify row changes/WAL, not infer them from the SQL mock.

**Smallest fix:** add `p.joined` to each relevant revocation predicate (or `joined OR buffering` only if an invariant-repair case requires it) so only live memberships transition. Preserve account-generation/connection expiry, disabled-user and friendship checks every heartbeat; never cache authorization or remove them. Keep host disconnect, ready checks, controller pruning and reading session handover semantics intact. Skipping the audio queue query when its bounded queue is empty is a separate harmless micro-optimization, not the core defect.

**Acceptance:** disposable fixture revokes a member once, repeated room reads retain identical membership/state with no further row-version updates; rejoining a valid source works; friendship/disabled user/account replacement still revoke immediately; reading handover and host-transfer tests pass. Record DB statement/affected-row counts with 1 and 16 participants before claiming a CPU reduction.

## Measurements required before further changes

1. **HLS retained buffers:** `PersistentPlayer.svelte:382` still uses `new Hls()` with installed defaults `backBufferLength=Infinity`, forward target 30 seconds, `maxBufferSize=60,000,000`, `maxMaxBufferLength=600` (`node_modules/hls.js/src/config.ts:455-483`). Duration-based back-buffer flush is enabled only for finite backBufferLength (`.../buffer-controller.ts:1508`). This remains the October 3 unmeasured policy gap, **not evidence of a leak or process spike**. Trial a finite 60–90-second history on a controlled 20–30-minute fixture before selecting policy. Capture buffered ranges, network bytes, seek/refetch/stall/quota counts, browser memory and teardown. Compare native HLS separately; do not imply a JS option caps native buffers or guarantees bytes.
2. **Hidden trailer source retention:** source is paused on visibility/document hiding, unloaded on source/owner teardown, but last hidden persistent root trailer may retain buffers (`src/lib/ui/heroes/playback.svelte.ts:25-62`). One retained current source is bounded. Add idle source release only if controlled browser evidence warrants it, preserving quick pause/resume and no extra provider fetches.
3. **Room response payload:** an audio heartbeat rehydrates at most 200 queue entries with user-specific availability under the room transaction (`synced/service.server.ts:123-124`), repeated every two seconds/client. This deserves query/payload measurement at 16 members, but a cache cannot bypass changing per-user availability, generation or policies. Current limit is explicit; do not redesign sync transport based solely on static counts.
4. **Playlist capability work:** manifests are bounded to 2 MiB and each URI is validated/encrypted serially (`playback/service.server.ts:573-591,691-701`). Stress a realistic maximum segment count and capture CPU/rewrite bytes before introducing bounded parallel crypto. Never cache decrypted credentials or serve unsigned/invalidated resource URLs.

## Safeguards confirmed and worth retaining

- Current secure provider body uses **pull**, one chunk per downstream demand, max-byte limits, body read timeout, upstream reader cancellation and abort listeners (`src/lib/server/security/provider-fetch.ts:111-177`), rather than eagerly draining whole media into memory.
- Media response returns the bounded stream directly (`playback/service.server.ts:706`); only bounded playlists are buffered for rewrite. Range forwarding, source path constraints and generation checks remain authoritative.
- Shared dispatch leases release at response headers, intentionally allowing streaming bodies without holding DB transactions/leases for the entire film. Do not extend those leases across entire body lifetime; that would block quality changes on long direct streams.
- Owner reservation locks contain DB work only. Cleanup/provider calls run outside them; pending failed stops remain durable; maintenance cleanup was already coalesced independently of normal scheduling in the previous audit.
- Crop readback is only 320×180, skips hidden document/paused/unchanged frames, settles normal player crop, and destroys timers with its owner. Continuous hero sampling is about once per second once ready; no evidence here justifies a per-frame sampler or immediate redesign.
- Full player source replacement destroys HLS, pauses, removes source, calls load and clears crop/failure monitoring. Existing late-preparation generation/captured-authority tests are green. Hidden browsing UI is not a reason to pause intended audio/video.
- Party polling is single-flight and revision/generation guarded. Keep the 2-second heartbeat when hidden if playback participation remains active; blindly gating on document visibility would cause false host disconnect or group pauses.

## Criteria to add to performance.md

- **Media resources:** separately state JS/native decoder/network buffers, prebuffer targets and retained history policy; never equate RSS with leak. Required direct/native-HLS/hls.js long-play and close/reopen tests must record bitrate/codec/platform and buffered ranges.
- **Control pipelines:** one in-flight write, coalesce redundant state snapshots by stable owner/session while preserving lifecycle event order and final drain; bound pending work even during slow network. Preserve accounting/permissions on retries.
- **Polling:** justify interval, count work per poll, avoid no-op writes, scale fixtures by actual maximum active clients and measure payload/WAL/affected rows as well as duration. Authorization freshness must survive optimizations.
- **Lease/quality waits:** publish explicit deadline/concurrency/SQL-at-saturation budgets, cancel obsolete request-owned waiters, preserve crash recovery and fencing after partial destructive effects. No provider network I/O inside reservation transactions.
- **Geometry:** one read/write publication per owner/frame, skip hidden work, cancel scheduled frames and observers on owner change, prevent stale publication. Synthetic event counts support scaling claims; production traces support frame-time claims.
- **Acceptance:** retain the existing failure-tolerance, multi-medium switching, start/pause/seek/stop ordering, audio accounting, source generation, privacy/permissions and party handover matrix. Synthetic correctness or operation reductions alone cannot certify codecs/autoplay/real device playback.

## Recommended order

1. Report coalescing, hero frame coalescing and no-op membership guards: low-complexity shared fixes with meaningful local regressions.
2. Cancellation + bounded wait/backoff together, preserving partial-stop recovery and existing durable lease fences; coordinator runs disposable sharing DB tests.
3. Controlled long-play browser evidence for back-buffer policy and trailer release; select a measured policy, not an arbitrary cache/limit.
4. Record room/playlist/segment fixture operation budgets and update the performance guide with those actual results and remaining evidence limits.
