# Shared task repairs — implementation and acceptance

This follows the [original audit](README.md), against `9575de2cdec348f39d50bf812d960df52817007d`. It implements the safe shared methods below. It does **not** complete every audit acceptance plan or deploy changes to live. The follow-up PR was initially requested unmerged; the latest instruction authorizes merging only after CI and final-head Codex code/security reviews are clear. PR #44 was already merged externally when this work resumed, so these task repairs belong in a separate PR.

## What changed and what is still open

| Finding | Implemented method | Verified boundary / remainder |
| --- | --- | --- |
| TA-01 | One dependency policy for item/list/request effects; observations pass unsent mutations; unknown/bulk effects remain conservative; running workers retain account exclusion. | All 13,095 scoped active rows agree with an independent ordered reference. 4,078 later observations and 8,993 unrelated mutations pass earlier unrelated work; 14 same-effect blockers remain. Controlled running/generation checks pass. Natural Trakt/list/history mutation delivery remains absent. |
| TA-02 | Compute dependency heads once with ordered windows; reuse them for worker selection and task representatives. Keep scalar lookup only for bounded detail explanations. | Three alternating warm pairs on the exact 118,586-row export: median **10,004.389 → 170.749 ms**. Row-locking SELECT executes. This excludes recovery/admission UPDATEs, full claims, lock contention and provider work. |
| TA-03 | A reading-item 404/410 withdraws only that authenticated account's matching file and records a deferral; siblings continue. Other errors still fail. Delta checkpoints retain deferred totals. | Actual missing ID from a failed live batch plus an accessible Jellyfin sibling: original aborts; candidate checks both, defers one and admits the sibling. Permission/reset/repeated feed-delivery schedules remain follow-up acceptance. |
| TA-04 | Needs attention takes precedence over running/waiting without duplicating cards. | Actual metadata replay exposes all four terminal-failure groups; the review regression reproduces a fresh representative hiding a 57-attempt backed-off job, then verifies two pending jobs and exactly one aggregate attention count; normal-dev desktop/narrow task details pass. Normal dev has no active queue, so this is not rendered mixed-state browser acceptance. |
| TA-05 | Run now distinguishes healthy queued/running rows from failed jobs needing Retry/review. | Controlled failures on existing actual admin Seerr and taste jobs: failure/attempt/checkpoint remain intact; failed jobs are not counted healthy. Other scheduler families lack natural failed execution cohorts. |
| TA-06 | Explicit **up to 100** targets per command, 101-row lookahead, canonical per-job mutation and a truthful more-remain result. Already promoted jobs leave subsequent batches; canonical retry conflicts are excluded before the bound and reported separately. | Existing actual admin jobs: promotion 100/100/2, cancellation 100/100/1; running job retained; retry deadlines/attempts/checkpoints/history preserved. A controlled 201-row blocked prefix does not hide another actual account’s eligible retry. This is bounded selection, **not** a durable all-target command or prefix receipt. Unexpected errors can still leave a committed prefix. |
| TA-07 | Positive reading access runs before screen/history/music traversal with a scan-bound per-job cursor. Complete-census negative publication retains its existing fences. Public job progress reads the prepass cursor; underlying traversal progress stays separate. | Held screen traversal: original admits zero; candidate admits five actual reading works then yields; reading history unchanged. Reading failure can now delay the remaining scan; full independent medium scheduling remains deferred. Screen access-proof reads still precede this prepass. |
| TA-08 | No Trakt continuation/receipt redesign adopted. | No connected Trakt account or natural large-write cohort. The user explicitly chose follow-up; real-account design/acceptance remains on that backlog. No new storage/receipt complexity is introduced speculatively. |
| TA-09 | Pending retries with at least three attempts and a classified failure appear in Attention; local provider-capacity waits are excluded. Automatic retry behavior stays intact. The shared retry threshold and SQL aggregate attention count cover every pending job; the displayed representative carries the failing context. | Actual 57-attempt IGDB representative moves to Attention and remains pending/retryable. Its provider root cause and recovery-after-restoration are not established. Three matches the existing notice threshold; no new retry cutoff is imposed. |
| TA-10 | Preserve typed adapter denial codes through the shared wrapper and map stable remedies. | Supplemental permission/identity/invalid-request guards pass. Natural typed adapter-denial execution is absent; this is not claimed as actual-provider acceptance. |
| TA-11 | Retain bounded stage/path/type context on the task, without rejected values or arbitrary dynamic keys. | Supplemental privacy guard caught and closed a record-key leak. Only a closed set of public schema field names survives; unknown keys become `*`. No malformed actual provider response was fabricated to claim acceptance. |
| TA-12 | Preserve recoverable snapshots/stages; expire only succeeded/cancelled jobs. Missing Seerr partial-page snapshot restarts a new census. | Actual nine-request Seerr page: fresh epoch/checkpoint; aged real-response snapshot retained for pending/failed and expired after success. Trakt staging cohort absent. **Correction:** Steam already ignores its saved cursor when its snapshot is missing; that original suspicion was false and is not counted as a repair. |
| TA-13 | Share the feature-transition predicate; show connection/generation and dependency reasons; expose an account blocker link only for account-order waits. | Scalar/worker blocker boolean parity on 250 actual representatives; running/generation/pause controls pass. Positive feature-transition blockage and all primary-gate precedence combinations remain follow-up acceptance. Legacy null generations no longer falsely imply a connection mismatch in the explanation. |
| TA-14 | Retain companion checked totals with page acknowledgement; retain delta deferrals; forward existing Trakt import applied/review outcomes; label Jellyfin counts as screen records. | Existing guards pass; native missing-file outcome passes. A genuine resumed multi-page companion run and Trakt export/projection/request-management outcome parity remain unverified/partial. |

