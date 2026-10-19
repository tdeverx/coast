# Bounded Library/Collection and shared card ownership — implementation batch 04

**Applied, with scoped actual-data acceptance. The wider known-findings pass remains active.** The delegated “whateveristhebest” Library choice is implemented as a three-native-page neighborhood at the shared readers, Library source and Shelf owners. Tasks keeps its current query/index pair under the explicit user choice. No production dependency, migration, new scheduler, commit, push or deployment was introduced in this batch.

The current register has 94 canonical records: 67 have some applied source; 29 statuses begin “implemented”, 36 begin “partial”, 24 are “open”, and five retain other investigation statuses. These categories are not completion percentages. In particular, UIS-03 is now partial, rather than wholly open: Library/Collection is repaired, while other source and resource contracts remain unresolved. Use the [active queue](implementation-queue.md), [full ledger](implementation-ledger.md), [open-work disposition](remaining-work-disposition.md) and [separate unchecked-area roadmap](follow-up-roadmap.md).

## Problem and resulting behavior

The old source accumulated cards without a retention bound and replaced the accumulated range with one page on revision refresh. A correct repair must preserve browsing, freshness and action ownership together. Preserving every loaded card would retain the growing data/DOM cost; silently clipping an array could discard focused controls, drafts and pending writes.

Library and Collection now retain at most three native pages. Forward travel evicts the far previous page; reverse travel can reload it. The shared geometry owner preserves a surviving visible card. Child-detail Back stores the committed bounded URL plus primitive anchor/focus information, then reloads and restores that neighborhood. Normal numbered navigation, previews, public summaries, complete detail/sequence arrays and other source contracts retain their own behavior.

Same-scope refresh uses one bounded range request and publishes the complete result atomically. A retryable or partial failure keeps the previous complete range. Current forbidden/not-found responses, viewer withdrawal and effective feature withdrawal clear private content. Primitive request/owner/filter/revision fences reject stale publication before reactive cleanup. A clamped append rebuilds the bounded neighborhood instead of keeping a stale tail.

Generic MediaCard, menu, Dialog and operation/mutation owners acquire shared retention leases for focus, open UI and in-flight actions. Nested owners retain their containing card. A proposed eviction that would remove a leased card is declined and reported; it does not grow a set of pinned pages. Retry waits until all affected owners release. A source-owned retry preserves the range or blocked append and does not cancel an already-owned retry. Withdrawal retires old leases; late releases cannot affect a replacement scope. A same-scope server-rendered refresh retains existing leases and reuses an admissible fresh result without another read.

## Shared implementation

| Owner | Contract |
| --- | --- |
| `src/lib/page-window.ts` | Three-page validation, exact native boundaries, bounded merge, ordered domain identities and independent/retired action leases. It has no request, renderer or global cache ownership. |
| `src/lib/server/queries/pagination.ts` | One explicit positive/ordered/max-three interval validator; ordinary numbered requests stay ordinary. |
| Watch, Reading, Games and Collection readers | Reuse eligibility/count/raw selection across a bounded range. Hydrate/rank each original native page, retaining privacy, availability, count and identity rules. Collection’s public summaries remain single-page. |
| `src/lib/server/queries/music.ts` | Preserve fifty items per source, page-major/source order and existing observation/generation checks. Check current policy and source membership even after a provider failure. No database transaction spans remote waits. |
| `src/lib/ui/shelves/library.svelte.ts` | One Resource owns cancellation/publication. Bounded append/prepend, range refresh, clamp recovery, engagement backpressure, scope retirement and source-owned retry benefit every Library medium and Collection. |
| Shared Shelf/layout/history | Preserve a visible anchor across DOM changes, coalesce geometry, recover eligible automatic grids after pending reads, retain previous-page access and recover Back/focus. |
| `src/lib/ui/retention.ts`, MediaCard, menus, Dialog, operations/mutations | One composable retention port, captured during initialization. Component operation callers use the same port; route-only consumers receive an idle owner. |
| Dialog / shelf position | `data-shelf-scroll` declares the content owner even while overflow is temporarily hidden. The existing ResizeObserver compensates the sheet’s final expanded width. User input cancels pending restoration ownership. |

