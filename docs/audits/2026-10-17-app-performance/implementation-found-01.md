# Shared list and Listen repairs — implementation batch01

The known-findings implementation pass is active again under the latest user instruction. This batch applies three existing shared-owner repairs; it does not complete all audit findings. See the [active implementation queue](implementation-queue.md).

## Changes and reach

- **DATA-03 / DATA-07 — lists:** removal uses DELETE RETURNING, returns immediately when the entry was absent, then compacts changed positions in one UPDATE FROM. Exact-permutation reorder uses bounded UUID parameters and WITH ORDINALITY, writing only differing positions. Identical reorder and normalized name/description submissions skip follow-up timestamps/projection/export after existing admission. Advisory user locking, owned list locking, type/UUID checks, exact entry-ID permutation and the10000-ID raw bound remain.
- **DATA-12 — owned list header:** getListHeader owns UUID/ownership validation and header projection. Full getList reuses it and retains full item hydration. Playlist start reads only the header it consumes. Ordinary detail consumers still get their complete data.
- **Listen — final page count:** the shared Music query computes its page bound from final provider results after a clamp reread, instead of keeping an earlier bound. It adds no browse calls, schema, cache, dependency or ordering policy. Both Library Listen and dedicated Music use this owner.

## Verification and limits

The [actual clone receipt](evidence/implementation-found-lists-actual.json) passes four-owner empty list reads, eight header/full missing-key404 comparisons and native EXPLAIN admission of both exact mutation templates with64actual work UUID parameters. The transaction was read-only repeatable-read, rolled back and closed. There are no saved list/items, so this does **not** verify positive mutation order, repeated occurrences, exports, Undo, concurrent writers, WAL or performance. No fake lists were created.

The [signed-in normal Listen receipt](evidence/implementation-found-listen-normal.json) records exact complete DTO equality before/after for actual page1 (50items) and requestedpage5 clamped to4 (12items), total162. This is a stable actual source acceptance check. Growth during clamp, additional shrink, multi-source ordering, process resources and wire latency remain unmeasured.

All six [common gates](evidence/implementation-found-01-gates.json) pass: unit, type/Svelte check, production build, code/UI inventories and source style. Unit fixtures are supplemental controls, not the actual-data evidence above. The [machine receipt](implementation-found-01.json) pins current source. Performance patterns and drift requirements are maintained in [Performance methods](../../performance.md).
