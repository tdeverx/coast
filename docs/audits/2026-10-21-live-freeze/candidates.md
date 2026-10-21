# Database retention: tested prevention options

The [further investigation](research-followup.md) supersedes the option ranking
below: an official Bun canary now verifies compatible statement reuse,
server-side eviction, native JSON and safe deferred connection retirement.
It is the preferred technical fix, with production adoption still gated on
release selection and full application acceptance. The original failed/successful
codec trials remain historical evidence.

This follows the [live incident](../2026-10-21-live-freeze.md). Kernel memory
exhaustion is established. The exact process allocations at the time of the
freeze were not captured, so the mechanism below is a reproduced contributor
candidate, not proof that it accounts for all of that incident's memory.

## Actual-data method

The existing approved catalogue checkpoint was reused; no new live catalogue,
user, credential or task export was made. Only media and metadata tables were
restored into `coast_freeze_probe_20261021`. The workload uses 8,000 actual media
rows and 32 actual metadata rows, with all fields retained in private memory.
It inserts 160 batches of 50 actual rows into session-local shadow tables, then
compares 300 variable-length ID reads with the same 300 typed-array reads.
Complete ordered row/metadata and ID-result hashes must agree. Rollback restores
the complete original rows; a reserved session retains its advisory lock.

The primary run uses the **exact deployed image digest**, Linux ARM64, Bun 1.4.3
and PostgreSQL 15.19 in a separate two-vCPU, one-GiB VM. Coast's application
entrypoint is replaced with sleep: no application workers or live volumes are
present. PostgreSQL listens on a private Unix socket only. The earlier
PostgreSQL 17.11 run is supplementary. Both use JIT off, one client connection,
the original media-ID primary key and a three-second statement deadline.

The [maintained probe](verify-prepared.ts) receives connection options through
stdin and refuses another database name. Its absolute `/app` schema import is
intentional: run it inside the matching image, not as a normal repository test.
The candidate changes only the in-process test column encoder and restores it
after each trial. It does not change application files or database schema.

Use [the matching-runtime receipt](prepared-verification-pg15.json) as acceptance
evidence; it contains the harness hash and complete result hashes, not row data.
The [earlier PG17 receipt](prepared-verification.json) is the predecessor test
epoch, before the final stronger fixed-array and rollback equality assertions.

## Reproduced findings and outcomes

- Default prepared mode creates **160 named bulk statements for one distinct
  INSERT SQL text**. The nullable/type patterns of actual batches lead to
  separate retained statements. The test establishes the duplication; it does
  not establish the driver's ultimate eviction limit or indefinite growth.
- Varying the number of `IN` placeholders creates another 300 statement shapes.
  A typed `ANY` array creates one additional statement across the same 300
  memberships. Full ordered membership is checked, not only counts.
- The naive pool-wide `prepare: false` switch fails the actual metadata JSON
  insertion with SQLSTATE **22P02**. It is **rejected as a standalone fix**.
- A private unprepared candidate encodes the actual metadata object as a
  JSON-serialized **text parameter explicitly cast to JSONB**. This preserves
  all tested objects, catalogue nulls, dates, text arrays and complete results,
  as well as rollback and the reserved advisory lease. No SQL values are
  interpolated into query text.
- On matching PostgreSQL 15, default backend memory-context allocation is about
  **50 MiB**, versus about **6.1 MiB** for the candidate: approximately **88%
  lower for this workload**. This is PostgreSQL allocator-context memory, not
  whole-VM RSS, process PSS, JS heap or a production peak-memory prediction.
- All passing modes share identical complete media and metadata hashes. The
  JSON failure is retained in the receipt; it is not omitted from the outcome.

Two alternating default/candidate pairs are retained, with the rejected native
JSON switch between the first pair. The first default pass includes more cold
setup cost. Do not claim a general latency improvement from these few samples:
unprepared mode trades retained plans for repeated parsing/planning, which can
hurt frequently repeated expensive queries. In the final matching-runtime
pairs, the 300 fixed-array reads took 110.9/106.3 ms prepared versus 167.8/203.1
ms unprepared (about 51%/91% longer). This measured cost rules out calling the
candidate an improvement across the board. JS/client RSS is recorded but is
not a clean comparison: all trials share one Bun process and allocator history.

## Options and implementation boundary

1. **Bound shared driver statement retention while preserving native JSON.**
   This addresses the duplicate retention without changing every application's
   JSON contract. A suitable Bun fix/version must reproduce this exact test,
   plateau under longer varied actual workloads and preserve leases. Current
   runtime duplication is confirmed; no replacement runtime or maintained
   native patch has been selected. A native patch adds maintenance/distribution
   complexity and requires review/approval before adoption.
2. **Use unprepared queries with one consistent typed-JSON boundary.** The
   private candidate demonstrates a viable mechanism. Applying it only to the
   custom ORM JSONB column is incomplete: direct JSON parameters also occur in
   queue policy checks/checkpoints and maintenance. Inventory those callers and
   consolidate serialization at their shared owners, then verify native scalar
   JSON, strings, SQL NULL versus JSON null, arrays, rollback, concurrency,
   cancellation and all affected real-data workflows. Do not flip the pool
   setting independently of those repairs. No new dependency is needed for
   the demonstrated candidate.
3. **Reduce query-shape variation at existing shared data owners.** Typed arrays
   are verified here; use them where arbitrary ID cardinality currently
   expands placeholder text. This reduces distinct SQL shapes but does not fix
   the identical-bulk-text/type-pattern duplication by itself. Preserve actual
   membership, order, duplicate semantics and empty-input behavior per owner.
4. **Add a separate host-level failure boundary.** Guest shutdown deadlines
   cannot stop a kernel-starved VM. A reviewed host recovery/recorder design
   should preserve evidence and enforce a deadline around the management API
   itself. No persistent service was installed. Increasing memory, restarting
   periodically or blindly shortening connection lifetime does not establish
   a retention fix; active advisory reservations also need protection.

Start with the shared driver/codec decision, not per-route workarounds. The
candidate still needs complete raw-JSON caller coverage, repeated real worker
and interactive mixed-workload memory plateaus, query CPU/latency tradeoffs and
integration acceptance before any production adoption. The merged task query
repair should be evaluated in that workload too; its selector timing alone does
not certify memory stability.

Upstream context: [Bun prepared-statement behavior](https://bun.com/docs/runtime/sql#prepared-statements),
[reported duplicate cache signatures](https://github.com/oven-sh/bun/issues/28980)
and [PostgreSQL memory-context diagnostics](https://www.postgresql.org/docs/15/functions-admin.html#FUNCTIONS-ADMIN-SIGNAL).
These explain tools/options; the measured results above come from this actual
catalogue test.

## Failed setup attempts and cleanup

The first matching-PG15 check started before the streaming restore had finished
and failed because the cohort was absent. It is not a product result. The slow
interactive transfer was cancelled; its lingering COPY session blocked a test
DROP until that disposable session was terminated. A compressed, minimal cohort
transfer then restored exactly 8,000/32 rows before verification. PostgreSQL
17's unsupported `SET transaction_timeout = 0` header was omitted when restoring
to 15; no data values were changed.

Both disposable databases, the extra VM and compressed/generated raw test files
are removed after retaining aggregate receipts. The approved source checkpoint
and original incident logs remain private. No production pool, codec, task or
provider code was changed or deployed by this investigation.
