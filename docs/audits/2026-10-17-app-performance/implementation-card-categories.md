# Shared card projection admission — DATA-11

17 October 2026. Baseline card owner: `eb0673873462b71118d1c11678d128958a05ff07`; both variants use the current shared medium projections. The change is confined to the `works` import and `workCardPage` helper in `src/lib/collection/query.server.ts`. The coordinator's assessment SQL changes were left intact. No schema, dependency, cache, UI or experiment change was added.

The shared card page now reads canonical work ID/category pairs once for its existing maximum-60 unique-ID batch. Only nonempty screen, game, music and book/comic cohorts enter their existing projection owners. Those owners retain feature, source, privacy and viewer-preference decisions. No caller hint is trusted as category authority, and no new policy gate is substituted for existing behavior. UUID validation previously supplied incidentally by the always-invoked screen projection is now explicit at the shared boundary.

The outer hydrator still deduplicates work for batching, then restores every requested duplicate in its original position. Unknown work IDs produce no cards; empty input remains an empty result. Music external presentation IDs still map through canonical `workId`. Disabled reading categories, viewer-owned aliases, source/artwork admission, game variants and screen parent context continue through the same existing owners.

## Actual verification and tradeoff

The read-only private-clone probe compared complete returned JavaScript objects in memory, including undefined fields and nested presentation values. No titles, identifiers or personal card payloads were saved. **180 of 180 comparisons matched**: four actual owners, each actual viewer plus guest, and nine input cohorts covering available individual categories, mixed categories, duplicate/missing identities, more than one 60-ID batch, missing-only input and empty input. Three validation controls also matched: invalid owner, invalid ID and empty input with an invalid owner. The source hash stayed unchanged throughout the final run.

There were no saved books in the actual catalogue. That category remains an explicit gap; no catalogue fixture was inserted. Intentional missing/invalid inputs are negative controls, separate from actual stored medium records. Existing settings/relationships/preferences were exercised as stored; no fictional privacy or alias state was seeded to enlarge coverage.

| Self-view workload | ORM statements before → after | Result |
| --- | --- | --- |
| 60 screen identities | 22 → 20 | Unrelated game/music/reading projection queries eliminated |
| 60 music identities | 7 → 5 | Unrelated screen/game/reading projection queries eliminated |
| 60 game identities | 6 → 4 | Unrelated screen/music/reading projection queries eliminated |
| Actual comic identities | 7 → 5 | Unrelated screen/game/music projection queries eliminated |
| Mixed available categories | 29 → 30 | All projections remain necessary; identity admission adds one query |
| 120 screen identities plus duplicates | 44 → 40 | Two bounded batches, preserved duplicates/order |
| Missing-only negative control | 4 → 1 | Canonical lookup returns no identities; no medium projection starts |
| Empty input | 0 → 0 | No work admitted |

Counts cover ORM root/transaction sessions and exclude direct Bun SQL, as in the original audit. The canonical lookup transfers at most 60 identity/category pairs per batch. This is a small resource-efficiency change, with an explicit one-query mixed-page cost.

After one warm-up per variant, three alternating samples per measured cohort **did not establish a general latency improvement**. Screen medians were 212.63 → 212.98 ms; music 6.32 → 6.97 ms; game 5.03 → 5.02 ms; comic 6.49 → 9.25 ms; mixed 109.28 → 114.79 ms; the two-page screen case 325.59 → 324.57 ms. These small local samples are descriptive, not production p95, a speedup promise or proof of a stable slowdown. The established gain is less unnecessary admitted database work; the mixed-page cost must remain visible in future measurements.

Evidence: [complete actual comparisons and samples](evidence/implementation-card-categories-actual.json). The retained [probe](probes/card-categories-real.ts) uses the audited card owner extracted by [baseline helper](probes/card-categories-baseline.py), with current shared dependencies. It invokes `workCards` directly and does not run Collection's assessment query, providers or live credentials.

## Shared consumer acceptance

The change applies once at `workCards`, used by Collection, Library, Progress/Continue, custom lists, profiles, social activity, notifications, Planning, request/stream card presentations and public API consumers. Its existing screen/game/music/reading projection owners and personalization helpers remain authoritative. The complete direct-function comparisons validate this common contract; they do not claim every UI journey or disabled/private hypothetical branch was separately executed.

Keep existing card-hydration, collection category-gate, music source/privacy and work-menu alias regressions. For future changes, rerun full-object equality across actual category and mixed pages, guests/other viewers, missing identities and duplicate ordering; record query admission as well as time. New medium projections must extend the canonical admission table and retain their own policy checks. Prefer this shared boundary to feature-specific caches or conditional rendering workarounds.
