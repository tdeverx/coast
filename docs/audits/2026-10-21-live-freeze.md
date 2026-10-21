# Live VM freeze, 21 October 2026

The initial 11:35–11:45 UTC investigation was read-only. The user subsequently
authorized a forced restart and investigation of prevention; recovery and
private actual-data comparisons are recorded below. No application update or
manual live-task mutation was performed. Times are UTC; add one hour for BST.

## Established findings

- Live container `coast` still advertises build
  `f7a3e3f71f1241a967106d5c6615726e965c3a5b` (PR #41), image digest
  `sha256:117fd211a847a3eaa88c00b9aac469a3cc2d9de9b2a8477dc6da31fc380a29f0`.
  Its 20 October 14:19 restart did not deploy PR #44 or PR #45. The merged task
  build is `64c28428a5ad83266ae6141f056274223cf9ebad`.
- Public HTTP timed out after 15 seconds. Direct host-port and guest-IP health
  probes each timed out after five seconds. Guest `exec` and resource `stats`
  did not return, while host-side container listing and inspection did.
- Host process arguments map runtime PID 52271 to `coast`; its VM process
  52273 consumed approximately 498–505% host CPU in two observations. This is
  a host VM counter, not an application CPU measurement.
- The host-retained guest kernel log records repeated page-allocation failures
  in PostgreSQL filesystem reads and the virtual network receive path.
  It reports zero swap and, in the final memory dump, unreclaimable pages.
  The immediate failure mechanism is severe guest memory exhaustion with
  memory-reclaim pressure and loss of guest responsiveness. The exact original
  allocation owner remains unproven.
- The last resource sample, 21 October 03:27:56.703, records container cgroup
  memory 4,155,531,264 / 4,294,967,296 bytes (96.8%), including 3,951,292,416
  anonymous bytes. Application RSS was 578,674,688 bytes (552 MiB), JS heap
  40,994,717 bytes and external memory 19,823,967 bytes. Whole-container
  anonymous memory must not be attributed to the application from these values.
- The sampled cgroup OOM and OOM-kill counters remain zero. The retained kernel
  log contains allocation failures but no OOM victim record. Memory exhaustion
  can prevent progress without a recorded OOM kill; zero kills do not certify
  memory health.
- Structured diagnostics stop at 03:28:36.875. PostgreSQL subsequently reports
  autovacuum workers taking too long to start or starting after their worker
  entry has gone. A checkpoint starts at 03:29:51 with no completion in the
  retained console log. These are additional signs of widespread starvation,
  not evidence of database corruption.
- A host `container stop coast` client is waiting. There is no new supervisor
  shutdown record after the successful 20 October shutdown. This does not prove
  whether the guest received a signal; it establishes that the application
  shutdown sequence has not recorded progress.

## Timeline and limits

Kernel monotonic timestamps are approximately anchored to its recorded boot
wall-clock time, 20 October 14:19:20; drift or later clock adjustments are not
independently measured.

| Approximate UTC | Evidence |
| --- | --- |
| 20 Oct 14:19 | Previous supervisor shutdown completed; old image restarted. |
| 20 Oct 18:59 | Cgroup memory 4.10 GB; anonymous memory 2.96 GB; app RSS 474 MB. |
| 20 Oct 22:16 | First retained PostgreSQL kernel page-allocation failure. |
| 20 Oct 23:49 | Another PostgreSQL allocation failure. |
| 21 Oct 01:19–01:41 | Network receive and PostgreSQL allocation failures; no swap. |
| 21 Oct 02:59 | Queue continuously busy about 58 minutes; heartbeat overlap count 36. |
| 21 Oct 03:27 | Last resource sample; heartbeat overlap count 99. |
| 21 Oct 03:28 | Last retained structured operation event. |
| 21 Oct 03:34 onward | Autovacuum worker startup warnings. |
| 21 Oct 11:36 | Host investigation: high VM CPU, guest commands and HTTP unresponsive. |

During the final retained sample interval in the 03:00 hour, application system
CPU grew about 1,299 seconds while user CPU grew 7.5 seconds. This supports a
kernel-heavy degradation; it does not identify a specific memory allocator.
Retained slow-operation records include reservation duration up to 883.5 seconds
and heartbeat duration up to 315.1 seconds. These are thresholded/retained events,
not a representative latency benchmark. A database deadlock was also logged at
03:05:58; its existence alone does not explain a guest-wide freeze.

## Why the previous shutdown repair did not resolve this

The supervisor bounds application/database shutdown while the guest kernel can
schedule its shell, timers and signals. It cannot enforce a host VM deadline
when the guest and its management service are starved. Previous clean shutdown
evidence demonstrates that code executing normally, not recovery from this
whole-guest failure. Separately, the latest task ordering/query repair is merged
but absent from this live image. Its private selection benchmark does not prove
that it prevents this incident's memory growth.

## Next actions, in order

1. Preserve bounded host kernel/console logs and safe runtime samples before any
   force recovery. A restart may replace container logs. Do not copy a running
   PostgreSQL volume and label it a valid backup, or mount it concurrently.
2. Recover through a controlled, operator-approved host VM procedure if the
   existing stop cannot finish. A forced VM stop interrupts PostgreSQL and
   requires crash recovery. Do not kill unrelated VMs or claim data integrity
   without checking recovery and database state afterward.
3. Once accessible, capture per-process PSS/private memory, PostgreSQL active
   backend/wait and memory-context summaries, configured memory limits, and
   guest memory-pressure counters. Collect no SQL values, provider secrets or
   personal rows in the report. The current sampler lacks these ownership
   measurements; process attribution is still open.
4. Verify the actual deployed build after a separately authorized update; image
   publication and a container restart do not establish deployment. Measure
   task completions and backlog movement over a timestamped interval.
5. Reproduce the old/new workload on a separately authorized disposable actual
   data copy with matched four-GiB constraints and sustained memory tracking.
   Do not rerun the heavy old selector against frozen live. Establish whether
   the task repair changes private memory growth, not only selection latency.
6. Review bounded per-operation database deadlines, heartbeat coalescing and
   memory headroom only against the ownership evidence. These are candidates,
   not implemented remedies. A persistent host watchdog/recorder is separate
   lifecycle complexity and needs a reviewed design and approval.

## Authorized recovery and subsequent investigation

Before recovery, 11 task-owned private evidence files (3,426,027 bytes) were
preserved with owner-only permissions under the ignored local data directory.
They include the original host-retained guest console/kernel logs and bounded
runtime files. Hashes are retained privately; raw operator logs are not committed.

`container stop --time 0 coast` still failed to return within 15 seconds. The
host process was revalidated by its executable and open Coast kernel/database
volume paths before terminating only VM PID 52273. Container state became
stopped, and `container start coast` succeeded at 11:47:20. No volumes were
replaced or mounted concurrently. The image/build remained the existing old
`f7a3e3f`; this was recovery, not deployment of PR #44/#45.

PostgreSQL logged REDO start/completion and readiness, with no PANIC/FATAL in the
new console. `pg_is_in_recovery()` returned false. Direct health returned 200
in 62 ms; public health returned 200 in 199 ms. These establish startup and
database connectivity, not exhaustive database-integrity certification.

At 11:47:50 the live queue had 180,877 succeeded, 9,979 pending and three running
tasks. At 11:53:31 it had 182,182 succeeded and 8,721 pending: **1,305 additional
successes in 5m40s**. Jellyfin reconcile, delta, library and other providers
completed work; this was not merely the frequent live-poll task succeeding.
No task attempts, retry deadlines or failure history were manually reset.
At the [final 12:08:25 check](2026-10-21-live-freeze/recovery-verification.json),
successes reached 186,137 and pending work fell to 4,851: 5,260 additional
successes since the first post-restart snapshot. Direct/public health remained
200. A zero-running snapshot occurred between completions, not a stalled queue.

Post-recovery process counters and one-off memory-context requests narrow the
investigation to database retention as a serious candidate. An early largest
backend had about 36 MiB private anonymous memory and 10.8 MB of PostgreSQL
contexts. A later largest backend had about 44 MiB private anonymous memory and
22.2 MB of contexts. These snapshots concern different backends and must not be
presented as one backend's context-growth rate. They do not retroactively
identify the frozen guest's original allocation owner.

The [candidate comparison](2026-10-21-live-freeze/candidates.md) records the
actual-data reproduction, rejected global-switch trial, matched-runtime results,
scope and required implementation acceptance. Production pool/JSON code remains
unchanged. Disposable test data and the extra test VM are removed after
verification; the original catalogue checkpoint and incident evidence remain
private. Prevention is not yet adopted or certified for a full worker lifetime.