New behavior is documented in [the performance methods guide](../../performance.md#bounded-catalogue-neighborhoods-and-retained-action-owners). No separate per-route loader, mutation queue, virtual-scroll dependency, browser card cache or height cache was added.

## Actual data and work reduction

The [range receipt](evidence/implementation-found-range-actual.json) compares 32 complete ordered range DTOs with the original native readers across four existing accounts. It covers Watch, Read, Play and Collection categories, positive/empty/sparse pages, middle/end/far-clamped Watch and Progress. Ordinary one-page DTOs also match. Eligibility/count and all native hydration/ranking boundaries are retained.

| Actual workload | Canonical serial native pages | One bounded range | Limit of this evidence |
| --- | ---: | ---: | --- |
| Watch, first three pages | 51 ORM statements | 49 | Primary eligibility/count statements fall 3→1; native hydration remains. |
| Play, first three pages | 12 | 8 | Count/raw selection shared; ranking/presentation stay per native page. |
| Positive three-page screen Collection | 66 | 62 | Assessment/source reads shared; native card batches remain. |
| Positive three-page game Collection | 18 | 14 | Same complete assessments/cards and ordered identities. |
| Read, actual twelve-comic catalogue | 5 | 5 | One natural page, so no multi-page work reduction is established. |

Actual Watch has 2,680 titles/45 pages; Play has 1,218 titles. Collection includes positive screen, game, reading and music contexts, plus genuine empty contexts. Books and a multi-page Reading catalogue are absent. The count/selection comparisons run inside one verified read-only repeatable-read clone frame. Collection uses its real CTE and complete card functions with the parent verified transaction in place of its nested wrapper. This is not proof of every live READ COMMITTED membership/policy race.

The same receipt exercises 38 forward/reverse/refresh buffer schedules using actual native card DTOs through twenty pages, with exact ordered-card and interval checks. The held-card eviction control uses an actual card identity. It is not a browser or heap measurement.

The [current compiled-owner receipt](evidence/implementation-found-window-controls-actual.json) runs six schedules using 34 actual domain reads: complete range refresh/failure/retry; independent retained owners; filter/denial fencing; viewer withdrawal/reauthentication and stale-owner retirement; disposal; and server-rendered reuse preserving an existing card lease. Every supplied response comes from the actual canonical reader. Delivery, failures, revisions and withdrawal ordering are authored controls; no catalogue rows, identities or provider responses are fabricated. Partial owner release admits no refetch, and a toast retry cannot cancel the already-owned retry.

The [normal Music receipt](evidence/implementation-found-range-music-normal.json) compares complete JSON responses from the signed-in normal server with native provider pages: first-three albums returns 150 cards, and a far-clamped range returns 62 with boundaries 50/12, from the actual 162-album catalogue. Both comparisons were repeated after the final Music fence repair. These normal Music GETs retain their existing metadata/access observation writes; they are not a read-only normal-database test. JSON comparison removes browser IPC object prototypes while retaining every JSON field/value and array order.

The [Music failure/fence controls](evidence/implementation-found-music-fence-actual.json) use credential-free native source projections from two actual subjects. The exact historical pre-fence source returns 502 without checking final policy. Current source checks policy/source membership first: transient failure remains 502; controlled policy or source-view withdrawal becomes 403. Every remote attempt is an authored rejection; no remote response or source identity is invented, decrypted or fetched. Delivering another actual subject’s census is a controlled schedule, not an observed same-account transition.

All clone probes verify the exact target/runtime/session/policy functions, deny provider transport, pin source and inputs, hold the exclusive clone lease and roll back/release/close. Credentials remain in memory. No normal database migration or deliberate domain mutation was used for these proofs.

## Signed-in browser acceptance

The [browser receipt](evidence/implementation-found-window-normal.json) records actual normal development at `localhost:5173`:

- Watch traversed twenty native pages at 1075×954. Retained cards rose 60→120→180 and stayed at 180. At pages 4–20 the measured Shelf subtree stayed between 4,253 and 4,279 DOM nodes; the earlier peak was 4,386. This is a DOM/data plateau, not a process memory budget.
- At 1280×720, keyboard title activation and child Back restored the committed range, exact saved anchor, scroll position and focused title with zero measured drift, retaining 180 cards. Reverse loading stayed at 180 cards.
- An actual card menu opened and closed. Its retained focused card then blocked page eviction and showed a reachable notice. Moving focus to Retry advanced to pages 2–4 with 180 cards and no notice; the window was not replaced by one page. Scrolling under a still-open popover did not move content in the control surface, so native eviction while that menu stays open is not claimed.
- Final direct server-rendered `/library` range 2–4 rendered 180 actual cards/4,139 subtree nodes at 1280×720, with meaningful content, no framework overlay and no warnings/errors.

Two restoration defects were caught before acceptance: temporary hidden overflow selected the outer 160-pixel expansion track, and compact-width geometry became stale after expansion. Explicit content ownership plus the existing resize/frame budget repaired both. Locator clicks can scroll a target before activation; the exact final position check used keyboard activation from the recorded position. Some browser wait deadlines expired just before successful responses and are not recorded as failed API calls.

**Test side effect:** an early artwork-link click hit the overlaid Play control for House of Gucci. The player reached the observed 22-second position, then was paused and closed. No prior progress baseline was captured; a normal session/bookmark may remain. It was not used as successful mutation/performance evidence and was not blindly reverted.

## Gates, tradeoffs and limits

The final [common gates](evidence/implementation-found-05-gates.json) pass: **837 unit tests, 715 guarded skips, zero failures, 34,187 assertions**; type/Svelte checks, build/navigation drift check, code/UI inventories and style checks pass. Guarded skips and symbolic geometry/ownership controls are not actual-data coverage. The actual-data fixtures remain maintained source under `tests/fixtures/` and the frozen probe inputs/replay plans are archived under [this batch](candidates/found-implementation-04/).

Three native pages is the selected smallest continuous-scroll option, supported by the actual plateau. A full virtual grid remains an alternative if global scrollbar position or larger retained browsing becomes a requirement; it would need variable-card/resize/anchor/focus/history design and its own actual evidence. Page-only replacement uses less memory but changes continuous section browsing. Neither alternative was added.

A Music page scales with admitted sources: three pages is **150 cards per source**, not a universal 180-card or byte limit. Atomic refresh temporarily holds old and incoming data; this is not a strict peak-memory guarantee. Retention adds per-card context/lifetime bookkeeping, whose heap/CPU cost has not been profiled. The scrollbar describes the retained neighborhood. No new CPU, RSS/heap, GPU, decoded-image, wire-byte or portable latency gain is claimed. Statement reductions compare correct serial native-range composition; they are not a speed comparison against the old incorrect one-page refresh.

Other cursor/search/discovery/profile/list/sequence/detail arrays retain their own contracts. Multi-source Music races, server-side policy/availability withdrawal, naturally failing providers, active write/undo and sustained device/touch/resource acceptance remain separate. The [unchecked-area roadmap](follow-up-roadmap.md) is deferred; already known work remains in the active ledger. This batch does not complete the entire audit.

## Tasks current-cohort check

The user-kept history query/index pair remains unchanged. A later [exact current-scope clone census](evidence/implementation-task-control-census-actual.json) found no eligible active jobs. A separate [signed-in normal Tasks read](evidence/implementation-task-control-census-normal.json) returned23representatives and zero active representatives. These observations do not invalidate the historical backlog; they do not supply a positive current bulk-control test. No cancel/retry/promote command or fake job was run. PJ-15 remains open: original target membership, notifications/retry/priority effects, partial acknowledgement and completion after navigation need one verified command contract.

## Drift and reproduction

Keep native page widths, counts, identity/occurrence rules, scope/permission fences, action acknowledgement and browser recovery in one shared protocol. Re-run complete affected actual DTOs and source schedules when these owners change. Review/re-freeze the archived clone plans before replay; do not merely regenerate passing hashes. The current [source manifest](evidence/implementation-found-04-source.json), [machine report](implementation-found-04.json), historical failed/stopped receipts and maintenance guide preserve which source was run and which later changes were reviewed. Later UI-only scope retirement leaves the range selection/merge bodies unchanged; its own current-source actual controls are separate. The final Music error path has separate actual-source controls and normal-provider reruns.

Screenshots are actual normal development, not specimen data:

[Actual focused-window retry after card-owner release (private verification image)](publication.md#private-verification-images)

[Final normal server-rendered three-page Library (private verification image)](publication.md#private-verification-images)
