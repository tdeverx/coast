# Library server-range preparation and actual Watch prototype

Later adoption: [batch04](implementation-found-04.md) applies the bounded shared range/source/Shelf protocol. The candidate/checkpoint below remains historical; its own acceptance and tradeoffs are not promoted.


**Prepared and verified privately for ordinary Watch; unadopted.** The user chose [prepare the server-range/request-local reuse option first](evidence/implementation-library-server-range-choice.json). The older N-serial client alternative remains unadopted. This decision authorizes preparation, not adoption of the range API/client, failure policy or retained window.

The private Watch prototype uses one actual enabled owner (ordinal 0) and passes eight complete actual interval comparisons, including 1,200 cards across 20 canonical pages, plus four authored stop controls. [Machine report](library-server-range.json), [actual receipt](evidence/library-server-range-watch-actual.json), [frozen plan](candidates/library-server-range/plan.json), [executed source](candidates/library-server-range/library.range.ts.txt), [proof](candidates/library-server-range/range-proof.ts) and [archive map](candidates/library-server-range/packaging-manifest.json). **No range plans, CPU/memory, HTTP, browser-client or other-medium result is claimed.**

The completed [one-page repair](implementation-library-membership.md) is separate. All 579 application/package/lock pins stayed unchanged during this earlier range execution, then the one-page query changed later through the named cc54/type-only d622 boundary. The range's source-pinned original and one-page foundation remain immutable. Fifteen frozen input hashes, verified read-only session/policy/cleanup guards and independent source-only review are retained. The exact [contract at authoring](candidates/library-server-range/contract-at-authoring.md) records older pending statuses; this current report supersedes its status without altering those bytes.

## Actual Watch interval results

Each cell containing three values is **original repeated single-page owner / one-page foundation repeated N times / one explicit range owner**. Count the foundation improvement separately; otherwise the range proposal receives credit for work already removed by the independent one-page repair.

| Actual Watch case | Requested → returned inclusive interval | Full filtered total / pages | Returned cards | Domain calls | Primary ORM reads | All ORM reads |
| --- | --- | --- | --- | --- | --- | --- |
| First three pages | 1–3 → 1–3 | 2,680 / 45 | 180 | 3 / 3 / 1 | 6 / 3 / 1 | 54 / 51 / 49 |
| Non-prefix middle interval | 2–4 → 2–4 | 2,680 / 45 | 180 | 3 / 3 / 1 | 6 / 3 / 1 | 54 / 51 / 49 |
| Last-page clamp | 44–47 → 44–45 | 2,680 / 45 | 100 | 2 / 2 / 1 | 4 / 2 / 1 | 36 / 34 / 33 |
| Both endpoints beyond end | 47–49 → 45–45 | 2,680 / 45 | 40 | 1 / 1 / 1 | 2 / 1 / 1 | 18 / 17 / 17 |
| Actual progress filter | 1–3 → 1–1 | 10 / 1 | 10 | 1 / 1 / 1 | 2 / 1 / 1 | 18 / 17 / 17 |
| Actual saved Seerr instance, naturally empty | 1–3 → 1–1 | 0 / 1 | 0 | 1 / 1 / 1 | 2 / 1 / 1 | 2 / 1 / 1 |
| Genre selected from an actual returned card | 1–3 → 1–1 | 48 / 1 | 48 | 1 / 1 / 1 | 2 / 1 / 1 | 18 / 17 / 17 |
| Actual first twenty pages | 1–20 → 1–20 | 2,680 / 45 | 1,200 | 20 / 20 / 1 | 40 / 20 / 1 | 360 / 340 / 321 |
| **Sum across these overlapping contexts** | Not a unique-page coverage total | Not additive | **1,758** | **32 / 32 / 8** | **64 / 32 / 8** | **560 / 528 / 504** |

The 32 canonical page admissions overlap; they are not 32 unique unfiltered pages, owners or requests at the API. There were 72 successful domain feed invocations across the three alternatives, plus the four supplementary controls. The unchanged non-primary ORM remainder is 496 in each alternative. The prototype retains the same 60-card hydration batches; for the largest interval it removes 19 primary read admissions relative to 20 foundation calls while retaining 320 hydration admissions. A reduction in admissions is not a measured proportional reduction in latency, CPU, buffers, serialized bytes or memory. Raw configuration/policy reads are excluded from these ORM totals.

