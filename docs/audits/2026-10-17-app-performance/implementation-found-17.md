# Shared Taste feature matching uses existence

Applied at `refreshTasteCaches`, the shared worker owner for every enabled medium. Its feature candidate CTE now asks whether each metadata row has a matching profile probe using `EXISTS`. It retains DISTINCT work IDs because several metadata providers can still witness the same work. No schema, index, dependency, cache/freshness policy, queue/index pair, score formula, checkpoint or publication/lease owner changes. [Exact patch](candidates/taste-candidate-admission/candidate.patch), [before/candidate manifest](candidates/taste-candidate-admission/source-manifest.json).

The old query joins each feature row to every matching probe, then removes duplicate work IDs. The consumer uses presence only: candidate eligibility and the boolean feature-priority term. EXISTS preserves that contract, including NULL predicates, medium matching and empty probe arrays. It can stop after a witness and avoids materializing/sorting all matching witness combinations. The original provider candidate precedence, genre fallback/precedence, negative/tracked/evidence exclusion, medium partitions, release-date/ID ordering and 500-per-medium rank cap remain byte-for-byte unchanged outside the replaced feature CTE. A match count or per-witness consumer would require a different query; this is not a blanket rewrite of joins.

## Actual data and performance

The [first proof](evidence/implementation-found-17-actual.json) and [adopted-source reproduction](evidence/implementation-found-17-adopted-actual.json) each use all four existing enabled actual owners in READ ONLY repeatable-read with JIT off, 30-second statement and 1-second lock budgets. The exact worker prefix reads configuration, interest evidence, metadata, artist preferences, builds profiles/probes, selects candidates, loads candidate features and computes every pure score. It stops before publication/lease/checkpoint mutations. No fake catalogue, user, job, provider page or feature is seeded; external fetches are forbidden and remain zero.

Complete evidence, profiles, ordered candidate rows and every computed score/breakdown match. Native tag results equal compiled parameter-bound replay; parameter arrays match between variants. Each owner returns 1,636/1,500/1,500/1,176 candidates and the same number of scores. Six complete query runs per variant/owner include native invocation, bound replay, a plan and three alternating warm repeats; these are repeated schedules on one actual population, not independent cohorts. The reproduction also checks exact input/profile dependency hashes before/after and runtime-module/transaction/pool cleanup.

| Actual owner ordinal | Complete candidates/scores | Root shared hit+read visits | Alternating warm SQL median ms |
| --- | --- | --- | --- |
| 0 | 1,636 | 9,822 → 9,822 | 104.00 → 97.06 |
| 1 | 1,500 | 9,909 → 9,867 | 125.19 → 120.98 |
| 2 | 1,500 | 10,073 → 10,062 | 112.88 → 103.94 |
| 3 | 1,176 | 10,198 → 10,087 | 127.01 → 117.69 |

The adopted reproduction has fewer buffer visits for three owners and equal visits for one. First-run visits fall for all four. Both runs improve all four three-pair warm medians; individual adverse EXPLAIN/timing samples remain retained, and two successive local runs are not production tail/CPU evidence. Neither plan spills in these observations. Parallel-worker/cache variation can affect aggregate buffer observations; the small differences are not independent additive savings. The plan now uses a Semi join for feature witnesses; the broader metadata/media scan remains. No numerical heap/RSS or whole-job speed claim is made.

## Gates, scope and drift

[Applied-source gates](evidence/implementation-found-17-gates.json) pass 844 tests / 715 guarded skips / 0 failures / 34,242 assertions, type 0 errors / 0 warnings, production build/navigation drift, source/UI inventory and style. Type/build use a source-identical isolated overlay to preserve the running normal dev cache. No normal Taste refresh or provider command is submitted. Browser acceptance is not claimed for a worker SQL-only change; the exact actual read/scoring owner is the consumer proof.

PLAN-03 advances from open to partial actual-data verified. The earlier staleness split remains rejected; its results and immutable source epochs stay in [Taste measurement](taste-query-measurement.md). Whole-worker publication, leases, checkpoint/restart, concurrent revisions, natural disabled/withdrawn policies, book candidates and larger feature/provider populations remain unverified. These are remaining acceptance and broader performance work, not a reason to mislabel the read-prefix proof as a completed job.

The [maintained actual probe](probes/taste-candidate-admission-real.ts) compares the archived before source to the exact candidate and permits only the recorded before/adopted runtime epochs. If owner or dependencies drift, prepare a new reviewed source epoch and repeat complete selections/scores plus plans and alternating samples; do not refresh hashes and assume old timings still apply. Keep this semantic rule in [performance.md](../../performance.md#use-existence-for-membership-witnesses). No commit, push, PR or deployment.
