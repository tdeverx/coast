# Independent audit: shared frontend performance and loading

15 October 2026. Read-only inspection of commit `ea01908654db7c0b4cf591028c7f9b321c6896dd`, Bun 1.4.3, arm64 macOS. No production files, databases, services, providers, dependencies, Git state or UI designs changed. Read `docs/performance.md`, architecture/code-organization, the October 3 client findings and implementation evidence.

## Reproducible evidence

- `/private/tmp/coast-perf-ui-probes.ts` and `.json`: real compiled Svelte Library/resource/revision modules with an injected client; actual lazyImage with a fake observer; actual relative-date formatter. No source-string behavior mirrors.
- `/private/tmp/coast-perf-ui-extra-probes.ts` and `.json`: actual compiled Credits and Shelf layout modules; injected response/geometry counters.
- Run either with `PATH="$PWD/.tools/bun-1.4.3/bun-darwin-aarch64:$PATH" bun /private/tmp/<script>` from Coast checkout.
- Focused current regressions: `bun test tests/lazy-image.test.ts tests/ui-resource.test.ts tests/ui-social-enrichment.test.ts tests/ui-discovery-source.test.ts tests/ui-progress-privacy.test.ts tests/ui-journal-visible.test.ts tests/ui-context-gesture.test.ts tests/ui-content-revision.test.ts tests/chart-standard-geometry.test.ts tests/chart-extended-geometry.test.ts tests/chart-presentation.test.ts tests/ui-preview-charts.test.ts`: **45 pass, 0 fail, 28,114 assertions, 12 files, 239 ms**.
- These measure behavior/operation counts and pure JS cost. They do not measure real browser frame time, paint, network, memory slope, media decoding or production latency.

## Confirmed findings

### UI-PERF-01 — P2: Library and Credits do not honor shared content revision freshness

References: `src/lib/ui/shelves/library.svelte.ts:88-96`; `src/lib/ui/shelves/credits.svelte.ts:55-74`; shared intended contract `src/lib/ui/content-revision.svelte.ts:20` and the already-correct `discovery.svelte.ts:97-165`.

Library watches object identity of `route.data.filters`, preview refresh and initial payload, but never watches durable/local content revisions or viewer identity. After activating once, a provider-import revision or an explicit local tracking revision leaves its settled rows unchanged. Replacing the filter object with equivalent primitives does reload it. This is inconsistent cache freshness, not a claim that the server fails to authorize subsequent actions.

Deterministic actual-module result: activation = 1 request; remote tracking revision = still 1; local tracking revision = still 1; replacing `{kind:'all'}` with another `{kind:'all'}` = 2. A component mounted as an overview Library shelf can therefore retain obsolete availability/progress while equivalent route-object churn reloads it unnecessarily. Grid SSR replacement should remain authoritative when it actually changes.

Credits likewise invalidates its bounded cache only on personId/scope, ignoring viewer and revisions. Probe fetches available=true once, changes the mocked server to available=false, changes tracking revision, and calls the ordinary `load()` again: requests remain 1 and available remains true because it restores its stale first-page cache. A Retry must actually retry rather than always hit the same memoized result.

Smallest fix: adopt primitive, scoped revision + selection identity in these two adapters, preserve already-settled data on ordinary transient failures, retain lazy activation and explicit SSR payload replacement; clear cached Credits selections on relevant revision/viewer changes and bypass cache on explicit retry. Do not remove caching or route through a second loading implementation.

Acceptance:
- Two unchanged session replacements and equivalent scalar filters cause zero extra requests.
- One relevant provider/local revision causes one refresh of an activated source; never-activated rows stay unloaded.
- Viewer/permission changes cancel stale delivery and cannot restore prior-viewer cache entries.
- Revision refresh preserves selected local filters, and changed SSR initial payload is not accidentally ignored or redundantly fetched.
- Credits switching back to an unchanged selection uses cache; Retry and revisions fetch fresh data.

### UI-PERF-02 — P2: queued horizontal artwork is requested after it has left the viewport

References: `src/lib/ui/lazy-image.ts:56-74`, queue pump `:7-17`.

