# PLAN-04: reuse genre evidence inside each recommendation query

The shared recommendation query now computes positive genre weights once per request, then joins that small relation to each candidate's genre occurrences. This addresses only the repeated positive-genre scoring slice of **PLAN-04**. Other scoring dimensions, taste freshness, candidate selection and model quality remain open. **PLAN-03 is not closed:** its proposed global scalar hoist was rejected because the actual PostgreSQL plan already evaluates those scalars once.

## Shared owner and preserved contract

Only [recommendationRows](/Users/admin/Documents/ChatGPT/coast-new/src/lib/recommendations/query.server.ts:35) changed. The GET experiments API's `recommendations` and `row` reads share this owner. Its consumers are the For You recommendation grid, dynamic genre/kind rows, related-work rows and their linked grids through `createForYouSource` and `DynamicFeed`, across admitted screen, game, music and reading categories. Upcoming releases and received social recommendations use other owners and are unaffected.

The four-line `evidence_genres` CTE is materialized within the current SQL statement. Each evidence root contributes its weight once for each **distinct genre on that root**. The replacement scalar sums those weights for **each candidate genre occurrence**, preserving repeated candidate genres. It retains SQL null behavior, the 30-point cap and the `double precision` result type. It stores no completed results and adds no cache, schema, index, dependency or resource-policy setting.

The 300-root interest census, first 100 positive evidence roots, exact provider/taste candidate preselection and 2,000-candidate cap remain unchanged. So do author/series OR scoring, negative-genre penalties, feature/privacy/availability admission, release dates, provider connection generations, taste revision admission, score ties, seeded row order, page size 60, page clamping, titles and canonical card hydration. The [retained baseline](candidates/recommendations/query-before.ts.txt) and source pins record the exact two-hunk change.

Current positive interest weights are fixed integer-valued **FLOAT8** branches from 1 to 5, with at most 100 positive roots. The regrouped genre sums therefore remain exact integer arithmetic within that floating type for the current bounded input domain. Do not change this to a different numeric SQL type. A future fractional-weight model requires fresh full-score equivalence before relying on this reassociation.

## Actual retained-data verification

The [initial census](evidence/implementation-recommendation-census.json) found four enabled owners, 64 retained recommendation sets / 1,280 items, 5,993 work-feature records, 16 taste profiles and 5,662 taste-score records. Actual screen owners supplied 25 or 100 positive evidence roots to the tested queries. No user, interest, catalogue or provider response was invented for the actual comparisons.

The [final source-pinned proof](evidence/implementation-recommendation-scoring-actual.json) uses one explicitly **READ ONLY, repeatable-read** transaction on the approved private actual-data clone. It verifies 10-second statement and 1-second lock limits, disables JIT locally as the existing query owner does, and forbids network fetches. No normal/deployed database, provider key, provider request, history write or taste refresh is involved. Its pool closes on completion.

All eight actual contexts matched: four screen owners, each with its recommendation query and one actual-interest genre/movie row. It compares **all 9,543 preselected candidate objects and computed scores**, including every admitted candidate rather than only winners, followed by complete raw SQL page objects, totals and ordering. Four recommendation contexts exercise the existing 2,000-candidate bound; the genre rows contain 690, 149, 245 and 459 candidates. Both versions return `double precision` scores.

One representative 100-root query also executes the complete production `recommendationRows` path, including canonical `workCards`: the full 60-item DTO, pagination, total and title match exactly. That is **one complete hydrated page**, not eight complete DTO or HTTP comparisons. Unchanged hydration receives identical ordered IDs in all eight raw-page comparisons.

| Representative 100-root / 2,000-candidate plan | Baseline | Adopted query |
| --- | ---: | ---: |
| Repeated positive-genre candidate unnests | 79,020 twice | 2,000 twice |
| One-time evidence genre unnests | — | 100 |
| Materialized weighted genre rows | — | 20 |
| Weighted-genre aggregate peak | — | 24 KiB |
| Shared buffer hits | 40,018 | 40,018 |
| Shared reads / temporary reads / writes | 0 / 0 / 0 | 0 / 0 / 0 |
| Final single EXPLAIN execution | 235.658 ms | 72.022 ms |

