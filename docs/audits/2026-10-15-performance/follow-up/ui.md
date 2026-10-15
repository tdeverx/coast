# Independent follow-up: shared UI criteria consistency

2026-10-15; Coast working tree based on `ea01908654db7c0b4cf591028c7f9b321c6896dd`; Bun 1.4.3 ARM64 macOS. Read `docs/performance.md`, audit README/ledger and original shared UI report. This independent phase inspected shared UI beyond changed files. No production edits, real providers, credentials, database, services, browser, build or full checks were used during discovery. Coordinator later authorized implementing the concrete fixes below.

## Reproduction and evidence boundary

Actual production Svelte module/component scripts were compiled with the installed Svelte compiler; transports/DOM lifecycle/geometry were controlled synthetic boundaries. Scripts execute actual load/refresh/effects, rather than source-string assertions or reimplemented algorithms. `/private/tmp/coast-criteria-ui-followup-probes.ts` and `.json` preserve evidence. Run from repository:

```
.tools/bun-1.4.3/bun-darwin-aarch64/bun /private/tmp/coast-criteria-ui-followup-probes.ts
```

Focused current tests: 37 pass, 0 fail, 340 assertions across 13 files, 182 ms: resource, source freshness, lazy images, clock, rail layout, hero geometry, social enrichment, discovery, progress privacy, search, dynamic-feed client, context gesture and journal visible. These establish operation/lifecycle behavior, not browser paint, actual network bytes, provider CPU, retained heap or production latency. Exact measurements below are operation counts, not host-sensitive time thresholds.

## Confirmed findings

### UIF-01 — P2, high confidence: post-mutation continuation starts work after the resource's component was destroyed

Shared owner: `src/lib/ui/resource.svelte.ts:10-14,21-60`; concrete consumers `components/StreamsPanel.svelte:21-29`, `components/NotificationInbox.svelte:63-78`. Related same pattern: `components/FriendsPanel.svelte` act continuation and `mutation.svelte.ts` refresh callback consumers. Dedupe as a shared resource lifetime gap, not a separate finding per panel.

Trigger: open Streams, hold its `refresh` POST; close/unmount (effect cleanup and `onDestroy(resource.cancel)` run); resolve POST. `refresh()` then calls `load()`, which allocates a new request/controller after disposal. Notification read/dismiss/mark-all similarly await `change()` then load. `cancel()` only aborts the controller existing at the moment it is called, so it cannot fence this future request.

Measured: actual Streams script, three independent open/action/close cycles => each emits **one fresh GET after destruction**, signal `aborted=false`, old resource busy `true`. Actual Notification read action => one fresh `notifications?...` GET after destruction, `aborted=false`, old resource busy `true`. With synthetic never-resolving responses, retained pending work scales one per closed action cycle; this is an admission/lifecycle bound demonstration, not a browser heap-leak claim. Existing test called `cancel` “component disposal” but tested only an already-pending request, missing late admission.

Smallest shared repair: add terminal `resource.dispose()` distinct from reusable `cancel()`. Dispose aborts current work and makes later loads/replacements no-ops; replace component owner `onDestroy(resource.cancel)` with dispose. Keep cancel for context changes, selection/poll switches and explicit current-request abort. This lets intentional writes finish without requiring a second scheduler or aborting an already accepted mutation, while preventing useless follow-up reads. Tests must hold a mutation across destruction, execute its continuation and prove **zero post-disposal fetch calls**, plus no late data/error/busy publication; cancel/retry/replace must remain reusable.

### UIF-02 — P2, high confidence: shared media detail rows start unused sources for dedicated sections

Owner: `src/lib/ui/components/MediaDetailRows.svelte:74-95`; render consumers `:123-143,147-199,201-230`. Root media `Details.svelte:134` keys the component by media ID + section, so ordinary item/section route replacement already remounts it; do not claim an ordinary stale-item regression without that context. Modal/preview/direct component consumers should still have explicit identity handling.

Trigger/counts from actual component load callback in four contexts:

| Dedicated context | Actual first-page requests | Needed sources |
| --- | --- | --- |
| Credits/cast | TMDB + Trakt | TMDB for shared crew selection; Trakt unused |
| Insights/activity | TMDB + Trakt | Neither; MediaActivity owns statistics |
| Insights/overview | TMDB + Trakt | TMDB facts; Trakt unused |
| Reviews/source=tmdb | TMDB + Trakt | TMDB only |

Each dedicated open admits one or two unnecessary API calls and up to those providers' cache fills. `catalogue/details.server.ts` shows database identity reads before source cache and provider lookups on cache miss, but no database/provider cost was measured; do not multiply this into a latency claim. On the overview route, Reviews and Credits are present and must retain demand when their own rows enter the existing 300px Shelf margin; simply deleting Trakt globally would lose reviews/community. TMDB crew is a required Credits consumer even when current cast was hydrated server-side.