Code for a method and complete acceptance of a finding are separate statuses. Do not turn this table into a “14/14 fixed” claim. Unchecked app areas remain in the earlier [investigation checklist](../2026-10-17-app-performance/next-investigation-checklist.md).

## Measurements and costs

The selection comparison uses approved **actual live task, connection and instance rows** in session-local shadow tables on a disposable actual-catalogue restore. It excludes webhook payloads and credentials. Both variants use the same transaction snapshot, controlled developer-mode-off setting, Bun 1.4.3 pool with PostgreSQL JIT off, indexes copied from the real outbox schema, one untimed warm-up each and three alternating original/candidate pairs. No extra index was added.

| Pair | Original ms | Candidate ms |
| --- | ---: | ---: |
| 1 | 9,192.351 | 164.779 |
| 2 | 10,004.389 | 170.749 |
| 3 | 10,494.315 | 181.469 |

The median selection reduction is **98.29%**. Original block visits per timed probe: 4,510,002 local hits + 52,355 local reads + zero shared hits. Candidate: 2,717 local hits + 51,324 local reads + 13 shared hits. These are **temporary-table local buffers**, not production shared-buffer figures; filesystem cache can satisfy local reads. Neither plan spills sort work to temporary blocks in these samples. Four ordered windows trade sorting/working memory for the repeated account scans. No full-claim WAL/lock-wait/process-memory comparison or production p95 is claimed.

The selector intentionally admits more unrelated work, so the original and new selected identities are not an output-equality comparison. Correctness is checked against the new explicit conflict contract. The full scoped blocked set matches an independent real-row reference, while scalar/presentation parity is sampled on 250 rows. Live playback-session and sync-checkpoint parents were **not** copied: missing playback parents make those scrobbles conservatively whole-account; unmatched bootstrap checkpoints affect urgency context. These limits prevent calling this an exact full-worker replay. No additional live user export was needed for these narrow SQL tests.

Other costs are deliberate: recoverable failed snapshots now remain until resolved/cancelled; retention still deletes at most 500 per table/pass. The reading prepass changes phase order rather than isolating every medium. Bulk commands bound work but retain separate per-target transactions. Pending failure visibility does not cure the upstream outage. Diagnostics retain at most 12 issues × 12 path segments, a stage of at most 40 characters and closed expected/type labels; extend `diagnosticFieldNames` only with public schema names, never provider-supplied keys.

## Retained failed/adverse trials