The improvement is reduced repeated in-memory scoring work, not fewer catalogue reads. The [pre-adoption receipt](evidence/implementation-recommendation-scoring-before-adoption.json) independently preserved equal outcomes and single plans of 179.406 / 60.260 ms. These two ordered plan pairs are descriptive samples, **not** alternating latency distributions, deployed load, CPU/RSS measurements or browser performance acceptance. Existing author/series evidence scans remain in both plans.

## Functional edge coverage and actual gaps

All 145,757 actual media metadata rows had zero duplicate/null genre arrays in the measured census, so natural data cannot establish those edge contracts. The [source-derived regression](/Users/admin/Documents/ChatGPT/coast-new/tests/recommendation-genre-score-db.test.ts:14) executes only tableless SELECTs in a verified read-only transaction. Eleven authored controls cover duplicate evidence genres, repeated candidate genres, multiple roots, null arrays/elements, empty arrays, no overlap, the 30-point cap and `double precision`. The adopted expression and original scalar both match hand-computed expected values: **1 test / 34 assertions passed** in the [separate control receipt](evidence/implementation-recommendation-scoring-controls.json).

Those controls are supplemental correctness tests, not actual-media or performance evidence. The ordinary test command without `COAST_DB_TEST=1` discovers one guarded skip. It does not seed fabricated catalogue rows into the actual clone.

Actual positive author/series scoring, negative screen interests, game evidence and rich reading evidence were not established by this matrix. The census has one negative game root, two small positive music roots for one owner, and one positive reading root with no genres; these are not substituted for a large multi-medium score proof. Account-bound recommendation sets are absent. No positive cross-page, available-only, related-work, provider-generation failure or natural concurrent-update schedule is claimed. Those code paths are unchanged and retain existing correctness coverage, but broader PLAN-04 acceptance still needs their own positive corpus.

## PLAN-03: reject the unsupported global hoist

The same final actual transaction runs and explains the canonical ten-user stale census without refreshing or publishing profiles. It selects four actual owners in **2.126 ms**. The global Coast configuration and catalogue revision are already one-shot PostgreSQL `InitPlan` reads, each with one loop. User tracking/social revisions, provider-connected state and recommendation-set revision remain user-dependent; the recommendation-set read scans its 64 rows four times for four owners.

Moving the already one-shot scalars into application state offers no measured read-work reduction and risks changing the current snapshot contract. No such hoist was adopted. This does not establish taste freshness under concurrent edits or resolve the broader PLAN-03 ranking/freshness concern. The existing per-user revision recheck, job lease, frozen ten-user checkpoint, score publication and 500-per-medium cache bound remain unchanged; the prior taste-overlap proof was not redundantly rerun.

A separate source-only lead remains in `interestWorks`: its album-parent lateral can be unnecessary when episode/season show roots already win the existing COALESCE. It is outside this scoring change. A future admission guard needs actual signal/root equivalence and source-shaped plans before adoption; no improvement is claimed here.

## Maintenance and next checks

Keep the weighted relation inside the canonical query so all admitted consumers benefit. Do not add feature-specific copies or a long-lived genre cache. Preserve evidence-side DISTINCT and candidate-side occurrence counts when changing metadata normalization. Re-run the source-derived null/duplicate/type controls and full actual candidate-score equality after any weight, genre-array, author/series, provider/taste arithmetic, candidate-cap or ordering change. Keep private identifiers and query expression fields out of retained plans.

The [portable actual probe](probes/recommendation-genre-score.ts), [control runner](probes/recommendation-genre-controls.ts), [census probe](probes/recommendation-census.ts), exact baseline and [machine report](implementation-recommendation-scoring.json) retain the boundaries. Root owns common gates, browser acceptance, the shared ledger and remaining dispositions. No additional app changes or DB work are implied by this report.

The later [shared interest fallback fix](implementation-interest-fallback.md) changes only album lookup admission when a show root already wins. Its five final-source actual personal/global inputs match completely. Current dependency pins include that change; the original eight-context score and full DTO receipts retain their historical dependency pins and were not rerun for this follow-up.