Smallest repair: retain one resource per source in this component, activate each row/selected panel by existing lazyContent/Shelf policy, derive the union of currently needed sources, fetch only newly needed unsettled sources, and cancel pending optional sources when demand leaves through section/selection/context changes. Resource results may remain cached for this component lifetime. Add item+viewer identity reset with pending cancellation/stale publication fence. Tests cover section/selection/source matrix, own offscreen activation, crew availability, no duplicate fetch for shared consumers, source changes/retry/append and replacement/disposal.

### UIF-03 — P2, high confidence operation defect; browser impact unmeasured: Dialog popover scroll bypasses geometry frame budget

Owner: `src/lib/ui/components/Dialog.svelte:28-53`; shared by Friends/Notifications/Streams popovers. Actual component placement callback/effect run with fixed anchor bounds. 100 captured scroll events (including simulated internal content scroll) => **200 getBoundingClientRect reads + 200 CSS writes, zero scheduled animation frames**. Count includes one anchor and one popover read/event. The initial placement remains necessary; unchanged anchor/content scroll repeats the same coordinates.

Smallest repair: retain synchronous initial open placement, schedule scroll/resize placement through one per-owner RAF, cancel and fence scheduled work on close/disposal. Optionally ignore descendant scroll after verifying anchor semantics; not required for the small repair. Test scroll+resize burst <= one placement/frame, no scheduled callback after close/disposal, normal unanchored/clamped/mobile placement. Do not claim forced layout, FPS, or visible smoothness improvement from pure operation counts. Coordinator browser check remains necessary.

### UIF-04 — P2, high confidence cancellation omission: hero trailer request outlives optional owner

Owner: `src/lib/ui/heroes/presentation.svelte.ts:128-147,168-179`. Actual compiled module starts one delayed `media/{id}/trailer` API lookup. Destroy owner before response: its timer/observer/listeners are cleaned, and late publication count is correctly **zero**, but API options contain **no AbortSignal** so the owned request cannot be canceled. This is cancellation missing rather than stale result display. One unresolved request per activated/replaced hero is possible; real provider cancellation/cost not measured.

Smallest repair: effect-owned AbortController passed through existing API options, abort on effect cleanup; retain cancellation/publication fences and existing reduced-motion/visibility behavior. Test teardown and replacement abort immediately, transport ignoring abort cannot publish, retry/new owner still works; no new fetch wrapper.

### Residual PERF-04 consumer — P3, high confidence consistency gap, no large CPU claim

`components/StreamsPanel.svelte:16,40` invokes unconditional default second clock; its only clock read is relative `activityDateLabel` in History. Now view has no clock-dependent output. History can append bounded pages, retaining labels that need only minute precision. Reuse shared minute clock enabled only for History. FriendsPanel/PartyMenu/SyncedControls genuinely display second-sensitive timelines/drift and must retain seconds. Existing formatter reuse already reduces old-date formatting cost; do not reuse the old baseline cost as a fresh measurement for this consumer.

## Checked coverage and nonissues

- Shared resource correctly fences already-started canceled/superseded requests, including ignored abort and stale failures; the issue is future admission after terminal destruction.
- Library/Credits primitive identity/revisions, retry bypass and viewer replacement regressions pass; no regression to original PERF-01 demonstrated.
- Lazy image queue now keeps waiting images observed and removes exits, deduplicates reentry, retains in-flight fallback slot and releases on failure/destroy. Actual tests pass; no new image ownership defect established.
- Rail and hero shared geometry changes pass coalescing/disposal checks. Dialog is an additional common owner still outside that contract.
- Clock shared seconds/minutes visibility/last-consumer cleanup and locale formatter bounds pass. Streams is the residual consumer above, not a defect in the new shared clock itself.
- Social enrichment max two 60-ID batches, empty-result memoization, append/replacement/scope fences pass.
- Discovery finite cache/revision, withdrawn medium cancellation and lazy activation checks pass. Progress denied-profile/stale failure checks pass.
- Search retains finite shared local-first shelves, stable medium/availability partitions and streaming partial results; no second renderer or private queue introduced. Server search route starts unified enabled medium promises by current product contract; no proven excessive per-card import cost here.
- Root only mounts Friends/Notifications/Streams while open and lazy-imports them, readers and media modal. Do not claim closed panels poll permanently. The confirmed continuation finding is distinct from the correct conditional mount/poll teardown.
- Lists uses keyed route data for reconstruction; source lack of its own revision effect alone is not proof of stale data. Broad key sensitivity to session refresh merits a browser demand/request count probe before changing it.
- Menu positioning already coalesces scroll/resize and removes last outside listeners. Sliding-pill observer/listener cleanup is present. No material/rendering redesign is warranted.
- Infinite feed/journal retained DOM and lazContent repeat sentinel visibility rearm remain acceptance questions without current retained heap/browser sparse-cursor reproduction. Do not add virtualization or change paging on this evidence.
- Native codec/autoplay/long-play, reader peak archive memory and live chart input bounds are outside this review; existing ledger's gaps remain honestly separate.

