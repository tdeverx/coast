# Provider implementation: immutable Steam ownership census

17 October 2026. Implements PJ-11 at the existing Steam import and shared queue checkpoint owners. No schema/index, dependency, external export, commit or deployment. The original audit remains historical and unchanged.

`src/lib/providers/steam/sync.server.ts` stages the complete ownership census once. Its items, scan ID and observation time remain immutable. Every 100-title transaction writes only `{task, scanId, next, added}` through the existing `saveJobCheckpoint(..., tx)` owner, atomically with the imported state. That owner fences job ID/state/attempt and updates only `_checkpoint`, preserving concurrently promoted manual intent. Resume validates the cursor's census identity and range before applying more state or authoritative absence. Existing persisted snapshot progress remains usable if no separate cursor has yet been written. Account/generation/lease checks, safe yielding, optional metadata scheduling and terminal snapshot cleanup retain their existing owners.

## Actual-data verification

The coordinator's guarded runner selected the existing Steam account and reconstructed its complete **1,144 owned games** solely from persisted actual AppIDs, game titles, playtime, last-played timestamps and stats flags. Snapshot observation time is the latest recorded actual account observation. This is an actual retained-data import/recovery check, not a fresh Steam API response. It does not invent users, games, names, ownership or playtime.

All mutation occurred in the designated disposable fixes clone. The clone could not decrypt copied instance ciphertext with its fresh local key, so the probe temporarily encrypted an unusable generated API key under a private temporary key directory. It restored the original ciphertext and removed its temporary actions, snapshots, optional metadata work and key directory in `finally`. External fetch always throws; **zero external provider calls occurred**. The live normal/deployed database was untouched.

| Actual operation | Observed persistence | Descriptive elapsed time |
| --- | --- | --- |
| Audited Steam owner, first 100 actual titles | 613 ORM statements; 1 full snapshot UPDATE; snapshot `xmin` changed; stored snapshot 37,914 bytes | 483.66 ms |
| Fixed owner, first 100 actual titles | 613 ORM statements; 0 snapshot UPDATEs; 1 small cursor update; snapshot `xmin` and content unchanged; cursor JSON 95 bytes | 485.49 ms |
| Fixed owner, remaining actual census | 3 resumed passes; 6,351 ORM statements; 11 cursor updates; full snapshot never updated; final cursor stored size 126 bytes versus 37,906-byte stored census | 10,211.62 ms |

The first-chunk timings are essentially equal. No speedup, WAL reduction percentage, cold-cache effect or production percentile is claimed. The verified resource improvement is removal of full-snapshot tuple rewrites: exact row versions/content and executed statement classes establish that mechanism. Stored PostgreSQL sizes are not uncompressed network or logical JSON byte sizes. The audited comparison loads only the original Steam module with current dependencies; it is not a whole historical app benchmark.

All 25 recorded checks passed: correct yield after 100, cursor advance/resume to 1,144, immutable census row/content through all passes, wrong-scan and out-of-range rejection without domain changes, expired-attempt fencing without domain changes, manual intent preserved, complete result (`checked=1144`, `added=0`, `refreshed=1144`), unchanged actual ownership/playtime/stats digest, no new users/games/works and terminal snapshot cleanup. Import observation/freshness writes occur normally inside the private clone. These are distinct from the unchanged semantic ownership/playtime check.

Reproduction source: [actual probe](probes/real-steam-checkpoint.ts). Raw aggregates: [actual result](evidence/implementation-providers-real-steam.json). Run only with the designated private-clone runner and its guard; never point it at live data. The probe stages ephemeral recovery metadata and calls the real import owner; it is not a read-only SQL plan.

## Regression and remaining work

The existing `tests/steam-db.test.ts` resume case now verifies the immutable snapshot and timestamp, the independent cursor, invalid census/range rejection, preserved manual purpose and terminal cleanup. This fixture test was edited but was not substituted for the actual-data run above. The coordinator owns any additional isolated fixture suite/type/build execution.

PJ-10 remains a separate query/index decision: a closed provider-task census cannot replace dynamic/null-scope event-driven representatives. The existing success index does not cover all terminal states/scopes. No speculative history query/index was added.

PJ-13 remains open. The current catalogue cache holds combined insights/review-page results, while adapters are recreated by `getTmdb`; there is no reusable invariant base entry already exposed. Avoiding the extra base request requires splitting the provider base/review contract and budgeting a shared cache partition, while preserving incomplete-review retries and all provider/language/region scopes. No live review-navigation trace was collected, so this is deferred rather than introducing another cache during the source freeze. Existing response behavior is unchanged.
