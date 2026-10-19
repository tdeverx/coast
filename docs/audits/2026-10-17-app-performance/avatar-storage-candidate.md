# Shared avatar storage — reviewed candidate

**The reviewed repair is adopted on normal dev after user approval.** Three actual inline avatars are converted, byte/settings/idempotence checks and signed-in/repeated consumers pass. DATA-09 is partial because whole-page network/resource and missing-format acceptance remain. See the [adoption receipt and limits](implementation-found-16.md). [Machine record](avatar-storage-candidate.json), [exact ten-file patch](candidates/avatar-storage/adoption.patch), [manifest](candidates/avatar-storage/adoption-manifest.json).

The candidate extends the existing GIF storage/permission owner to PNG/JPEG/WebP. It preserves original bytes, GIF frames, hashed URLs and admission limits, decodes once before the account lock, atomically installs a private file before publishing its URL, and checks current visibility and exact stored identity on every image request. It adds no production dependency, schema field, transcoding, cache or visual change. Existing consumers receive the same profile fields with a stored URL in place of inline bytes.

## Final actual data and lifecycle proof

The [direct-cleanup rollback proof](candidates/avatar-storage/direct-rollback-actual.json) uses four existing accounts and three saved WebP avatars. Complete profile/user/friend results, order and fields match except the intended exact avatar URL. Images retain identical bytes and eighteen self/other/guest checks preserve actual privacy. Replacement/removal denies the old URL. A real private filesystem obstruction prevents publication; an injected post-save cleanup fault preserves the acknowledgement and records a warning. Stored-URL warm saves do not update the row. Inspect/convert/repeat converts3then0. All102tables /1,864,145rows restore exactly; the normal database is untouched.

The [final real-commit proof](candidates/avatar-storage/full-lifecycle-commits-actual.json) passes eight checks on a fresh actual-data copy: actual writer lock waiting, denial before commit, exact bytes/acknowledgements after two commits, post-commit cleanup failure recovery, rollback after file installation before publication, partial conversion commit/restart, bounded orphan discovery and both real copied-account deletion paths. Its known underlying database failure is addressed by the separately verified [0064shared lifecycle repair](implementation-found-12.md); the earlier failed run remains retained.

Foreground cleanup now receives the previous asset identity captured under the existing account lock. It rechecks the current value under that lock and attempts at most four direct format paths, without enumerating the directory. The actual proof observes four unlink attempts for the obsolete identity, no removal of the current identity, and no deletion for another owner. A warm save does not search for unrelated orphans. Orphans from failed publication belong to bounded maintenance.

The background owner processes at most100directory entries per pass, holds one directory cursor, coalesces concurrent calls, distinguishes locked existing users from missing users, and closes its handle on completion/stop/failure. A held actual writer is skipped safely. A work-bound control with107temporary copies of actual image bytes takes two passes, preserves current assets and an unrelated sentinel, and releases the cursor. Those107files are authored boundary controls, not a natural scale cohort or a fabricated database population.

A separate single-flight pass runs from the existing maintenance timer so stalled avatar I/O cannot hold ordinary job scheduling open. No new timer, job or queue is added. It retries at the existing one-minute cadence while more work remains and otherwise waits an hour. Existing developer-mode policy is preserved, so operator `--prune` remains available there. The stalled-boundary regression remains in the shared maintenance test.

## Benefits, costs and remaining evidence

For one actual account the source session projection changes16,288→1,169JSONbytes,11,913→563gzipbytes and11,655→453Brotlibytes; its actual friends DTO changes29,441→1,391JSONbytes and21,255→582gzipbytes. Complete per-account measurements remain in the receipt, including unchanged session size for an account without an inline avatar. These are serialization proxies, not observed HTTP bytes, endpoint latency, CPU, heap or whole-page gains.

Private image GETs add fresh visibility/current-owner queries and up to four format/file checks, with the existing `private, no-store` policy. Initial image transfer/header/permission work can offset JSON savings. Cold/repeated browser costs have not been measured. There are no saved PNG/JPEG/GIF cohorts in this clone; actual shipped-PNG and invalid-input unit controls supplement the saved-WebP proof. No missing cohort is fabricated. Faults are thrown/controlled filesystem failures, not a claimed process-kill or power-loss experiment.

The earlier whole-directory candidate, attached-maintenance failure, declaration/binding errors and the original account-deletion backend loss remain archived. [The previous maintained candidate epoch](candidates/avatar-storage/before-direct-cleanup/avatar-storage-candidate.md) records its unfinished state. A passing final run does not relabel failed historical runs.

## Signed-in normal baseline

The existing normal5173Profile → Friends view remains authenticated and renders all three real friends. Its [baseline receipt](candidates/avatar-storage/normal-before.json) records eight loaded inline image elements, three distinct WebP sources and113,916DOM source characters, with no framework overlay or captured warnings/errors. These are DOM attribute counts, not heap allocations, decode counts or HTTP transfers. Friends is closed afterward and no profile/preference/provider/history command is submitted. This is before adoption, not acceptance of the candidate.

[Normal Friends before adoption (private verification image)](publication.md#private-verification-images)

## Concrete normal rollout proposal

Adopt the exact ten-file patch, preserving unrelated changes. It changes the existing storage/profile/stream/auth/maintenance owners, adds the operator conversion and three test-file changes, and removes the superseded GIF-only module. Run common gates, take a private normal database/avatar/source checkpoint, inspect the actual current inline cohort, apply the per-account locked conversion, repeat it to prove idempotence, and verify every real image/consumer in the already signed-in normal5173tab. Check cold/repeated image-request costs and preserve privacy. Stop and restore the checkpointed representation if acceptance fails.

The operator script requires explicit `--check`, `--apply` or `--prune`; there is no startup conversion. It publishes a URL only after installing its file, commits one account at a time, preserves every other settings field and resumes remaining accounts after failure. Migration0064has its own exact, standard-engine actual proof and requires a normal rollout too. Normal credential use must be explicitly scoped to these new operations and kept in memory; the earlier normal permission covered toast.

The candidate introduces a persistent file lifecycle, a bounded maintenance cursor and operator conversion. That is the concrete unavoidable-complexity decision under the supplied AGENTS.md rule; no new dependency is needed. The [latest gates](candidates/account-deletion/gates.json) pass844candidate tests /715guarded skips /0failures /34,242assertions, type0errors/0warnings, production build and inventories/style. Normal current-source tests separately pass841/715/0. The gates in this paragraph are the historical candidate epoch. Current adopted-source gates and normal rollout are recorded in [implementation-found-16.md](implementation-found-16.md). No commit, push, PR or deployment.

Current state: [approved adoption](implementation-found-16.md), including normal migration0064, three conversions followed by zero, and measured direct streams. Earlier before/adoption proposal text and all failed trials are retained as historical evidence.
