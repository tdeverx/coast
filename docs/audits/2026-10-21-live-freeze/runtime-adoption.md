# Bun 1.4.4 source adoption — 21 October 2026

The user explicitly selected Bun 1.4.4 after the SQL retention investigation. **This changes source/build configuration; it does not deploy or restart normal dev or live.** Other dependencies remain at their locked versions. Stable Bun is still 1.4.3; the selected release is a prerelease.

## Selected artifact

- Runtime: **1.4.4-canary.1+6bb5dc195**.
- [Source commit](https://github.com/oven-sh/bun/commit/6bb5dc1956505dd1113455f58d4757c924f3ad54): `6bb5dc1956505dd1113455f58d4757c924f3ad54`.
- Official multi-platform image: `oven/bun:canary-debian@sha256:8902bf25498a9ac3c75ce0d5c8f87771d113ea5a1bd75084bdaa82bf70ab7ab1`.
- GitHub comparison verifies this source is 25 commits after the [upstream SQL fix](https://github.com/oven-sh/bun/commit/017b2439a7a75c82c7a86a294badd8ef2fc30e28).

Docker uses one pinned runtime stage for both build and production dependency installation. All three CI verification jobs extract Bun from that same digest and assert the exact revision. This avoids a rolling canary install and avoids claiming that the setup action can install an unpublished stable 1.4.4 tag. `packageManager` records the selected prerelease; `engines` permits its canary series and later releases. CI and image pins enforce the exact shipping revision.

The official GitHub canary download currently supplies **1.4.4-canary.1+963452075**, a newer revision than Docker. The original [research measurements](research-followup.md) belong to that revision on Linux ARM64/PostgreSQL 15.19. The new acceptance below belongs to the selected Docker image on **current-main application source** and PostgreSQL **17.11**. Keep the receipts separate. A macOS frozen-lockfile check using the newer revision also passes, with no lockfile/dependency changes.

## Acceptance

[Machine-readable actual-data receipt](runtime-adoption-verification.json) retains the selected revision, image digests, harness hashes and raw measured results. The disposable database was restored from the previously approved actual catalogue checkpoint. Only the media/metadata tables and their primary keys were restored; other indexes, foreign keys, triggers and provider/user data were not restored. Available rows: 145,803 media and 180,909 metadata. Probes select the same **8,000 complete media rows and 32 complete metadata rows** as the prior work, verify their complete hashes, and modify only the disposable database/temporary tables.

- Native JSON binding, full row round trips, typed arrays, fixed/varied reads, transaction rollback and reserved advisory-lock ownership pass. All five prepared/unprepared/codec schedules pass; the historical stable unprepared-JSON failure no longer occurs.
- Eight rotated real-data batch cycles (64,000 total inserts) pass complete ordered equality. Backend context allocation goes from **6.45 MiB after cycle 1 to 10.62 MiB after cycle 8**, consistent with the bounded behavior in the newer revision. This is an acceptance sample, not a new production memory forecast or a fresh stable-versus-canary benchmark.
- Statement counts after 1,100, 1,500 and 2,200 controlled real-row projection shapes remain **1,024**. Number/text/NULL reuse, 80 concurrent projections, cancelled queries retaining advisory reservations and rejection of an aborted transaction pass.
- Frozen lockfile installation, maintained navigation patch check, production Svelte build, adapter output and native extractor compilation pass in the selected Linux ARM64 build.
- Code/UI inventories and source style pass. Svelte type checking reports **zero errors and warnings**.

Supplementary unit/native-reader verification: **895 passed, 718 guarded skips, zero failures**, across 299 files / 34,476 assertions. The initial run skipped 21 native checks because the executable was not at the default test path; enabling the already built extractor resolved those skips. Existing DB/provider/actual-file guards remain explicit; unit fixture results do not replace the actual-data checks above. The final production image also builds successfully, starts with a fresh bundled database and returns health **200**, reporting the exact selected runtime revision. The disposable container stops successfully and reports stopped. Workflow YAML syntax and whitespace checks pass. The copied actual-data database and temporary checkpoint copy were deleted; the original approved checkpoint remains intact.

## Remaining limits and maintenance

No live account or task backlog is mutated, no provider requests are dispatched by these SQL probes, and no running installation is updated. Pool settings stay at the existing ten connections with idle/lifetime retirement disabled; no unprepared mode or JSON codec workaround is adopted.

Native AMD64 runtime/database/image execution remains for CI. A full actual mixed-provider/task soak, both supported PostgreSQL majors against the selected revision, long-duration guest memory observation and checkpointed installation rollout remain acceptance work. Earlier lifetime and ten-session stress results were obtained with `963452075`; they are not relabelled as results for `6bb5dc195`. A capped statement count does not bound arbitrary plan bytes or prove the original frozen guest cannot recur.

When accepting a later stable build, update Dockerfile, workflow digest/revision assertion, package metadata and this record together; repeat the maintained actual-data probes plus the ordinary checks. Do not float either image or CI to `canary`, change connection retirement to compensate, or silently upgrade the patched SvelteKit dependency. The separate [dependency inventory](dependency-updates.md) lists available stable/preview candidates without adopting them.
