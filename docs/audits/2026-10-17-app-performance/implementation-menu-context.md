# Shared menu context hydration — MIN-02

The shared screen action-menu owner now hydrates the whole work and tracking parents together. Opening an episode or season menu previously hydrated its show once as the whole work and again in its parent batch. The existing `mediaViewsForIds` owner deduplicates the combined IDs. Filtering the result back to the original parent set preserves request, reset and rewatch targets, including when the separately read whole-work identity differs. Initial item admission, fresh whole-work lookup, feature policy and missing-work fallback remain intact.

[Machine receipt](implementation-menu-context.json), [actual comparisons](evidence/implementation-menu-context-actual.json), [portable probe](probes/media-actions-real.ts).

Thirty-one complete menu responses matched the immutable audited implementation using the same current shared dependencies. Four actual enabled accounts and five saved kinds were exercised: movie, show, season, episode and collection. Three comparisons included nonempty saved request lists, and two included progress targets. Arrays and every returned field were compared without normalization. Invalid UUID and genuinely absent identity rejection also matched. No private rows or identifiers were saved.

Episode menu ORM statements fell from 56 to 40 and season statements from 57 to 41 in the tested cohorts. Other kinds retained their statement counts. Counters exclude direct Bun SQL. One before/after timing pair per case is descriptive only; it is not a latency benchmark or a production percentile. Four physical pool sessions verified read-only defaults, 30-second statement and 5-second lock limits. No provider transport was admitted, and no database writes occurred.

The actual snapshot has no saved franchises or selected active rewatches. No fabricated parent graph or concurrent catalogue mutation was used. Independent source review checks that extra whole-work context cannot leak into reset/rewatch targets; this is not a proof of every concurrent schedule. Signed-in normal-dev menu acceptance is recorded with the current common verification batch.

Rollback is the small owner composition change alone; no schema, dependency, presentation or data rollback is needed. Future changes to `mediaViewsForIds`, whole-work identity, parent ordering or action DTOs should rerun the complete actual-data comparison rather than assert only card counts.


## Current applied-source browser acceptance

The [2026-10-18 signed-in normal-dev trial](evidence/implementation-owner-batch-normal.json) reloaded the current source after the build, with audit-owned repository writes frozen. The actual dropped-game preview, movie and episode menus, profile overview/favourites panel, Admin health and 30 task rows rendered. This trial recorded zero new console warnings/errors and no framework overlay. It did not exercise real filter/preference writes, active device authorization, chunk failure, natural cancellation schedules or performance/resource limits. Historical HMR errors before the reload and the earlier unresolved route observations remain separate.