All eight comparisons assert literal complete composed DTO equality, count/pages/actual first-last bounds and ordered primary identities. Each range reuses the original membership SQL and its binding prefix exactly once. Its remaining bindings are the exact page size/requested endpoints/range limit-offset values. Canonical hydration SQL plus parameters match as a **multiset**, not as an identical execution sequence. The proof uses the existing Map occurrence merge semantics—first position, last value—and separately asserts that the actual ordinary Watch selected primary IDs are disjoint. It does not establish duplicate occurrence behavior for a different owner.

## Controls and cleanup

The four controls are authored schedules over actual data and dependencies, separate from natural observations:

| Supplementary control | Verified result | Limit |
| --- | --- | --- |
| Reversed endpoints | Validation rejects; zero ORM read admissions | No API parsing/status test |
| Signal already aborted | Rejects with the signal's exact reason; zero ORM read admissions | No browser HTTP cancellation test |
| Abort after first actual hydration chunk | Exactly one chunk completes; rejects with the signal's exact reason; no second chunk admitted | Does not cancel SQL already issued or prove client atomic publication |
| Error after first actual hydration chunk | Exactly one chunk completes; rejects with the exact authored fault; no second chunk admitted | Not a naturally occurring database/provider error |

The receipt verifies one private native **read-only repeatable-read** transaction, statement timeout 30 seconds, lock timeout 1 second, JIT off, work memory 4 MB and stats-fetch consistency `none`. It observes zero other client backends at the designated observation, validates three policy-function definitions and checks for no public table RLS before the comparisons. Its completion records `rolledBack`, `reservedReleased`, `poolClosed`, `sourcePinsUnchanged` and `privateInputsUnchanged` as true; external network attempts are zero and the isolated credential-key file remains absent. The frozen launcher requires the parent non-blocking exclusive clone lease. These are verified receipt and source claims, not an independent observation of every concurrent actor or long-lived backend process disappearance by this reviewer.

## Proposed common contract and remaining owner preparation

The reviewed contract uses existing authenticated `GET library` and `GET collection` routes. Optional `firstPage` expresses range intent; existing `page` is the requested last page. The existing 1–1,000,000 page schema applies to each endpoint, with ordered endpoints required. No new route, `lastPage` URL alias, global cache, dependency or generic range-service framework is proposed. Without explicit range intent, preserve one-page behavior. Explicit range responses return actual clamped `{firstPage,lastPage}`, retain full filtered totals and owner metadata, and publish `page=lastPage`. Empty results return actual interval 1–1. Keep range input outside existing filter DTOs.

API path builders emit `firstPage` only for a retained refresh; normal hrefs and numbered navigation stay one page. Strip range intent from SSR browse inputs; `browseUrl` currently copies the incoming URL. Preview builders must not emit it, and an explicit preview range should reject before projection work. These API, SSR and preview behaviors are proposals; the private domain proof has not implemented or verified them.

| Area | Next concrete preparation | Required actual-data proof before its adoption |
| --- | --- | --- |
| Watch | Measure exact range primary and total work at first/non-prefix/deep/20-page intervals, building on the frozen candidate. Thread the selected contract through existing adapters only after review. | Preserve original membership/order/missing-card behavior; exact actual DTOs and 60-card hydration; range-specific plans, CPU, memory and eventual authenticated HTTP/client acceptance. The one-page metrics cannot be transferred to range metrics. |
| Collections, every supported medium | Extend existing one-statement `collectionPage` selection, preserving its CTE, owner/viewer admission, local transaction settings, assessments, source filters and `lower(title),id` order. Reuse existing 60-item `workCards` batches; thread the signal. | Own and different-owner cases; all naturally available categories/filters; viewer availability and captions, assessments and requested-last `filters.page` on clamp. Do not replace collection membership with Watch eligibility. |
| Read | Prepare request-local canonical eligibility/count and interval selection; preserve category/state/availability/personal/search-primary-or-fallback/rank/title/id behavior. Call `readingCards` in canonical 60-row chunks. | Complete DTOs and privacy/preferences; positive progress beyond the first 60 identities where actual data exists. The helper's progress query has `LIMIT 60`; passing a whole larger interval once can lose later progress. Twelve observed comics and zero books do not provide book/EPUB or natural multi-page reading evidence. |
| Play | Add an explicit interval selection with canonical predicates/count/order and game presentation. Keep the reduced first-page `projectionLimit` contract separate. | Actual status/availability/personal/variant cases and all affected search consumers. Existing `rankSearch` runs after each page's presentation; whole-range rescoring needs literal composed-page equivalence. Ordinary Library's empty search does not prove searched consumers. |
| Listen | Prepare owner-specific orchestration: list/admit sources once, canonical 50-item pages, bounded per-source concurrency, page-major then source-major assembly, connection-scoped identity/artwork. Preserve maximum source page count and account-generation checks. | Actual authenticated provider first/middle/clamped/empty and unequal-length multi-source cases; partial failures and generation/cancellation observations. One browser request remains multiple provider requests. The provider's cap of 100 is not permission to multiply its limit by range length. Saved Collection tracks do not prove ordinary Listen. |
| Shared client | Retain committed endpoints under the one existing resource. Capture owner/filter/viewer/admission/revision; publish one validated complete interval atomically. Preserve occurrence keys and existing numbered/remount rules. | Compiled meaningful delayed-delivery, revision/append, current/stale-denial, retry, clamp, disposal and URL-publication schedules, followed by signed-in actual-data prefix/scroll/focus/menu/draft/close/reopen checks. The private server proof does not repair or test client prefix loss. |