The action unobserves each image at *enqueue*, before that image owns the rail request slot. It therefore cannot see a queued card leave the viewport while waiting. A rapid rail scroll with a slow first image leaves the old queued images in front of newly visible cards, requesting unnecessary offscreen artwork and delaying the visible region. This contradicts the documented per-rail, intersecting-only request policy; active network requests need not be aborted to fix the waiting queue.

Actual-action probe: A and B intersect; A starts, B waits. B exits and C enters. Finish A. Observed start order is **A, B**, although C is the only pending visible image. The fake observer sends the real intersection notifications; production ignores B's exit because it has already removed B from `pending`.

Smallest fix: retain observation of waiting jobs, remove a waiting job on exit, and enqueue it once on re-entry. Release observation when it actually starts; preserve the one-active-per-rail policy, DOM order among eligible jobs, fallback reacquisition and independent grids. No page-wide queue, preload or additional concurrency.

Acceptance: A active/B waiting → B leaves/C enters → finishing A starts C; B starts only after re-entry. Test re-entry deduplication, destruction and fallback source updates. Browser fixture should rapidly scroll both ways with a delayed first image and count actual `src` assignments/network starts. Preserve approved skeleton/card/metadata independence.

### UI-PERF-03 — P2: second-level shared clock repeatedly reformats unchanged old activity dates

References: `src/lib/ui/clock.svelte.ts:1-14`; unconditional consumer registration `src/lib/ui/components/MediaCard.svelte:28`; date labels at `:188` and `:310`; `src/lib/social/model.ts:34-42`. Other second-precision consumers (party timelines, drift and job countdowns) are legitimate and must retain precision.

One ref-counted timer is good, but every MediaCard registers it even without a date. It runs when the document is hidden. Mounted activity dates depend on that second tick even after they become static calendar labels (>7 days), and each `activityDateLabel` calls `toLocaleDateString` with options again. Endless activity browsing scales this idle work with every retained card, not only visible cards.

Actual formatter probe: 300 activity dates aged 8–35 days, 60 simulated second ticks, 5 samples: 18,000 formatter invocations/run; 325.17, 332.45, 275.32, 273.23, 270.18 ms (median **275.32 ms**). Every label was identical throughout the minute. This is pure JS aggregate CPU, not frame time or proof of a leak; ordinary short feeds cost less.

Smallest fix: retain the shared ref-counted second clock for genuinely second-sensitive consumers, introduce a coarse/relative-date subscription (or memoized derived time bucket) for activity labels, register only when needed, suspend timers while document-hidden and resynchronize immediately when visible. Cache a bounded pair of locale formatters / stable date output appropriately rather than creating a formatter per old date each second. Avoid per-card intervals or per-card scroll listeners. If changing relative-label precision, preserve truthful minute boundaries and year/day rollover.

Acceptance: 300 old timestamps should not invoke date formatting every second; changing selection/locale/year still produces the same labels. Second-sensitive party/countdown consumers retain required behavior while visible. Hidden documents cause no ordinary UI clock ticks; visibility restore immediately catches up. Last consumer removal releases timer and visibility listener. Real browser idle trace should compare 1/5/20 activity pages, pointer-free, with operation counts and process CPU boundaries separately.

### UI-PERF-04 — P2: shared rail scroll path bypasses its existing frame coalescer

References: `src/lib/ui/shelves/layout.svelte.ts:36-54,67-80`; `src/lib/ui/components/Shelf.svelte:269-270`; chart gallery reuses this same layout at `src/routes/ui-preview/charts/ChartGallery.svelte:43,181`.

Resize/mutation notifications use an animation-frame coalescer, but `reachedEnd()` calls `measure()` synchronously on every scroll event. Thus the most frequent geometry path bypasses the stated observer/coalescing method. Actual compiled-module probe, 100 `reachedEnd()` calls before a frame: **300 geometry property reads, zero frames scheduled** (poster rail, no more pages). There is no evidence that those reads always force layout, so do not call this measured layout thrashing or claim an FPS gain.

Smallest fix: route scrolling through the existing per-layout scheduled measurement, combine end detection with that measurement, cancel scheduled work on teardown, and retain immediate explicit button behavior if needed. Do not add another per-card/global observer or debounce demand loading so heavily that the rail misses its end.

