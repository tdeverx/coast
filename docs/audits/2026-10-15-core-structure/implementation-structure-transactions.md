# Structure and sequence transactions — 2026-10-15

Implemented remaining STRUCT-01 work and the tracking/sequence portion of CROSS-03. Root owns the original Reading/config changes and final database verification.

## STRUCT-01

`docs/code-organization.md` now defines two-space indentation, separate statements, visible multi-operation control flow, logical wrapping of conditions/arguments and readable SQL templates. It also explicitly requires transaction handles through data helpers while holding locks.

`scripts/source-style.ts` is a small guard using the already installed TypeScript parser. `bun run code:style` rejects adjacent statements collapsed onto one line in SourceFile/Block/switch-clause scopes. Seven explicitly adopted modules are checked in CI via `.github/workflows/verify-and-publish-preview.yml`. A focused unit test covers collapsed function/top-level/switch statements and verifies SQL literals, comments and for headers are not mistaken for adjacent statements. No formatter or production dependency was added.

Expanded compound operations in `src/lib/ui/shelves/discovery.svelte.ts` and `src/lib/reading/reader/load.ts`; tracking webhook emission now exposes its asynchronous import, event choice and arguments on separate lines. This preserves existing behavior and makes cancellation/transaction ownership reviewable. This incremental guard is not a whole-repository formatting certification, Svelte template linter or column limit. Legacy modules are adopted as they are actively edited; no broad unrelated churn.

## CROSS-03

`src/lib/core/lists/sequence.server.ts` now accepts an optional `Pick<Database, 'select' | 'execute'>` handle. Standalone reads retain their ordinary default. All three sequence queries performed under tracking account locks now pass `tx` in `src/lib/core/tracking/service.server.ts`:

- `applyChange` validates the exact sequence entry through the transaction.
- Bulk sequence scope expansion shares the transaction.
- Collection completion expansion shares the transaction.

This avoids acquiring an eleventh pooled connection behind nine same-account lock waiters, and ensures these queries see the current transaction's uncommitted writes. Existing UUID, permission, source idempotency, category and sequence identity rules are preserved.

Reviewed the full tracking service and sequence helper, plus tracking rewatch logic. Followed `warningFor`, projection and ancestor/collection refresh, `bulkTargets`, pure `rewatchBoundary`/`effectiveReleaseDate` SQL construction and deferred `emitWebhook(tx)`. All database work under these tracking locks now uses their transaction. Root's existing `getConfig(tx)` changes in core Reading, Reading sessions and bulk release-date tracking were inspected and retained. Every `sequenceEntries` caller was inventoried; nontracking playback/read-model callers were not changed. This is scoped call-path verification, not proof of all repository transaction behavior.

## Regression tests and verification

Added `tests/sequence-transaction-db.test.ts` for the existing disposable database runner. Three ordered liveness cases exercise single, bulk collection and bulk scoped-sequence tracking with all ten pool connections occupied by same-account transactions. An unrelated read is queued before releasing the first lock holder. All operations must complete within five seconds, without cancellation. An eight-second statement timeout on lock waiters bounds cleanup if the nested-pool regression returns. Every case checks completion and play count; single tracking also checks source-event idempotency. A fourth test requires the helper to see an uncommitted collection and edge through its supplied transaction.

- `bun run code:style`: **7 adopted modules pass**.
- Focused pure/regression import command: **8 pass, 4 database skips, 0 fail, 40 assertions** across source-style, Discover, reader and new sequence transaction files.
- Scoped tracked `git diff --check`: pass.
- Root's type check found a union-inference issue in the single duplicate test callback; corrected with a concrete `trackInTransaction` callback. Root owns the final shared type check.
- Database cases were **not executed by this subagent**; root's disposable DB runner includes the new suite.

Paths changed in this follow-up: `src/lib/core/lists/sequence.server.ts`, `src/lib/core/tracking/service.server.ts`, `src/lib/ui/shelves/discovery.svelte.ts`, `src/lib/reading/reader/load.ts`, `scripts/source-style.ts`, `tests/source-style.test.ts`, `tests/sequence-transaction-db.test.ts`, `docs/code-organization.md`, `package.json` and `.github/workflows/verify-and-publish-preview.yml`.

No database execution, global check/build, schema/social/auth/playback/queue edits, dependencies, commits or remote operations were performed by this subagent. Existing pending changes remain preserved.
