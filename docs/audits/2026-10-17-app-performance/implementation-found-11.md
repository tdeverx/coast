# Guarded reuse of identical Profile favourite totals

Applied in the existing `profileSummary` owner, which serves initial Profile data, section reads and insight totals. When kind/scope are both `all`, its existing favourite-membership aggregate now returns the exact total and omits the duplicate count statement. Other kind/scope count SQL and bindings remain byte-for-byte equal. This advances the known PLAN-08 aggregation work; wider counts/history/resources remain partial and unchecked areas stay deferred.

## Why the guard matters

The original first aggregate returns insights-visible favourite count plus categories. The later total counts every favourite admitted by the selected kind/source scope. Those two counts cannot be treated as equal when privacy differs. For exactly unfiltered kind/all scope/all, their membership relation is identical: an additional `count(*)` on the first aggregate gives the correct page total. The insights-visible count remains separate. The original left media join in the duplicate count is one-to-zero/one through the media primary key and does not change this row count. The new aggregate does not add that join.

The [unconditional alternative](candidates/found-implementation-11/unconditional-actual.json) also matched192complete actual outputs but regressed15of64measured count families. Some availability-filtered cases rose from1,178to165,882buffer visits; warm medians improved only44/64. Injecting source eligibility into a whole-favourites aggregate admits expensive checks on unrelated rows instead of filtering them before the aggregate. It was rejected and never applied. Its exact source, probe, plans and all samples remain archived. Fewer SQL statements alone did not establish an improvement.

## Actual-data proof of the guarded implementation

The [guarded receipt](evidence/implementation-found-11-actual.json) independently preserves **192 complete favourites-section DTOs or matching privacy errors**: four actual owners × eight existing selector kinds × two availability scopes × self/other/guest. No favourite, missing book, privacy or provider cohort is fabricated. Empty actual selections are not positive membership/source-withdrawal acceptance. Both candidate stages use the same population, not384independent cohorts.

The maintained probe verifies exactly two original count statements per self/kind/scope. The guarded candidate uses one only for all/all; all other60families have **identical SQL and parameter arrays**. Complete page counts/order/fields and errors match. Root owner statement interception falls by one only for all/all. It is not a census of every raw auth/configuration query. The receipt's current source hash is the pre-adoption epoch; its candidate hash matches the applied owner. READ ONLY repeatable-read, JIT off,30-second statement/one-second lock, zero external fetches, rollback/close and module cleanup are checked.

### Four unfiltered count families

| Actual owner ordinal | Sum of original roots → candidate root buffer visits | Warm SQL median ms |
| --- | --- | --- |
| 0 | 1,223 → 634 | 7.80 → 4.83 |
| 1 | 1,062 → 531 | 3.19 → 1.80 |
| 2 | 1,529 → 772 | 4.86 → 2.99 |
| 3 | 1,669 → 838 | 5.82 → 3.71 |

Three alternating warm pairs per 64 families and all plans remain in the receipt. Unchanged filtered SQL can have different timings/buffer-cache observations; those are not additional improvements. The four changed families reduce visits and warm medians. This is local serialized reserved-wire count work, not pooled endpoint latency, CPU/RSS/heap, network or production-tail proof. Concurrent count/page/source/privacy changes are not exercised. No index, schema, cache, cap, dependency or visual behavior is added.

## Normal development and drift

Final [signed-in normal acceptance](evidence/implementation-found-11-normal.json) expands the actual three-item Favourites panel from Profile/admin. All three ordered canonical hrefs equal the underlying row, the panel closes, the page stays nonblank, no overlay/dialog remains and no new warnings/errors occur. No filter/preference/playback command is submitted in this batch. This is current-source consumer smoke, with full DTO equivalence on the actual clone. Native CUA/Playwright locators are used because the dedicated Browser plugin is absent.

[Actual favourites (private verification image)](publication.md#private-verification-images)

Final [gates](evidence/implementation-found-11-gates.json): **841 passed, 715 guarded skips, 0 failures, 34,235 assertions**; type 0 errors / 0 warnings, build/navigation drift, source/UI inventories and style pass. No mirror source-string test or fabricated database setup was added. The [actual probe](probes/profile-favourite-count-real.ts) protects complete outputs and unchanged filtered SQL, while the [manifest](evidence/implementation-found-11-source.json) and exact [one-owner patch](candidates/found-implementation-11/runtime-owner-changes.patch) preserve before/adopted source without overwriting prior changes.

[performance.md](../../performance.md#reuse-a-count-only-when-its-membership-is-identical) records this general rule. Future filter/privacy/source changes must re-establish identity before widening the sharing guard. Historical source identities/receipts remain separate from current reviewed pins. PLAN-08 still includes separate previous-period/rating/season/history paths and broader concurrency/resource/growth acceptance; no all-Profile or whole-audit completion claim. Canonical counts remain 24 open / 36 partial; Tasks retains the user's selected pair. No commit, push, PR or deployment.