## Required final acceptance

After the repairs, rerun the same controlled operation probes and focused regressions; coordinator owns type/inventory/build/full-test/database/browser gates. Browser must cover anchored panels desktop/mobile scroll and close/reopen, media details overview/dedicated source/crew/activity selection and rapid hero navigation with delayed lookup. No dependency, compatibility shim, UI/material redesign or external action is needed for these repairs.

## Implemented follow-up and focused verification

Coordinator authorized implementing these findings after independent reproduction. The discovery probe now reads preserved pre-follow-up production snapshots under `/private/tmp/coast-criteria-ui-baseline/`, so it continues to reproduce baseline counts after edits. Hero snapshot retains the earlier geometry work and reverses only this follow-up's controller/signal additions. Other snapshots are the unchanged-at-discovery HEAD modules. Its output remains `/private/tmp/coast-criteria-ui-followup-probes.json`.

Result against the same controlled operation contracts:

| Contract | Before | After / regression |
| --- | --- | --- |
| Pending mutation finishes after Streams/Notification destruction | One fresh nonaborted GET per cycle | Zero; 3 cycles each for Streams, notification read and mark-all |
| Resource disposed with current request and future callbacks | Current request canceled; future load admitted | Current aborted; future load, replace and error writes ignored; reusable cancel still permits retry/replace |
| Dedicated credits | TMDB + Trakt | TMDB only, crew selection still returns hydrated TMDB crew |
| Dedicated activity insight | TMDB + Trakt | Neither; selected MediaActivity still owns statistics |
| Dedicated overview / TMDB reviews | TMDB + Trakt | TMDB only |
| Overview demand | One outer activation starts both | Independent existing Shelf activation; resources shared per source, no duplicate TMDB across Insights/Credits |
| Demand/context replacement | Outer request publication guard only | Unneeded pending source aborted; item/viewer changes dispose old source owners, clear prior values and admit only already-activated needed rows; explicit retry/append preserved |
| Dialog 100 captured scrolls | 200 geometry reads + 200 writes | Zero before frame, one placement in frame = 2 reads + 2 writes; resize shares the frame |
| Dialog closed/disposed scheduled callback | No frame scheduling existed | Pending frame canceled and forced stale callbacks publish nothing; initial/unanchored/mobile-clamped position retained |
| Hero request after title replacement/destruction | No AbortSignal; late publication already fenced | Signal aborts immediately; transport ignoring abort still cannot publish; replacement starts a fresh request |
| Streams relative labels | Default unconditional second clock | Minute precision, enabled only while open History is selected |

Focused validation: **48 pass, 0 fail, 458 assertions across 18 files, 245 ms** with Bun 1.4.3. Includes original 13 UI files, benchmark polling, new panel lifecycle/media demand/Dialog geometry/hero lifecycle files. Direct installed Svelte compiler also compiled Dialog, MediaDetailRows, Shelf and StreamsPanel client components with **zero warnings each**. No full check/build/inventory/database/browser/service was run; coordinator retains those gates.

Production files changed by this follow-up (includes teardown-only substitutions in preexisting modified files; unrelated edits preserved):

- `src/lib/ui/resource.svelte.ts`
- `src/lib/ui/components/{Shelf,MediaDetailRows,Dialog,StreamsPanel,FriendsPanel,MediaActivity,NotificationInbox,ReactionActions,SyncedControls}.svelte`
- `src/lib/ui/shelves/{credits,discovery,for-you,journal,library,list,progress,social}.svelte.ts`
- `src/lib/ui/friends.svelte.ts`, `src/lib/ui/controls/work.svelte.ts`, `src/lib/ui/heroes/presentation.svelte.ts`
- `src/lib/reading/Details.svelte`, `src/lib/recommendations/DynamicFeed.svelte`, `src/lib/benchmarks/BenchmarkSettings.svelte`

Tests: modified `tests/ui-resource.test.ts`; added `tests/ui-panel-lifecycle.test.ts`, `tests/media-detail-demand.test.ts`, `tests/dialog-geometry.test.ts`, `tests/hero-lifecycle.test.ts`, shared actual-script compilation helper `tests/fixtures/ui-script.ts`. No production dependency, shim, material styling or visual layout change. Shelf exposes one activation callback using its existing observer rather than adding another observer/queue. Resource owner teardown uses terminal dispose; selection/context cancellation remains reusable cancel. Benchmark page-generation fencing and queue-controller abort remain intact.
