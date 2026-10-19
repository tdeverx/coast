# MIN-04: next notification batching candidate

This is a source-reviewed option for the next implementation batch. **No application code changed, and neither notification failure atomicity nor settings-snapshot behavior has been selected or adopted.** MIN-04 remains open. The [machine-readable record](next-notification-batch.json) contains exact source fingerprints, consumers, options and verification boundaries; the [remaining-work disposition](remaining-work-disposition.md) keeps the wider options visible.

## Remaining shared cost

[notifySourceChangeUsers](../../../src/lib/collection/source-changes.server.ts#L57) deduplicates recipients in first-occurrence order, then awaits a separate `notify` call for each. [notify](../../../src/lib/server/notifications/index.ts#L81) delegates to `notifyMany([input], database)`. The common batch owner already reads configuration once per call and recipient settings once per group of at most100 inputs, but this caller supplies only one input at a time. An explicit database passed to [getConfig](../../../src/lib/server/config.ts#L109) deliberately bypasses the HTTP request snapshot.

Under stable admitted inputs, N existing recipients therefore require N configuration reads, N full settings reads and up toN INSERT/upsert statements. [notifySourceChange](../../../src/lib/collection/source-changes.server.ts#L52) adds one existing source-to-recipient SELECT when used. These are source-derived bounds, not an executed delivery trace. Combining recipients does not inherently reduce aggregate settings bytes: the same distinct users still return their full settings, including unrelated values such as inline avatars. This is separate from inbox hydration and history scans.

The shared consumers are Jellyfin disconnect, instance disable and instance deletion in [provider-sources.server.ts](../../../src/lib/application/provider-sources.server.ts#L10). Each completes its source transaction before sending these notices. Instance deletion captures recipient IDs before deletion, then sends afterwards. A delivery error can therefore follow a successful source mutation; retrying a deleted instance can fail with404. The existing shared notification owner must retain authoritative preference calculation, SQL visibility and source-key upsert behavior.

## Actual read-only evidence

The [successful aggregate census](evidence/next-notification-batch-census.json) used the approved actual-data clone, a reserved repeatable-read READ ONLY transaction, and explicitly verified10s statement/1s lock timeouts. The transaction rolled back and the pool closed. No notification/domain function, source mutation, provider operation or normal database write ran. Publishing this report ran no database work.

| Existing cohort | Retained aggregate |
| --- | ---: |
| Jellyfin instances with connected recipient group |1 enabled instance |
| Connections / distinct existing owners |4 /4 |
| Connected / disabled recipients |4 /0 |
| Stored notifications / owners |518 /4 |
| Stored sync notices |1 |
| Existing collection-source-review keys |0 |
| Stored normal / silent notices |507 /11 |
| Read / dismissed notices |18 /3 |
| Current users with silencing or an explicit level override |0 |

The518 stored notices are not518 source-change recipients and are not read by this delivery path. Four connected owners provide a positive current recipient cohort, but there is no saved source-review upsert cohort or captured natural source-change/failure schedule. Historical silent notices do not demonstrate current silenced-recipient behavior.

The [first failed READ ONLY receipt](evidence/next-notification-batch-census-first-attempt.json) is retained. That probe draft referenced `seen_at`, which current notifications do not contain. The corrected [executed probe](probes/notification-source-census.ts) uses `read_at` and `dismissed_at`. The failed receipt records only `private_diagnostic_only`; no exact SQLSTATE is available or claimed. This was a probe error, not an application finding. The successful probe is published byte-for-byte; the failed draft source was not retained.

## Options that need exact review

| Option | Structural bound for the actual four-recipient group | Behavior to preserve or choose |
| --- | --- | --- |
| Share canonical preparation; keep ordered individual INSERTs |1 config +1 settings +4 writes =6 calls, versus12 today | Keeps individual-statement committed-prefix behavior when using the pool. Config/settings become one bounded preparation snapshot; it does not preserve the old timing of per-recipient rereads. |
| Call existing `notifyMany` once |1 config +1 settings +1 write =3 calls, versus12 today | One row error fails the entire multi-row chunk. This differs from previously committed individual recipients. Later chunks may still leave earlier chunks committed. |

These are unmeasured SQL admission bounds, excluding the optional source-ID lookup. They are not latency, WAL, CPU, memory, browser or throughput results. The raw census field `batchedMaximumWrites` describes the direct `notifyMany` option only, not the individual-write option.

For the conservative option, use one narrow shared entry point or internal write-policy seam in the existing notification owner, reusing its configuration, settings, values and visibility logic. Keep existing `notifyMany` and broadcast defaults unchanged. Do not add a caller-private cache, copied preference policy, global scheduler, new dependency or schema. Shared preparation can fail before any writes, whereas a later recipient’s configuration/settings read can currently fail after earlier notices committed. Individual INSERTs preserve write-statement boundaries, not every original read-failure schedule. The three-call option needs less code, but also changes write atomicity. This publication adopts neither option.

Both options must retain exact message wording and source keys, first-occurrence recipient order, missing-user behavior, an empty-input no-query guard, void return and error propagation. Do not add disabled/social filters to these sync notices: current social per-kind suppression depends on a data payload that these notices do not have. Keep the existing per-row SQL visibility predicate. Empty-input query avoidance is distinct from default database-handle evaluation.

## Verification for the next implementation batch

1. Use the actual four bindings to compare baseline/current notification boundaries under rollback. Never execute a real disconnect, disable or delete merely to test delivery. Compare complete notice fields, source-key/user mapping, current settings and all original518 rows, plus relevant revisions and rollback restoration. Capture raw BunSQL as well as ORM; otherwise config/native statements can be missed.
2. Fix transaction timestamps and use savepoints for payload comparison. Newly generated random IDs cannot be literally equal across separate inserts; verify their generation and mapping semantics explicitly. Existing source-key identity/creation/read/dismissed fields must remain unchanged on upsert. There are zero originally saved source-review keys, so any second in-transaction replay is a controlled event, not a naturally saved positive cohort.
3. Separately exercise preparation-read failures, first/later write failure and lost acknowledgement, duplicate recipients/source keys, missing users, silence/locked policy,100-input boundaries, transaction ownership and the selected preparation-snapshot contract. Authored correctness fixtures belong in an isolated correctness database and are not actual-data performance evidence. None were executed for this census.
4. Compare the exact selected partial-delivery contract before any adoption. Preserving individual writes does not preserve per-recipient policy-read timing; accepting multi-row writes does not preserve the existing committed prefix. Keep this distinction explicit in the implementation and tests.

Routine shared-owner work does not itself require a new dependency or architecture approval. The next implementation batch still needs a concrete option review; the user-supplied AGENTS.md rules apply if an unavoidable complexity or production dependency is introduced. No such addition is proposed here.

The linked disposition retains its earlier ledger hash as a **historical snapshot**, not a refreshed claim about the final ledger. No canonical status or ledger file was changed by this publication.
