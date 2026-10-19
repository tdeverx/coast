# Performance and stability — follow-up roadmap

19 October 2026. The implementation pass and authorized Activity follow-up are closed. This is future work, resumed when selected by the user. Use the [action checklist](next-investigation-checklist.md); per-finding gaps remain in the [ledger](implementation-ledger.md) and [open alternatives](remaining-work-disposition.md).

Current counts: **33 implemented / 39 partial / 19 open / 3 other**, 94 canonical records; 74 source-applied and 15 additional observations. Broader auditing is incomplete.

## Resume order

Unchecked areas and newly observed issues first; failed methods afterward. Reconcile existing evidence before testing. Each batch names one shared owner, actual cohort, behavior/resource question and stopping condition. Actual admin controlled state is permitted on isolated actual-data copies; it is labeled separately from natural provider/production behavior.

## FUP-01 — Authenticated APIs and database paths

**Already checked:** Broad source/query proofs and selected actual handlers/routes exist. Latest bounded normal GET observations cover Tasks, three local Library media, inbox, Collection, Progress and lists.

**Still needed:** Complete session/public-bearer/share/API selector matrix; expiry/CSRF/cancellation, permitted/denied privacy and feature paths, natural error/status/header behavior and all remaining database owners.

**Next bounded step:** Use the131-family source checklist to map each real route/selector to existing evidence, then run missing actual cases in bounded batches. Distinguish stateful GETs and provider calls before execution.

**Acceptance:** Exact applicable response/status/order/privacy contract plus per-owner actual SQL/resource evidence, explicit missing cohorts and source fingerprints.

Evidence: [candidates/implementation-handoff/api-source-checklist/checklist.json](candidates/implementation-handoff/api-source-checklist/checklist.json), [evidence/runtime-breadth-api-finished.json](evidence/runtime-breadth-api-finished.json), [data-api.md](data-api.md).

## FUP-02 — Tasks and scheduler under active load

**Already checked:** History/index/read and terminal-write comparisons exist; selected pair unchanged. Isolated 32-call native Tasks attribution has exact source/SQL/DTOs and does not reproduce prior adverse timing. Natural active-job coverage remains absent.

**Still needed:** Natural pending/running/failed jobs, eligibility/claim, heartbeat/lease, yield/resume, retry/cancel, scheduler commits, concurrency, sustained throughput and CPU/memory.

**Next bounded step:** Refresh actual eligibility/active-job census; observe existing authorized jobs and compare claim/lease/retry/cancel semantics in a finite workload. Controlled real-admin state on a disposable actual copy is permitted when it exercises genuine native contracts; never fabricate provider replies or launch external imports merely for coverage.

**Acceptance:** Actual active-job lifecycle/ordering/checkpoint/lease/output correctness and resource measurements, with named side effects and independent cleanup.

Evidence: [candidates/implementation-handoff/tasks-active-coverage.md](candidates/implementation-handoff/tasks-active-coverage.md), [task-writer-cost-actual.md](task-writer-cost-actual.md), [task-history-index-matrix.md](task-history-index-matrix.md), [implementation-found-27.md](implementation-found-27.md).

## FUP-03 — Ordinary Listen and provider paging

**Already checked:** Shared Music snapshot/range binding and final-observation metadata repair are applied; bounded actual Library/dedicated Music and all-media range comparisons pass. Partial-source completeness/order choices remain unresolved.

**Still needed:** Additional genuinely connected first/middle/last pages, unequal sources, partial/short nonfinal source behavior, reconnect/generation/cancellation, queue/playback contexts and sustained resource costs.

**Next bounded step:** Capture a finite genuine connected-source paging trace at current source owners; separate legitimate partial/failure behavior and source order from the already adopted metadata/range binding.

**Acceptance:** Exact connection-scoped identity/order/total/page/failure behavior; no skipped intervals; preserve generation fences and account for committed observation writes.

Evidence: [candidates/implementation-handoff/listen-runtime-coverage.md](candidates/implementation-handoff/listen-runtime-coverage.md), [candidates/implementation-handoff/listen-metadata-candidate/adoption-notes.md](candidates/implementation-handoff/listen-metadata-candidate/adoption-notes.md), [implementation-music-snapshot-binding.md](implementation-music-snapshot-binding.md), [implementation-found-04.md](implementation-found-04.md), [implementation-found-13.md](implementation-found-13.md).

