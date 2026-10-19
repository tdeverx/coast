# Shared query and browser lifetime changes

These are uncommitted implementations after the pinned audit. [The implementation ledger](implementation-ledger.md) records the effective status of every finding; the original area reports retain their baseline observations. No schema, dependency, licence or approved visual design change is part of this batch.

## DATA-14: deduplicate observed parents before eligibility checks

The shared `collectionCTE` previously checked remaining episode eligibility for each qualifying observed episode, then deduplicated the show. On the actual cloned owner's data that meant 10,260 observed episode inputs for 313 distinct shows. The changed query materializes those distinct observed show IDs first and checks remaining episodes once per show. The analogous album branch uses the same parent-first ordering. Existing observed/remaining-child predicates, special-episode rules, reason values, privacy and source constraints remain in place. This changes the common owner used by Collection, item assessment and notification enrichment.

The retained probe compares the audited Collection module with the changed module on the same private actual-data snapshot, using shared current dependencies. It reads complete personal Collection rows for every enabled actual user, category variants, cross-viewer item assessments, every actual owner connection, a mixed-medium assessment cohort and the complete public Collection-page response. All **22 comparisons passed**. Reason arrays are canonicalized as sets because their order is not a contract; other result identities, arrays, order and values are compared. There are no fixture catalogue inserts. Empty actual reading histories remain empty.

One warm-up per variant preceded five alternating samples per workload. These samples ran before the later DATA-11 hydration change and are an isolated comparison of this query refactor, not an additive estimate for the whole patch.

| Actual workload | Before samples, ms | After samples, ms | Before / after median |
| --- | --- | --- | --- |
| Screen Collection, first 60 cards | 2586.49 / 4388.33 / 4791.37 / 4726.99 / 3442.08 | 1472.28 / 3229.03 / 1988.14 / 1978.57 / 1562.81 | 4388.33 / 1978.57 ms |
| Mixed item assessment | 1853.99 / 1935.80 / 1859.11 / 1765.21 / 1625.55 | 454.12 / 510.88 / 572.87 / 638.13 / 447.21 | 1853.99 / 510.88 ms |

The separate Collection count plans took 2553.324 ms before and 1247.955 ms after under the owner's actual `jit=off` and `recursive_worktable_factor=.01` settings. Raw sanitized plans and all samples are in [the actual-data result](evidence/implementation-collection-real.json). Local cache, background load and thermal state were uncontrolled; these are descriptive local samples, not production p95 or capacity claims. Other broad evidence/global-edge work still remains in an item assessment, so DATA-14 is **partial**, not closed.

The [retained probe](probes/verify-collection-fix.ts) extracts the exact baseline module from Git rather than relying on a temporary local source copy. Baseline source was identical to the temporary copy used for the recorded run. Future runs must use an isolated actual-data clone, satisfy the clone guard, and preserve their own source fingerprints and output files. A baseline module against current dependencies is not a complete checkout benchmark.

## FRT-02: private detail demand follows viewer capability

`DetailRows` now admits private insight/review/credit/activity demand only for an authenticated viewer or the existing preview transport. Anonymous activation and Retry start no private requests; sign-in activates the existing resources, and sign-out disposes the owner and aborts pending requests. Server authorization remains authoritative.

The real component lifecycle regression covers anonymous activation, Retry, sign-in, sign-out while requests are pending, ignored cancellation and a replacement viewer. Those controlled faults verify correctness, not live anonymous acceptance. The normal dev browser is signed in; the actual public journey now has a separate receipt below; genuine-expiry checks remain open. The older deployed public failure is baseline evidence, not proof of the changed build.

## UIS-02 and HELPER-03: prevent overlapping or stale browser work

The shared diagnostics poll owns one AbortController and one pending request. It skips hidden-document ticks, refreshes on visibility restoration, aborts on teardown, and ignores responses after disposal. The regression holds a request across twenty ticks, checks twenty hidden ticks, restores visibility and verifies late completion cannot enable tracing after close.

Presence heartbeat now rechecks its stopped/aborted owner immediately after the response, before publishing status or refreshing friends. The compiled-runes regression closes an owner during a held request and verifies a late reply has no global side effects. Actual two-account replacement and long hidden/resume traces remain explicit gaps.

## Verification and live acceptance

The refreshed batch passed 678 unit tests, with 701 gated skips and zero failures (32,805 assertions). Skips do not count as integration passes. Svelte checks found zero errors or warnings; the production build, code/UI inventories and adopted source-style checks completed. The refreshed gates include DATA-11, crop sampling, menu and request-option changes. [Machine-readable summary](implementation-common.json), [unit log](evidence/implementation-unit.log), [check log](evidence/implementation-check.log), [build log](evidence/implementation-build.log).

The signed-in normal dev browser verified shared detail replacement, panel shrink and automatic linked comic launch against actual saved data. The real CBR decoded a 1988×3057 page, advanced from page 2 to 3 of 23, detached its image when minimized, resumed page 3 and detached it on intentional Close. This uses normal bookmark reporting and can update the real account's reading state. It does not certify actual EPUB, all formats/devices, long-lived memory or production latency. [Live evidence and limitations](evidence/implementation-normal-dev.json).

Development build/generated-file changes caused earlier reconnects. The panel was repeated after the build. Source writes were held during the live journeys. A minimized Reader's Resume control is outside an underlying native modal; the first activation closed that modal before a subsequent activation resumed the Reader. This observation is retained without promoting it to a confirmed Reader defect.


## Subsequent anonymous acceptance and FRT-05 ancestry correction

An independent anonymous origin used the normal dev server and its actual saved catalogue; the primary signed-in localhost session was left intact. A temporary loopback-only GET/HEAD transport explicitly stripped Cookie/Authorization and removed Set-Cookie. Across five document loads (including development reloads) and scrolling through optional rows, it observed 1,172 requests, **zero API requests, zero private insight/statistics calls and zero HTTP errors**. No console warnings/errors or false-expiry feedback were observed. This is functional demand evidence from normal development, not production transfer/latency measurement. The transport recorded only counters and was stopped afterwards. [Aggregate receipt](evidence/implementation-anonymous-normal-dev.json), [retained transport](probes/normal-dev-anonymous-proxy.ts).

That acceptance exposed an additional baseline defect, FRT-05: publicDetails selected parents from every relationship kind. Actual recommendation edges consequently appeared as hierarchy, and the public hero displayed an unrelated show's title. The structural parent query now admits contains/collection/franchise edges and retains the explicit episode-show link. It does not change the hero design or the recommendation graph.

The read-only [actual-data probe](probes/real-public-hierarchy.ts) first reproduced non-hierarchy parents against the audited module. After repair, eight actual cohorts covering movie/show/season/episode/collection and three affected shows matched structural parent identities; every other response field was unchanged. The original normal-dev public page also showed its correct title after reload. [Expected failing baseline](evidence/public-hierarchy-before.json), [passing comparison](evidence/implementation-public-hierarchy.json). The original register had89 records; this newly discovered case makes90 maintained records. These counts include overlapping findings and plan leads.
