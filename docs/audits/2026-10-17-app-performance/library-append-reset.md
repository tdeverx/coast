# Library append observation: retained prefix disappears during browsing

**An actual normal-browser Watch dialog grew through 60, 120, 180 and 300 cards, then showed 180 cards with the prior prefix no longer retained.** The 300-card sample was unique and retained the earlier prefix. The next Load more click timed out; no later successful click was recorded. No new warning/error or alert accompanied the reduction. This is **LIBRARY-APPEND-OBS-09**, outside the original 94 findings, overlapping the retained-card lifecycle concern **UIS-03**. No implementation or root-cause attribution is claimed.

The [corrected aggregate receipt](evidence/library-append-reset-normal.json), [exact retained original](evidence/library-append-reset-normal-original.json), [machine report/source pins](library-append-reset.json) and screenshots preserve this trial. The original stop reason incorrectly mentioned detached/offscreen action failures. Only that field is corrected: the recorded failures here are a **Loading selector-wait deadline** and the **next Load more click deadline**. A detached Back action from a different section trial is unrelated and must not be folded into this one.

## What was observed

The trial used the existing signed-in normal development browser at localhost:5173, Library → View all Watch, actual retained catalogue data and ordinary controls. It started at 03:45:52.788 UTC and ended at 03:49:55.287 UTC on 2026-10-18. Audit production writes were frozen. Root subsequently confirmed the source manifest unchanged at approximately 03:50 UTC; the 16 source owners pinned here also match that same retained [section-demand manifest](evidence/implementation-20261018-section-demand-source-inventory.json). This publication changes only owned audit artifacts.

| Recorded sample UTC | Watch-dialog cards | Dialog DOM nodes | Prefix/identity observation |
| --- | ---: | ---: | --- |
|03:46:36.738|60|1,420|Initial sample|
|03:46:45.035|120|2,949|Append observed|
|03:47:12.960|180|4,436|Prior prefix retained; 180 unique hrefs|
|03:47:27.606|300|7,358|Prior prefix retained; 300 unique hrefs|
|03:48:15.662|180|4,454|Prior prefix no longer retained; not loading; no alert|

**No separate 240-card sample exists.** Automatic lazy-end loading can admit pages between actions, so these samples do not prove one transport request per click or five separately observed page fetches. The Loading wait exceeded its selector deadline before the settled 300-card capture. The next Load more click later timed out; a fresh DOM census then found the reduced 180-card state. The receipt has no request chronology, API response list, revision signatures or refresh-commit trace.