## FUP-04 — Reader, playback, native helpers and devices

**Already checked:** Shared cleanup/cancellation repairs and short actual CBR/audio/video journeys exist.

**Still needed:** Actual EPUB, additional formats/providers/codecs, FFmpeg/helper peaks and teardown, physical desktop/mobile/party clients, slow/hung transport and long sessions.

**Next bounded step:** Select actual saved files and existing permitted sources; profile open/minimize/resume/close and genuine failure/recovery without changing tracking or account settings merely to create a case.

**Acceptance:** Correct content/progress/lifecycle plus independently observed process/decoder/object-URL/CPU/RSS/heap/GPU release to the relevant platform scope.

Evidence: [implementation-playback.md](implementation-playback.md), [playback-readers.md](playback-readers.md), [implementation-artwork.md](implementation-artwork.md).

## FUP-05 — App-wide loading and sustained resource behavior

**Already checked:** Actual query CPU/memory and selected DOM/main-thread measurements exist; these are not whole-app capacity proof.

**Still needed:** Cold/warm startup, network/cache conditions, sustained browser/server memory, render/decoder/GPU work, background contention, concurrent users, long-soak and tail latency.

**Next bounded step:** Define bounded representative actual-data journeys and capture attributable browser/server/native profiles before changing budgets or architecture.

**Acceptance:** Repeatable source/environment/workload records with warm/cold and peak/retained distinctions, adverse samples and maintenance thresholds justified by observations.

Evidence: [README.md](README.md), [maintenance.md](maintenance.md), [implementation-public-seed.md](implementation-public-seed.md), [implementation-library-membership.md](implementation-library-membership.md).

## FUP-06 — Library retained ranges and shared client refresh

**Already checked:** Bounded Library/Collection range API/source/Shelf adoption is applied across all four media, with32actual range pairs,38actual-card buffer schedules,6current owner schedules/34reads,2normal Music pairs, actual20-page DOM plateau and Back/focus/release retry.

**Still needed:** Other source/cursor/complete-array contracts, natural multi-source/policy/provider races, positive active writes and sustained heap/CPU/GPU/decoded-memory/device acceptance remain separate. Historical prefix-reset chronology remains unproved; existing ranges now refresh atomically, with source-owned retry and engaged-card backpressure.

**Next bounded step:** Verify untested source/cursor/complete-array, multi-source and policy/provider races against the adopted bounded owner. Measure sustained heap/decoded memory and focus/Back under real contention; do not reimplement the superseded client or server-range prototypes.

**Acceptance:** Complete actual composed DTOs/ordering/admission and atomic current-owner publication, source-specific page semantics, bounded measured costs and signed-in acceptance.

Evidence: [library-server-range.md](library-server-range.md), [library-range-candidate.md](library-range-candidate.md), [library-append-trace.md](library-append-trace.md), [implementation-found-04.md](implementation-found-04.md), [implementation-found-04.json](implementation-found-04.json).

## FUP-07 — Remaining query, History, locking and write work

**Already checked:** Shared Progress predicate, Profile recorded History/count/page and adjacent-period reuse, public seed, Activity, no-op/import batching and narrow lock repairs are applied. Latest Activity policy-key repair passes repeated complete/visibility checks; named cases with no measured better option retain defaults.

**Still needed:** Other unmeasured query owners, future-history/growth pressure, remaining lock cycles, concurrent load/revocation, and residual small-read/CPU/output-size observations. Historical Progress2.34s figure predates later repairs and is not a current baseline.

**Next bounded step:** Collect a fresh actual current-owner profile for one remaining cost or lock cycle, with exact epoch and complete outputs. Prioritize the newly observed Jellyfin finalization deadlock; treat Tasks query/index work as a coordinated read/write decision, not an adopted regression.

**Acceptance:** Winning complete-contract/resource candidate, preserved lock/snapshot/ordering semantics and no hidden regression; source-only preparation is not acceptance.

