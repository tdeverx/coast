# Cross-boundary follow-ups validated by root

These findings came from leads crossing specialist ownership. They are recorded separately so they are not lost when the individual scopes are combined. CROSS-01 and CROSS-02 are static call-path findings. CROSS-03 was reproduced against a fresh, migrated, synthetic PostgreSQL database. No real provider, dev database or live database was used.

## CROSS-01 — P2: Reading gates still infer medium from metadata source in two paths

`docs/reading.md:13` correctly states that Open Library can describe comics and metadata source does not determine medium. `readingProviderDetails` already resolves the real metadata kind and checks its gate. However, `experimentalPathFeature` in `src/lib/server/experimental.ts:12` makes every Open Library preview route require Books. `src/lib/sync/jellyfin-reading.server.ts:25` also considers Open Library/ISBN identifiers only while Books is enabled.

With Comics enabled and Books disabled, an exact Open Library comic cannot pass its preview path, and a new Jellyfin comic with an Open Library identifier but no Comic Vine identifier is skipped before its metadata can classify it. Explicit previously linked file editions can still work; this is not a claim that all comics fail.

Use the existing aggregate Reading gate before unresolved provider reads, then the actual book/comic gate after identity/metadata classification. Preserve independent Books/Comics visibility and do not classify by file extension, title or source name. Verify Comics-only preview and Jellyfin import of a known Open Library graphic novel; ordinary Open Library books must still be refused by the final gate.

## CROSS-02 — P2: New reading file mappings bypass registered identity aliases

`src/lib/catalogue/reading.server.ts:39-61` registers and resolves provider aliases in `work_identifiers`. Reading Search already uses these canonical identities. `src/lib/sync/jellyfin-reading.server.ts:31-32`, after failing the exact file-edition lookup, searches only the primary `reading_works.kind/external_id` pair. It then fetches metadata before the canonical importer can discover an existing alias.

For a comic saved primarily from Comic Vine with an Open Library alias, a new Jellyfin file/copy/server carrying the Open Library identifier misses the existing saved work. It performs a redundant remote lookup, and a metadata outage can prevent an exact known file from establishing availability even though Coast already knows its canonical identity. The exact edition fast path remains effective for previously linked files.

Resolve a bounded set of exact registered identities locally before remote metadata enrichment, using actual saved kind and the existing final feature/permission checks. Preserve explicit conflict handling and never merge by title. Verify a saved cross-provider comic and a new Jellyfin file carrying only its secondary alias: with provider requests unavailable, the file should attach to the same UUID; an unknown or conflicting identity must not be guessed.

The reading reviewer surfaced these leads in its handoff but excluded them from its reader-focused finding count. Root traced the caller, category gates, canonical alias registry and documentation before retaining them.


## CROSS-03 — P1: Nested global reads can stall every pooled database request

The public API preloads config, starts a transaction and takes the account advisory lock (`src/lib/server/public-api/mutations.server.ts:40-43`). Its Reading branch passes that transaction into `updateReading` (:62). The transactional helper calls `getConfig()` again (`src/lib/core/reading/service.server.ts:37`), which defaults to the global pool (`src/lib/server/config.ts:66`). That pool allows ten connections (`src/lib/server/db/index.ts:27`).

With ten concurrent requests for the same account, the first holds the account lock while the other nine occupy the remaining connections waiting for that lock. The first then requests an eleventh connection for config. It cannot complete and release the lock; its waiters cannot complete and release their connections. Unrelated DB traffic also queues behind the exhausted pool. The configured connection timeout did not bound this acquisition wait in the observed reproduction. This is not attribution of an earlier live crash.

A disposable migrated database fixture used the real `updateReading` service and application pool. A single transaction control succeeded at page 1. An ordered ten-transaction repeat reported `firstSettled=false` and nine advisory waiters at 1.5 seconds. Cancelling one synthetic waiter through an independent observer freed a slot: the first and eight other operations completed in 1538 ms, and only the deliberately cancelled waiter rejected. An earlier exploratory run stayed blocked for 109111 ms until the same scoped release. The fixture was dropped and the originally stopped test container restored to stopped. No app code or tests were changed.

Pass the already resolved config into the transactional service or query through the same transaction. Audit analogous helpers for independent pool reads while holding locks; increasing the pool only changes the concurrency threshold. A useful regression should bound ten concurrent same-account writes plus an unrelated read and require completion without cancellation, preserving account/token/idempotency/category checks.