Listen's browse path is not a read-only database operation: it persists remote metadata/access observations and then personalizes cards. Preserve fresh transactional actor/instance/connected-account-generation/feature checks in `observeMusicLibraryAccess`. Do not hold a database transaction across provider waits. A later failure or abort does not undo previously committed observations.

## Semantic choices still open before adoption

1. **Incomplete-range failure behavior and error channel.** A complete retained range should not be replaced by a partial interval. The authored contract proposes retaining the previous complete range for transient/incomplete refresh errors, clearing on current terminal 403/404 or known withdrawal, and retrying the full committed interval. Its suggested 503 mapping is still a proposal. Compare using the current failure field/resource error path with explicit HTTP failure; do not adopt new status semantics implicitly. Keep existing one-page partial usability where no range was requested. Specify scope checks so an old denial cannot clear a newer owner.
2. **Read observation/isolation.** A single local selection statement gives coherent count/IDs. Later hydration under ordinary READ COMMITTED can observe later commits. The private repeatable-read equality snapshot does not establish linearizable feature/privacy/availability/ranking withdrawal. Extending a transaction through all hydration would change connection lifetime/isolation and needs its own measured decision; it must never span remote waits.
3. **Range budgets, fairness and retained window.** A permitted endpoint as large as one million is not a resource budget. One request still hydrates/serializes N pages and atomic publication retains old plus new objects. Measure the actual range before presenting a deadline, interval cap, refresh fairness or bounded-DOM/window alternative. No arbitrary cap, virtualization or unmount behavior has been authorized by the preparation choice.
4. **Append clamp recovery.** When shrinkage clamps an append into an existing page, do not append a duplicate. A proposed recovery discards it and rebuilds the canonical clamped retained interval. That additional request, metadata changes and visible-anchor behavior need explicit evidence and presentation alongside the final proposal.
5. **Unavailable natural cohorts.** Keep book/EPUB, disabled category/feature, natural permission denial, deletion/reordering, provider partial/error, long-soak and large-growth gaps visible. Controlled schedules may supplement actual captured data; they cannot turn absent natural cases into verified real occurrences.


## Execution review and maintained boundary

Peer source review caught four proof issues before freezing: expected occurrence merge semantics, missing foundation-primary checks, abort reason identity, and explicit empty/20-page assertions. Their corrected bytes and exact before-to-after patch are archived. The original generator is historical; applying its separately archived correction patch reproduces the executed proof. The private range source's JSDoc still says “at most 60 titles” although it actually processes multiple canonical60-card chunks; correct the comment in a future implementation, preserving these executed bytes.

Next preparation is range-specific resource measurement, then owner-specific Collection/Read/Play/Listen execution and meaningful client/API controls. Keep normal numbered browsing and previews one-page, preserve ordinary Listen's 50-per-source page-major ordering and account-generation observation writes, and make no transaction span remote waits. Incomplete-result error mapping, coherent publication versus concurrent withdrawal, range budgets/fairness/window and append-clamp recovery must become a concrete measured adoption proposal. No extra approval is needed merely to prepare and test these options. No API/client source is applied by this report, and the reproduced prefix loss remains open.
