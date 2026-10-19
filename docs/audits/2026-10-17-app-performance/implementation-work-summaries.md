# Shared work identity projection — MIN-03

Public catalogue single/list, accessible Library and Collection reads now share a bounded identity projection. These responses expose canonical ID/kind/title/year and optional attribution; they previously built full UI cards and discarded personal progress, availability, artwork, credits, sequence and most metadata. Full browser cards and progress readers retain their complete existing path. No UI redesign, schema, cache, dependency or provider transport was introduced. [Machine-readable scope/pins](implementation-work-summaries.json).

`workSummaries` in the existing Collection query owner deduplicates fetch identities, chunks of 60, and restores requested order/repetitions. `screenWorkSummaries` calls the existing pure `resolveMetadata` policy with owner original-title preference, viewer title preference, title locks, administrator/provider precedence and release-date/year fallback. It selects only those source fields. Screen summaries never receive a second generic alias override that could bypass a title lock. Non-screen summaries reuse existing reading attribution and private title presentation helpers. Canonical music identity/year and game variant title remain unchanged; game year deliberately stays the current public null rather than introducing a separate bug fix.

Collection extracts its existing eligibility/page read into one private owner used by both full cards and summary consumers. The same category/privacy/relationship/activity/availability/source predicates, exact reasons, root filtering, counts, numbered pages and requested order remain authoritative. Full UI Collection still hydrates complete cards, decorates availability and reads its source menu. Public Collection omits that unused menu/card work. API authentication/scopes/quota, parameter checks, headers, HEAD behavior, status mapping and progress endpoints remain at their existing owners. `WorkSummary` is an honest narrow type; it does not fabricate personal fields or cast screen identities into a non-screen card type.

## Actual-data verification

The [current actual-clone probe](evidence/implementation-work-summaries-actual.json) compares complete old/new DTOs using saved old Collection/Library owners **and the saved old public DTO/page formatter**. Shared current dependencies are identified: existing `mediaViews` plus following source are byte-identical to the saved baseline. The [earlier domain comparison](evidence/implementation-work-summaries-domain-pre-formatter.json) used the current formatter on both sides and is preserved separately; the final stronger receipt supersedes it for the complete public DTO claim.

All **133 outcomes matched**: 84 identity cases over four actual owners with self/other/guest audiences, 3 complete non-screen categories, 32 public Collection filter/page cases, 10 accessible Library pages, and 4 **complete full UI Collection** responses. Multi-batch and repeated requested occurrences are included. All 1,218 saved games, 959 music works and 12 comics were compared for the selected existing owner. Saved books, title preferences, overrides and locks are all zero in this clone; none was manufactured. No token was created and no actual bearer-auth/quota HTTP request was invoked. This verifies read owners on actual data, not new positive credentials or token admission.

| Complete actual category | Identities | Counted ORM statements | Mapped ORM JSON bytes |
| --- | ---: | ---: | ---: |
| game | 1218 | 84 → 63 | 1,377,396 → 170,575 |
| music | 959 | 80 → 48 | 1,128,871 → 157,126 |
| comic | 12 | 5 → 3 | 14,768 → 4,037 |

The sampled 60 screen identities retain exactly the same public DTO with counted ORM statements 20 → 7 and first-sample mapped rows 227,975 → 26,301 JSON bytes. Six alternating local warm pairs have median 117.788 → 3.459 ms. These are local read/decode samples, not production tail latency or heap measurements. The final public DTO size is identical. ORM counters exclude raw BunSQL/config statements and PostgreSQL internal work. Four full UI Collection comparisons retain identical counted 98 total ORM statements and 1,889,773 mapped JSON bytes across the pairs; no UI gain is claimed from a reader it does not use.

The reserved connection verified READ ONLY defaults, repeatable-read isolation and 30-second statement / 5-second lock budgets before and after every operation. Existing owner transactions keep their own snapshots; separate operations are **not** claimed to share one outer transaction. The private clone was quiescent. Source pins stayed unchanged, actual external fetches were zero, all temporary baseline modules were removed and the pool closed. No normal database, secret/master key, token or provider was used.

## Supplementary protection and remaining work

Three controlled owner tests / 60 assertions protect original-title/alias/title-lock/provider policy, blank aliases, disabled/empty admission, 61-screen batching, repeated canonical identity, game-null-year and ComicVine attribution. They do not create database catalogue rows. Both independent exact source reviews found no material blocker. Current common gates and normal chooser/Library/Profile/Tasks rendering belong to the root receipt.

Positive actual book/title-override/lock/private-alias and actual bearer-auth HTTP acceptance remain gaps. Metadata extraction still reads snapshots/locks/preferences needed by exact title policy; no new cross-request cache is added. Broader identity consumers can use this existing owner only when their complete DTO excludes card state. Do not route a full UI card or personal progress consumer through this summary.

## Root combined gates and normal acceptance

The [source-frozen normal dev (localhost:5173) trial](evidence/implementation-summary-avatar-normal.json) passed the existing signed-in chooser flow: open Profile editor, select the connected avatar source, cancel, reopen with the same saved preview, then cancel again. No profile Save was submitted. The actual profile genre heading rendered, settled Library showed 120 media links / 29 completed private-or-inline images, and Tasks ended with 30 rows, no open dialog and no new warning/error. The first Library sample still showed the outgoing profile and is explicitly retained as an invalid sample; acceptance waits for the Library heading and actual cards. No provider/decode/cancellation timing or bearer-token HTTP acceptance is inferred from these UI steps. Source hashes remained unchanged.

Common gates: **784 passed, 704 guarded skips, 0 failures, 33,604 assertions across 1,488 tests / 269 files**; Svelte check 0 errors / 0 warnings, production build, source/UI inventories and style checks passed. Guarded skips are not acceptance; the new genre override fixture was not run on the actual clone. [Library screenshot (private verification image)](publication.md#private-verification-images).

Subsequent [guarded-seed application](implementation-public-seed.md) has its own142actual pairs,54resource trials and imported-main acceptance. Current source identity advances to that exact query; the original measurements and candidate dispositions in this report remain historical.
