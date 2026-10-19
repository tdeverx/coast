# Next investigation checklist

19 October 2026. **Future work: start only when the user resumes investigation.** The safe prescribed-method execution pass is closed; this checklist is not a claim that all findings are complete. [Current handoff](implementation-handoff.md), [roadmap](follow-up-roadmap.md), [machine checklist](next-investigation-checklist.json).

## Before each batch

- [ ] Inspect current diff/source and database object epochs; reconcile old evidence to the current shared owner.
- [ ] Select one issue/area, actual cohort, expected behavior/resource question and stopping condition.
- [ ] Use actual admin/catalogue data. Controlled private-copy state is allowed; label it and restore it. No fabricated catalogue/events/provider responses.
- [ ] Document stateful GET/provider effects and required existing authorizations; do independent preparation before any new approval need.

## Newly observed correctness issues

These were observed during the pass and remain unresolved. Inspect them before trying rejected optimization alternatives.

- [ ] **JELLYFIN-FINALIZATION-DEADLOCK-OBS-15** — Trace the reproduced finalization/manual-enqueue lock cycle at native owners; retain original/candidate failure evidence, propose smallest lock-order fix, then verify concurrent schedule and ordinary effects on an actual-data copy. [implementation-found-24.md](implementation-found-24.md).
- [ ] **CONTINUE-UNDO-RACE-OBS-14** — Establish intended post-snapshot enqueue/Undo recovery behavior and reproduce at native owners on retained actual data; optimize only after the correctness contract is explicit. [implementation-found-22.md](implementation-found-22.md).
- [ ] **INTEREST-ORDER-01** — Define the full feed ordering contract, then verify the reverted deterministic-input candidate through actual feed/provider callers and include extra sorting cost. [implementation-found-20.md](implementation-found-20.md).

## Unchecked or incomplete areas

Each entry means the stated remaining scope, not a repeat of all work in that area. The roadmap records already checked portions.

- [ ] **FUP-01** — Use the131-family source checklist to map each real route/selector to existing evidence, then run missing actual cases in bounded batches. Distinguish stateful GETs and provider calls before execution. [Acceptance and prior evidence](follow-up-roadmap.md#fup-01--authenticated-apis-and-database-paths).
- [ ] **FUP-02** — Refresh actual eligibility/active-job census; observe existing authorized jobs and compare claim/lease/retry/cancel semantics in a finite workload. Controlled real-admin state on a disposable actual copy is permitted when it exercises genuine native contracts; never fabricate provider replies or launch external imports merely for coverage. [Acceptance and prior evidence](follow-up-roadmap.md#fup-02--tasks-and-scheduler-under-active-load).
- [ ] **FUP-03** — Capture a finite genuine connected-source paging trace at current source owners; separate legitimate partial/failure behavior and source order from the already adopted metadata/range binding. [Acceptance and prior evidence](follow-up-roadmap.md#fup-03--ordinary-listen-and-provider-paging).
- [ ] **FUP-04** — Select actual saved files and existing permitted sources; profile open/minimize/resume/close and genuine failure/recovery without changing tracking or account settings merely to create a case. [Acceptance and prior evidence](follow-up-roadmap.md#fup-04--reader-playback-native-helpers-and-devices).
- [ ] **FUP-05** — Define bounded representative actual-data journeys and capture attributable browser/server/native profiles before changing budgets or architecture. [Acceptance and prior evidence](follow-up-roadmap.md#fup-05--app-wide-loading-and-sustained-resource-behavior).
- [ ] **FUP-06** — Verify untested source/cursor/complete-array, multi-source and policy/provider races against the adopted bounded owner. Measure sustained heap/decoded memory and focus/Back under real contention; do not reimplement the superseded client or server-range prototypes. [Acceptance and prior evidence](follow-up-roadmap.md#fup-06--library-retained-ranges-and-shared-client-refresh).
- [ ] **FUP-07** — Collect a fresh actual current-owner profile for one remaining cost or lock cycle, with exact epoch and complete outputs. Prioritize the newly observed Jellyfin finalization deadlock; treat Tasks query/index work as a coordinated read/write decision, not an adopted regression. [Acceptance and prior evidence](follow-up-roadmap.md#fup-07--remaining-query-history-locking-and-write-work).
- [ ] **FUP-08** — Reconcile the exact ledger gap against existing evidence, then use actual natural inputs or clearly labeled controlled state over actual admin/catalogue identities in a disposable copy. Do not repeat already accepted named cohorts. [Acceptance and prior evidence](follow-up-roadmap.md#fup-08--remaining-actual-data-policy-and-failure-acceptance).
- [ ] **FUP-09** — Select finite actual workloads at existing owners. Preserve approved appearance; review any input/mark/image/process budget or retention-policy change before implementation. Comic Lab remains read-only unless separately authorized. [Acceptance and prior evidence](follow-up-roadmap.md#fup-09--ui-experiments-previewchart-budgets-and-companion).

## Later options and design decisions

- [ ] After unchecked work, revisit the [13 failed/mixed methods](failed-method-backlog.md) only where fresh evidence makes another attempt worthwhile. Preserve defaults and original failures.
- [ ] Resume **PR-02 / PJ-15** only after a new explicit design decision: [durable recovery and bulk-task receipts](candidates/recovery-bulk-contracts/README.md).
- [ ] Reconcile remaining partial/open records with the [full ledger](implementation-ledger.md) and [19 open alternatives](remaining-work-disposition.md); the headline counts are not a substitute for their exact acceptance.
- [ ] Revisit residual original/current small-read/CPU/generated-output observations with isolated attribution. Activity was repaired; unchanged-source Tasks did not reproduce its slowdown. [Original samples](final-original-comparison.md), [later attribution](implementation-found-27.md).

## Complete each batch

- [ ] Record immutable baseline/current source, actual input provenance, environment/object epoch and all samples/errors.
- [ ] Compare complete identities/order/counts/privacy/effects, native owner integration and relevant cancellation/retry/concurrency.
- [ ] Measure repeatable resource work as well as latency; preserve adverse cases and separate CPU/RSS/heap/buffers/WAL/temp scopes.
- [ ] Adopt at the existing shared root only when evidence supports it; otherwise retain default and record outcome.
- [ ] Run proportionate focused plus required integration gates; restore/drop owned test state and verify cleanup.
- [ ] Update docs/performance.md, ledger, exact remaining checklist and source/artifact integrity; do not promote missing acceptance.

## Evidence storage

Keep actual private DTOs, credentials, content and restore checkpoints out of repository documentation. Safe metrics/hashes, source/protocol snapshots and rejected trials stay attributable. Housekeeping removed reproducible private dependency/build caches; recreate exact frozen installs/builds when reusing old staging scripts. Prefer maintained repository tests to ephemeral scratch launchers. [Retention record](housekeeping-closeout.md).
