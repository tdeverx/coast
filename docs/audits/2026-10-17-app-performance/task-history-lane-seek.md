# PJ-10 lane-seek trial rejected; PJ-13 contract and corpus limits

No application query, cache, schema, index, retention policy, dependency or provider behavior changed. This supplement preserves a second measured **negative** PJ-10 option and a source/corpus assessment for PJ-13. It does not replace the [earlier grouped-maximum rejection](implementation-feature-job-lease.md#pj-10-reject-the-grouped-task-history-query-trial) or close either finding.

## PJ-10: actual lane-seek comparison

The candidate discovers actual terminal `(connection_id, kind, state, derived scope)` lanes, then uses per-lane lateral latest-action reads before the final kind/scope representative sort. It derives scopes and generation eligibility from the current canonical helpers. It does not enumerate a guessed list of configured service cards. Separate null/non-null connection branches make the existing `outbox_maintenance_idx(connection_id,kind,state,updated_at)` available. Each branch retains current/null generation admission, payload-derived accountless TMDB/IGDB scope, descending timestamp and UUID tie order. It uses the current query's terminal states; no lock or task-control state is changed.

The [actual receipt](evidence/task-history-lane-seek-actual.json) contains exact baseline/candidate SQL and full sanitized JSON plans. One explicit repeatable-read **READ ONLY** session on the approved private actual-data clone verified 30-second statement and 5-second lock limits, 4 MiB `work_mem`, and unchanged source. No fixtures, writes, providers or normal/deployed database access were used. The pool closed after the proof.

All **25,891 retained actions** were terminal. Both reads returned the exact same **23 ID/scope rows**, including **4 null scopes**; actual row values remain private and only the complete-output digest is retained. The corpus has 2,054 null connections and null generations, but zero dangling deleted connections and zero obsolete generations. No positive deleted/obsolete-generation or deliberate timestamp-tie schedule is claimed.

| Isolated plan metric | Current query | Lane-seek candidate |
| --- | ---: | ---: |
| Representative rows | 23 | 23 |
| Whole-history input rows | 25,891 | 25,891 |
| Final sort rows | 25,891 | 49 |
| Final sort memory | 3,023 KiB | 29 KiB |
| Additional lane hash peak | — | 225 KiB |
| Shared buffer hits | 670 | 4,068 |
| Shared blocks read | 0 | 214 |
| Temporary blocks written | 0 | 0 |
| Single EXPLAIN execution | 29.008 ms | 45.469 ms |

The candidate genuinely admits the existing maintenance index on connection/kind/state, including null connections. That is insufficient: PostgreSQL selects bitmap heap reads and per-lane top-N sorting. Forty-one non-null lanes average 581 qualifying index rows, and eight null lanes average 257. The candidate still scans history once for its 49-lane discovery and then rereads it through those seeks. Reducing the final sort does not compensate for the extra work on this corpus.

**Rejected.** The probe automatically skipped alternating timing repeats after its buffer-work admission failed. These single descriptive plan samples are not a warmed latency distribution, a deployed comparison or a CPU/RSS measurement. The prior deployed spill finding remains open, as do the earlier negative candidate and permanent-history requirements. No forced planner settings, index, retention budget or durable evidence table were introduced to manufacture a win. Any next option must show complete dynamic/null/deleted/current/obsolete scope equivalence and actual visited-row/buffer improvement before adoption.

The [portable read-only probe](probes/task-history-lane-seek.ts) guards the private clone endpoint/name, extracts current helper/query source, uses parameter-free canonical query structure, records index definitions/plans, compares complete outputs and checks source stability. Public EXPLAIN evidence contains no returned identity rows or private payloads; UUID literal redaction found zero literals to remove. Query algorithm and full metrics remain reproducible.

## PJ-13: a persistent base cache changes the current contract

The existing [catalogue owner](/Users/admin/Documents/ChatGPT/coast-new/src/lib/catalogue/details.server.ts:14) has **one aggregate 100-entry, 15-minute cache** shared by TMDB and Trakt complete insight pages. Its generic owner sweeps expired values on lookup, sets expiry at successful completion, preserves insertion-order eviction and never retains incomplete replacements or failures. It coalesces only an identical page key.

An uncached TMDB page currently refetches base details/credits before its review page. A reviews failure returns current facts with `incomplete: true`, and retry fetches base facts again. Child season/episode paths do not request reviews. The catalogue's TMDB key is `region/path/page`; language is currently fixed `en-US`. Trakt uses its own instance/title/page key in the same completed-entry budget.

Persistently reusing base facts across pages changes the observation time of those facts and of incomplete-review retries. Adding a second 100-entry base cache expands the current aggregate budget; inserting typed base/review entries into the same 100 slots changes page/Trakt eviction admission. Neither is an exact-contract routine repair. A coherent full split needs an explicit freshness/eviction decision, followed by complete DTO and failure/TTL/concurrent comparisons.

An existing in-flight-only sharing owner could instead coalesce overlapping base reads and retain no completed facts. That preserves sequential cold/incomplete-retry freshness and the completed 100-entry budget, but fixes only concurrent overlap and correlates the shared request's failure across joiners. It would still need exact resource identity, priority/cancellation ownership, no-review child behavior and actual response acceptance. No such partial change was implemented or presented as the full pagination fix.

## Retained actual corpus does not supply missing provider responses

The separate [read-only filesystem census](evidence/insights-retained-corpus.json) read four rotating diagnostic segments separately: **12,893 parsed rows**, including **60 TMDB provider events**. Provider detail keys contain only duration, failure, method, provider, status and stream classifications. The source's closed diagnostic vocabulary excludes upstream response bodies; no top-level response payload candidate was found. These finite, non-atomic segment reads do not prove that a provider was never called.

The already retained actual discovery capture has **40 normalized records / 35 unique works**. All 40 have normalized `releaseDate`; none has raw facts, credits, crew, reviews, vote counts, budget, revenue, spoken languages or production-company response fields. Normalized catalogue metadata cannot reconstruct those missing original fields or consecutive review pages without inventing content. No keys, credentials, guessed URL, provider call, media download or synthetic performance corpus was used.

Actual complete-insights/provider-page acceptance remains open. Use an authorized retained real base/credits response and consecutive review pages with their actual language/source identity; compare full mapped DTOs and request counts, including partial failures, retries, child paths, TTL/eviction and concurrent ownership. Existing authored `media-details` and cache tests protect functional contracts but do not substitute for this actual-provider evidence.

[Machine report and source pins](task-history-lane-seek.json) and the [corpus probe](probes/insights-retained-corpus.py) retain the evidence boundaries. The corpus probe fails for manual provenance review if future retained metadata acquires insights-shaped content instead of silently continuing to assert absence. Root owns the shared finding register and any later adoption decision.