Acceptance: a scroll burst schedules at most one measurement/end evaluation per frame; a busy append cannot start parallel pages; after completion the next end-trigger behaves normally; no frame publishes after disposal; reduced motion, resetKey, previous/next button states and saved panel height remain unchanged. Validate real horizontal wheel/touch scrolling and chart browse controls in the browser.

## Lower-confidence items and browser evidence gaps (do not silently implement speculative changes)

- `Dialog.svelte:28-52` directly measures and writes on every captured scroll event while a popover is open, including scroll inside the popover. Its anchor stays fixed during internal content scrolling. Consider reusing frame coalescing and ignoring irrelevant descendant scrolls, but first obtain a real open-panel scroll trace. No runtime-cost measurement was made; this is not a separate proven bottleneck.
- DynamicFeed correctly uses one `limit=1` definition, waits for its Shelf's `onsettled`, mounts a new zero-margin sentinel only after that row settles, and appends to prior rows. Revision refresh intentionally retains existing rows and resets definition offset, potentially revisiting old definitions; quantify before changing refresh semantics. Need browser acceptance for slow/error/hidden-empty rows, one outstanding row and scroll-position stability.
- Repeat `lazyContent` activation depends on an IntersectionObserver crossing. A sentinel remaining visible while `enabled` flips false→true does not receive a new notification automatically. Normal appended rows move the sentinel; sparse/empty returned pages may need a keyed rearm or explicit button. Existing explicit Load more remains usable. Root should reproduce a genuinely affected source with sparse cursor results before altering shared observer semantics.
- Retained DOM grows with intentionally infinite activity and dynamic rows. Lazy images do not window DOM. No retained-heap slope or layout trace supports introducing windowing; preserve focus/restoration and the approved UX, and measure first. This was explicitly unresolved in the October 3 audit.
- Material behavior was reverted previously and user approved that rollback. Do not make material/rendering changes as a speculative performance fix.
- Playback/reader source release, decoding and root party polling are cross-boundary items for the dedicated next wave, not independently audited here.

## Positive findings / patterns to preserve

- `createResource` aborts superseded work and fences results even if transports ignore abort; focused tests pass.
- Social enrichment remembers empty IDs, does bounded 60-ID batches at max 2 concurrent and fences stale completion; append count is linear; focused tests pass.
- Single shared lazy-image observer, independent rail queues, fallback queue reacquisition and grid independence remain intact apart from exit handling above.
- Discovery has bounded (20-selection) caches and proper revision/feature-withdrawal cancellation tests. Keep it as the reference, not a new abstraction.
- Journal finite-range Set logic/unlimited bypass and gesture idle-listener removal survive; tests pass.
- Chart gallery lazily loads, keeps static thumbnails and one live renderer, bounded 24-row exact data, model-derived geometry and finite fixture cache. No confirmed chart-specific performance regression; chart tests cover bounded geometry and stable cached rows. Gallery rail benefits globally from UI-PERF-04.
- Root conditionally mounts Friends/Notifications/Streams panels while open, so their polling/resources are destroyed on close. Do not falsely report permanently mounted hidden panel polling. Reader/modal module imports remain demand-driven.
- Search intentionally retains unified local-first finite results and local row segments; global busy does not hide nonempty partial rows. Do not redesign it back into separate medium routes or pagination.

## Documentation criteria to add

1. Require a workload state matrix: never activated, visible, offscreen, document-hidden, changed context, disposed; validate count invariants separately from timing.
2. Each local memoization owner must state its key, bounded size/lifetime, viewer/permission scope, revision sources and explicit retry behavior; equivalent objects are not change identity.
3. Queue admission must re-check current demand when waiting work starts. Intersected-once is not equivalent to still-needed, while already-active work has separate cancellation semantics.
4. Timers must declare precision, visible/hidden policy and final-consumer teardown; static displays must not subscribe to second precision by default.
5. Geometry scheduling must include scroll, resize and mutation paths, with one per-owner frame budget and teardown assertions. Count reads before claiming forced-layout savings.
6. For each claimed optimization record full result equivalence and request/operation counts, warm-up/raw timing samples, scale, host/runtime/commit, and browser-vs-pure-JS measurement boundary.
7. Keep fixed-size first-load, repeated append, same-data session refresh, relevant revision, superseded request and teardown as mandatory focused regressions. Browser evidence remains required for rendering/paint/scroll claims.