Evidence: [implementation-library-membership.md](implementation-library-membership.md), [numbered-page-attribution.md](numbered-page-attribution.md), [remaining-work-disposition.md](remaining-work-disposition.md), [mutation-locks.md](mutation-locks.md), [implementation-found-03.md](implementation-found-03.md), [implementation-found-07.md](implementation-found-07.md), [implementation-found-14.md](implementation-found-14.md), [implementation-found-24.md](implementation-found-24.md), [implementation-found-26.md](implementation-found-26.md), [implementation-found-27.md](implementation-found-27.md).

## FUP-08 — Remaining actual-data, policy and failure acceptance

**Already checked:** Actual admin controlled-state tests positively cover named lists/repeated occurrences, recommendations, privacy/feature withdrawals and other scenarios; no fake catalogue/events/provider replies substituted. Twenty-two full Activity privacy/filter pairs pass.

**Still needed:** Specific remaining ledger cohorts: deep music/reading, actual EPUB, live parties/jobs, eligible toast/multi-window delivery, genuine provider failures and additional cross-medium/failure/concurrency combinations. Finite past acceptance does not cover every combination.

**Next bounded step:** Reconcile the exact ledger gap against existing evidence, then use actual natural inputs or clearly labeled controlled state over actual admin/catalogue identities in a disposable copy. Do not repeat already accepted named cohorts.

**Acceptance:** Complete identities/order/privacy/effects and restoration for the chosen case; distinguish controlled actual state from naturally observed production/provider behavior. No missing format/provider evidence is manufactured.

Evidence: [remaining-work-disposition.md](remaining-work-disposition.md), [implementation-toast-commit.md](implementation-toast-commit.md), [candidates/implementation-handoff/discovered-fix-disposition.md](candidates/implementation-handoff/discovered-fix-disposition.md), [admin-real-data-policy.md](admin-real-data-policy.md), [implementation-found-22.md](implementation-found-22.md), [implementation-found-27.md](implementation-found-27.md).

## FUP-09 — UI experiments, preview/chart budgets and companion

**Already checked:** Source/lifecycle checks, actual chart adapter measurements and encoded JPEG/PNG trials exist; conditional dense-chart and predecode methods were not justified/adopted. Companion crop cleanup is scoped. Comic Lab remained read-only.

**Still needed:** Actual runtime resource work for every experiment/material/chart/import, native companion crop limits/fallbacks, other input devices/browsers/assistive technology and long retained-card/menu/DOM lifetimes.

**Next bounded step:** Select finite actual workloads at existing owners. Preserve approved appearance; review any input/mark/image/process budget or retention-policy change before implementation. Comic Lab remains read-only unless separately authorized.

**Acceptance:** Actual render/input/lifecycle and measured CPU/heap/native/GPU behavior with truthful model bounds and no silent truncation or unsupported platform claim.

Evidence: [ui-preview-platform.md](ui-preview-platform.md), [ui-second-pass.md](ui-second-pass.md), [implementation-plugin-crop.md](implementation-plugin-crop.md), [comic-lab-follow-up.md](comic-lab-follow-up.md), [implementation-found-26.md](implementation-found-26.md).

## Explicitly deferred or rejected

- PR-02 durable playback recovery and PJ-15 bulk-task receipts: [user-deferred designs](candidates/recovery-bulk-contracts/README.md). No storage/retry/continuation contract adopted.
- Failed, mixed or contract-incompatible methods: [backlog](failed-method-backlog.md). Retain defaults; a keep-current outcome is valid.
- Newly observed interest ordering, Continue Undo race and Jellyfin finalization deadlock: [ordered checklist](next-investigation-checklist.md). They remain separate from implemented optimization portions.
- Comic Lab remains read-only; budget, policy, visible ordering or source behavior changes need a concrete reviewed choice when they materially change the contract.

## Evidence and drift

Latest application gates:844 passed /716 guarded skips /0failures, plus type/build/inventory/style. No runtime rerun is claimed for documentation housekeeping. Actual native/browser acceptance is separate. [Latest Activity](implementation-found-27.md), [original comparison](final-original-comparison.md), [current source/artifact integrity](evidence/housekeeping-integrity.json).

Pre-housekeeping rolling summaries are preserved in [history](history/closeout-2026-10-19/manifest.json). Their old candidate/adoption status and natural-only assumptions are superseded here.