- The first dependency-head join passed membership checks but still took roughly 9.15–9.21 s. Its merge plan compared about 108 million same-account pairs before checking effect scope. Replaced with ordered windows; no planner switches or speculative index.
- Early window variants failed the real-row oracle because NULL ordering and a missing wildcard-ID guard could hide a same-effect blocker. Both were corrected before adoption. The complete real-row oracle then passed.
- The private harness initially double-encoded JSON, projected too few columns for scalar parity, and bound a SQL text array incorrectly. These were instrumentation failures, not application passes. The maintained harness passes after correction.
- An initial direct reading call was stopped after about 2m38s because it lacked a worker execution context and therefore had no cooperative yield budget. The maintained test uses the actual copied job and normal five-boundary context.
- A new supplemental privacy test demonstrated that Valibot dynamic record keys could survive the first path sanitizer. The closed field-name allowlist fixes it; the failed trial is not omitted.
- Codex code review found that a fresh eligible representative could hide another pending job in backoff. Aggregate attention counts and failure-first display ranking now preserve the complete totals; an original-vs-candidate actual-job replay passes. UUID keys are normalized so equivalent spellings cannot split one work’s conflict scope.
- The first CI database matrix exposed a Run-now existing-active/newly-queued count regression. The established contract was restored; native actual-account and existing database guards pass. Recovery/retention guards now assert the intended prepass cursor, held screen-page boundary and terminal-only expiry instead of obsolete phase/policy locations.
- Final source review found that the first bounded retry candidate could repeatedly select a blocked prefix. Selection now shares the canonical retry-conflict predicate, and an actual-copy 201-blocked/one-eligible schedule passes. The UI reports blocked failures separately.
- The browser harness initially looked for an incorrect “Tasks” heading; the actual heading is “Queue”. The corrected journey passed without app errors. Normal-dev active/mixed-state coverage remains absent.

## Reproduction and evidence

[verification.json](verification.json) records aggregate results, private input/plan hashes and maintained source hashes. The original [evidence.json](evidence.json) remains the initial audit receipt, not post-fix evidence. Raw IDs, payloads, provider responses, plans and authenticated screenshots are not committed.

Use the approved actual-data policy. Inject the disposable connection in memory; never print/save it. All native mutation scripts refuse a database other than `coast_reading_audit_tasks_20261020`. They require existing actual admin/provider/task cohorts and fail when absent. No workers are launched. Run resource measurements alone.

| Maintained check | Invocation from repository root |
| --- | --- |
| Generate original/current read-only selector | `bun docs/audits/2026-10-20-task-system/selection-sql.ts [9575de2]` |
| Exact exported backlog, ordered reference, gates and timing | `bun docs/audits/2026-10-20-task-system/verify-backlog.ts` (`COAST_AUDIT_CORRECTNESS_ONLY=1` skips timings) |
| Actual missing-file/sibling and held-screen comparison | `bun docs/audits/2026-10-20-task-system/verify-reading.ts` |
| Existing actual admin bulk rows | `bun docs/audits/2026-10-20-task-system/verify-controls.ts` |
| Genuine Seerr page, missing snapshot and retention | `bun docs/audits/2026-10-20-task-system/verify-seerr.ts` |
| Failed provider/taste scheduling results | `bun docs/audits/2026-10-20-task-system/verify-run-now.ts` |
| Mixed pending representative / UUID identity regression | `bun docs/audits/2026-10-20-task-system/verify-attention.ts` |
| Offline actual metadata presentation | `bun docs/audits/2026-10-20-task-system/verify-presentation.ts` |

The default private input directory is `.data/task-audit-20261020/`; the backlog script also accepts `COAST_TASK_AUDIT_DATA` with a trailing slash. Selection generation deliberately omits claim recovery and mutation. The earlier `verify-actual-tasks.ts` is a **historical finding reproducer for the original source**: its failure-exclusion assertions are supposed to fail after this repair. Use `verify-presentation.ts` for current acceptance.

The initial comparison used 118,104 rows (median 9,384.044→168.700 ms); the table above is the final reviewed query on a refreshed 118,586-row export. Both epochs are retained in the receipt.

After native verification, delete the newly approved implementation exports and disposable database. Keep the earlier approved source catalogue checkpoint and the original audit's narrow historical receipts. Future reruns need fresh explicit authorization for live exports. Tests do not authorize deployment or operating live tasks.

## Remaining investigation / acceptance checklist

- [ ] Full claim/admission/recovery and concurrent-worker lock/WAL comparison with complete real identity/session/checkpoint context, without dispatching live mutations.
- [ ] Real Trakt large list/collection/history continuation design, provider account and delayed-delivery/restart acceptance (TA-08); natural typed denials and complete outcomes (TA-10/14).
- [ ] Primary-gate feature-transition/priority/cooldown combinations and rendered mixed active/failure browser state (TA-04/13).
- [ ] Missing reading permissions, account withdrawal and repeated companion feed-page delivery; resumed multi-page checked totals (TA-03/14).
- [ ] Reading prepass adverse/failing input and independent media progress options (TA-07).
- [ ] Unexpected bulk-command failure/disconnect after a committed prefix; durable receipts remain the separate deferred design if product scope requires them (TA-06).
- [ ] Explain the persistent IGDB provider interruption, then test genuine service restoration without resetting its retry evidence (TA-09).
- [ ] Natural Trakt staged-retention, other scheduler failure families and malformed actual-provider diagnostic acceptance (TA-05/11/12).