The [historically named five-pages screenshot (private verification image)](publication.md#private-verification-images) is the **300-card state before the unsuccessful next action**. Its filename is preserved; it does not establish isolated five-request behavior. [Reset-observed screenshot (private verification image)](publication.md#private-verification-images). Images completed at the sampled moments are partial counts, not proof that every poster decoded or that network loading settled.

Closing the Watch dialog removed all of its card DOM: **zero dialogs**, with **110 background document cards** remaining. The final [Tasks screenshot (private verification image)](publication.md#private-verification-images) and receipt show **30 task rows**, automatic jobs paused, zero dialogs/popovers and zero new warnings/errors. Ordinary session, presence, freshness or enrichment activity was not disabled or transport-instrumented. No job/status/preference/media/list mutation command was submitted, no state/network was injected, and no fabricated catalogue was used.

These are functional card/DOM observations. They are **not** CPU, JavaScript heap, process memory, GPU, decoded-image memory, request latency or allocation measurements. A 20-page browse proof was deliberately not completed; the observed reduction is not evidence of a bounded retention policy or resource plateau.

## Source-confirmed possible reset mechanism

The independent diagnosis was source-only: no additional browser, DB, provider, test or application mutation. It identifies a real existing replacement path, **not the causal trace of this particular reduction**:

1. [Root layout](../../../src/routes/+layout.svelte) lines111–121 starts a visible signed-in session refresh every 60 seconds. [refreshRouteDependencies](../../../src/lib/ui/client.ts) lines109–114 uses `refreshAll()` while the media overlay is open, preserving its shallow page state. The [server layout](../../../src/routes/+layout.server.ts) recomputes content revisions.
2. [Library source](../../../src/lib/ui/shelves/library.svelte.ts) lines102–105 subscribes to **tracking and social** content-revision primitives. Lines109–130 treat a changed revision as a refresh; an activated grid calls `load(content.page)` with its default **append=false**.
3. `load` lines76 and95–98 consequently replaces the entire accumulated item array with just the current response page. It leaves that response's page number as the pagination position. Embedded mode at100 only suppresses URL replacement; it does not preserve previously admitted pages.
4. [Shared resource](../../../src/lib/ui/resource.svelte.ts) lines31–43 cancels an outstanding read, permits only the latest controller to publish and merges the new data. This protects against stale publication, but an authorized background replacement can still intentionally remove the old prefix without producing an error.
5. [Shelf footer](../../../src/lib/ui/components/Shelf.svelte) lines306–308 is a repeated lazy sentinel. Its callback at154 invokes `adapter.load(page+1,true)` independently of the button. [lazyContent](../../../src/lib/ui/lazy-content.ts) lines13–15 activates on intersection with a 300px margin. A shorter replacement can move the sentinel into view and admit subsequent appends without another successful click.

Therefore a single-page background replacement followed by automatic appends is **compatible** with a later 180-card state. The exact intermediate page, trigger, response order and automatic admissions are unknown. A replacement normally first leaves one response page; the report does not pretend that replacement alone directly explains the final count. The timed-out click is not evidence that its transport executed or that the backend was slow.

There are legitimate ways for revisions to change even while automatic jobs are paused. [Content revision](../../../src/lib/server/content-revision.server.ts) lines19–29 includes durable own/global revisions, collection freshness, peer status fingerprints and expiring active check-in/live counts. [Collection freshness](../../../src/lib/collection/freshness.server.ts) has time-based cutoff booleans and an expired predecessor; [friend status](../../../src/lib/social/status.server.ts) includes 90-second heartbeat and five-minute activity boundaries. Their actual values were not captured during this incident. No particular expiry or writer is blamed.

## Other reset paths and healthy ownership

The source distinguishes these cases:

- Pure append at library lines95–98 uses `uniqueItems([...previous.items,...result.items])`. It preserves existing distinct keys; ordinary deduplication of a later page does not explain removal of an existing unique prefix.
- The library's owner-change branch at123–125 explicitly clears data on viewer/username/surface ownership change. Filter controls explicitly call a replacement load. Neither change was recorded in this trial.
- The grid initial-payload branch at127–129 directly replaces data when fresh SSR initial items arrive. That matters to full Library pages. The embedded [SectionDetails](../../../src/lib/ui/pages/SectionDetails.svelte) passes a source without an initial payload, so it is not the normal direct trigger for this particular View all overlay.
- [DetailPanel](../../../src/lib/media/DetailPanel.svelte) retains the section component under the same href/kind key at75; Shelf constructs its adapter once at97. Recreating an equivalent [section target](../../../src/lib/ui/section-target.ts) object does not by itself recreate that adapter. Its primitive refresh keys suppress a session-data replacement with unchanged revision/selection. Losing the href/viewer or changing the keyed destination is a separate disposal path, not demonstrated here.
- The grid renders its item list without a virtualized card window. Closing the dialog disposes its resources and observers; the observed DOM removal is positive cleanup evidence, not a JavaScript/GPU leak proof.

The minimal causal check for a later approved trial is to record **read-only revision primitives, exact requested page/mode, request start/abort/settle and published page/item-prefix counts** around the reset. Source-derived runtime controls should hold an append pending while a revision changes, verify the current cancellation/replacement behavior, and separately protect unchanged-session/equivalent-target ownership. These checks have **not** been run for this observation.

## Reviewable behavior options

All options belong at the existing shared Shelf/paged-source lifecycle and must preserve occurrence identity, viewer/filter isolation, cancellation and disposal. `createLibrarySource` is shared by Watch, Listen, Play and Read, collection/self/profile variants, rows and full/embedded grids. A per-Watch shim or silently disabling revisions would leave the shared contract unresolved. The alternatives below intentionally do **not** select a user experience or resource budget.

| Option | Concrete behavior | Cost and acceptance boundary |
| --- | --- | --- |
| **A. Minimal consistent reset** | Treat background refresh as an explicit atomic reset to page1: replace with the fresh first page, set pagination/range to1 and settle the containing view's scroll/focus anchor consistently. Keep explicit filter/owner resets distinct. | One ordinary page request; drops admitted history and may interrupt browsing. Needs a decided reset/anchor policy and actual no-surprise navigation/focus tests. Do not retain page5 metadata while silently showing only page5 as though pages1–4 remain. |
| **B. Preserve and refresh the admitted range** | Track admitted page/occurrence range separately from the latest page; refresh all admitted pages under one resource generation, publish the rebuilt ordered range atomically and restore the visible occurrence anchor. Reject stale filter/viewer generations. | A five-page range can require five current page reads or an explicitly designed shared range request; cost grows with admitted range. Multi-request consistency, reorder/deletion, totals, partial failure and privacy/403 behavior require concrete contracts. No fan-out or deadline budget is chosen here. |
| **C. Bounded shared retained window** | Retain a decided window with first/last page or cursor metadata, backward/forward rehydration and occurrence anchors. Share admission and eviction across relevant adapters; virtualize card owners only if actual measurements justify it. | More substantial work and a visible back-scroll/reload policy. Page/card/byte bounds must come from a resource/UX decision, not an arbitrary number. Needs actual long browse, focus/menu/episode anchors, cancellation, stable order and DOM/decoded-resource measurements. |

For every selected option, meaningful verification includes actual ordered-prefix/range checks across refreshes; initial/no-op session replacement; pending append supersession; explicit filter and owner changes; expiry-driven refresh; automatic sentinel versus manual button; failure/retry/403; close/reopen; and Watch/Listen/Play/Read collection/profile consumers with available actual cohorts. A shared-window solution additionally needs the missing long-range and resource evidence. No option is implemented by this report, no new dependency/schema policy is proposed, and no existing canonical finding is closed.

## Later source-only range review

The [current source review](evidence/library-append-current-source-review.md) confirms that a revision-driven `load(currentPage, false)` replaces accumulated Library items with a single page, while the shared resource correctly fences stale requests. Shelf can subsequently admit more pages automatically. This is compatible with the observed 300-to-180 reset; no request/revision/commit trace establishes that sequence as its cause. The review maps Library media/profile/row/embedded consumers and similar numbered/cursor adapters, and proposes atomic revalidation of the admitted range while retaining explicit filter/owner/privacy resets. That option has an O(range) read cost and requires actual deep-start, ordering, deletion, partial-provider and in-flight append checks before adoption. No UI/source repair or new runtime measurement is claimed.

## Later actual causal trace

The [new signed-in aggregate trace](library-append-trace.md) captures an actual same-owner revision refresh replacing 180 admitted cards with the latest page's 60, then an automatic sentinel append to 120. A second refresh repeats the reduction. The original 300→180 incident remains uninstrumented. The rejected broad-link DOM sample, corrected card measurement, exact temporary-patch restoration and fresh normal Tasks acceptance are preserved. No Library repair or retention policy is adopted yet.
