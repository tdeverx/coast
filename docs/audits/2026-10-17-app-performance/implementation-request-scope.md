# HELPER-04 — calculate request destination multiplicity once per snapshot

All three existing request-scope labels now share one component-derived formatter for the loaded request snapshot. Previously each label built a Set by walking every peer request. Exact wording and current-snapshot behavior are preserved. There is no global cache, compatibility export, new dependency, schema, navigation or toast change.

[Machine-readable record](implementation-request-scope.json), [actual saved-label proof](evidence/implementation-request-scope-actual.json), [focused tests](evidence/implementation-request-scope-tests.json).

## Shared ownership and unchanged labels

[requestScopeFormatter](../../../src/lib/media/requests.ts:15) computes whether the supplied snapshot has multiple destination names once, then returns the existing season/quality/destination formatter. [createRequestControls](../../../src/lib/ui/controls/requests.svelte.ts:16) derives that function from `existingRequests`. Replacing the snapshot produces the appropriate new function; repeated uses within it reuse the same function. No request-option cancellation, publication, retry or disposal behavior changed.

[ScreenActions](../../../src/lib/ui/work-menu/ScreenActions.svelte:168) uses `requests.scopeLabel` for the submenu button's accessible label, visible trigger text and cancel/approve/decline confirmation text. Confirmation still uses the current loaded request snapshot's destination multiplicity, including if its request argument is from a previous snapshot. The closure formats the supplied request's fields and does not substitute another row's fields by ID.

Standard/4K version wording, singular/plural Seasons, original season order/duplicates and the destination suffix remain exact. The `/requests` grid uses different existing inline wording; it has no request-scope-helper call and remains unchanged. The old internal export has no remaining call sites and was removed rather than retained as a compatibility shim.

For N row labels in a snapshot, peer destination reads change from N² to N, plus the necessary reads when a label includes its own destination suffix. Two uses of each row label reuse the same destination decision. The tradeoff is one derived formatter closure per accessed snapshot. A single-request first use has no scan reduction. No timers, background tasks, listeners or network calls were added.

## Verification on actual requests

The [exact executed probe](probes/request-scope-actual.ts) read all39 persisted request rows with their actual destination, quality and season fields from the approved private actual-data clone. It grouped actual owner/target values in memory, compared complete label arrays against the [retained original formatter](candidates/request-scope/requests.before.ts.txt), and discarded labels/identifiers. A reserved repeatable-read **READ ONLY** transaction verified30s statement/5s lock limits, rolled back and closed. No catalogue, request, preference, configuration or normal data was written.

| Actual comparison | Result | Peer destination reads for one label per row |
| --- | --- | --- |
|All saved requests, including historical states|39 labels across38 owner/target groups, all exact; largest group2.|41→39; historical comparisons are not claimed as visible-menu gains.|
|Active menu-state membership, excluding cancelled/declined|38 labels across38 groups, all exact; largest group1.|38→38; **no observed active-menu scan reduction** in this snapshot.|

There are three actual nonempty-season requests, zero4K requests and zero multiple-destination snapshots. Controlled tests cover missing4K/multiple-destination combinations separately. The active-state grouping matches the menu query's state/owner/target membership; it does not claim a separate visibility or rendered-browser test. The39 unique saved requests and38 active checks overlap; they are not77 distinct persisted requests.

Transparent getters counted only peer-snapshot reads on cloned actual values; label suffix reads use the original row. This supplements the source bound and does not establish latency, CPU, heap/RSS or a busy-menu benchmark. Current active menus have no demonstrated gain from this change; the repeated-scan pattern is removed at its shared owner for repeated uses and future larger snapshots.

The first read-only probe attempt used `is4k` instead of the existing SQL column `is_4k`. That [failed probe receipt](evidence/implementation-request-scope-first-attempt.json) is retained. Correcting the probe after schema review produced the passing result; application source did not change, no write occurred, and this is not attributed as an application defect.

## Controlled contracts and maintenance

Four focused tests passed30 assertions. Existing lazy-load/cancellation/retry coverage still passes. Pure label cases preserve empty/single/multiple seasons, season0, original order/duplicates, standard/4K quality and single/multiple destinations. A compiled Svelte reactive owner test replaces one→multiple→empty request snapshots, verifies refreshed suffixes, confirms stable formatter identity within a snapshot and retains the original formatter's original decision. These authored cases are contract tests, not fabricated database performance evidence.

Root's independent read-only review found no blocker in the current snapshot ownership, wording or cancellation preservation. Source hashes are retained in the machine-readable report. Full application gates and normal-dev browser acceptance belong to root's coordinated run; this report claims only the stated focused and actual-label checks.

Retain the shared derived owner and all three call sites. Re-run the read-only actual probe when naturally persisted4K or multiple-destination request groups become available, preserving its missing-cohort disclosures until then. The retained probe is an exact local audit artifact; its captured formatter path must be restaged from the retained source snapshot or changed through a reviewed path-only adaptation for another checkout. Do not introduce a per-row Set scan, global snapshot cache or source-compatible shim to reuse this formatter.

All owned source/test/documentation writes are frozen after publishing this record.


## Current applied-source browser acceptance

The [2026-10-18 signed-in normal-dev trial](evidence/implementation-owner-batch-normal.json) reloaded the current source after the build, with audit-owned repository writes frozen. The actual dropped-game preview, movie and episode menus, profile overview/favourites panel, Admin health and 30 task rows rendered. This trial recorded zero new console warnings/errors and no framework overlay. It did not exercise real filter/preference writes, active device authorization, chunk failure, natural cancellation schedules or performance/resource limits. Historical HMR errors before the reload and the earlier unresolved route observations remain separate.
