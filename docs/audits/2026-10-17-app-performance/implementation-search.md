# Independent search demand: implementation and verification

18 October 2026. FRT-01 implementation against audited baseline `eb0673873462b71118d1c11678d128958a05ff07`. The original audit remains the historical finding. This change preserves the existing Available and Unavailable rows, their separate type controls, card ranking and availability partition. No dependency, API endpoint, schema, cache, framework, visual redesign, commit or deployment was added.

## Shared owner and route behavior

`src/lib/search-selection.ts` owns URL selection, row scope, the union of requested media and URLs for changes. The server and shared Search shelf use that same vocabulary. The search route starts initial catalogue reads and streamed search owners only for the enabled union of the two rows. Four promise slots remain available to the page; skipped owners receive resolved empty payloads. Each row waits only for its requested owners. The existing stale-promise publication guard remains, and selected empty rows retain their existing controls.

Two primitive parameters preserve independent selections:

| Input or action | Available row | Unavailable row | Requested families |
| --- | --- | --- | --- |
| `/search?q=…` | All | All | All enabled |
| `view=read` | Reading All | Reading All | Reading |
| `view=read&availableType=movie` | Movies | Reading All | Screen + reading |
| `availableType=movie&unavailableType=comic` | Movies | Comics | Screen + reading |
| Change Available to All | Global All | Retains its selection | Union with global All |

An omitted row parameter inherits the existing `view`/`type` default; an explicit row parameter changes only that row. An explicit `all` means global All. Incoming reading links such as `/search?view=read&q=…` remain usable. Existing reading subtype/page inputs retain their server contract. A new explicit row override can broaden the reading subtype when both independent rows require different reading types. Other admitted family limits and ranking remain unchanged; broad subtype queries continue to feed row filters.

The page uses normal SvelteKit navigation. A row change pushes history, and debounced query edits replace the current entry. Both preserve the other row parameter and incoming defaults, while clearing old reading `page` and `scope`. Reading an earlier URL restores both row selections. While a navigation is pending, later actions compose from the latest route-local URL intent. A monotonic revision prevents an older success/failure from clearing newer intent. `beforeNavigate` fences Back and external navigation when Kit delivers that callback; settled or disposed targets are removed rather than retained as history. Installed Kit deliberately skips `beforeNavigate` while a navigation is already active, so rapid pending-filter → Back → another filter remains actual rendered acceptance, rather than a guarantee established by the isolated callback fixture. See the [bounded navigation proposal](implementation-navigation.md). Active controls remain interactive. There is no new cursor or pagination mechanism; search shelves retain local pagination.

The shared Search shelf also serves UI preview. Route-owned controls read their kind/scope from the supplied normalized state and call the route callback. Embedded preview controls keep their existing local behavior. This is one owner with two existing consumption modes.

## Authorization, cancellation and bounded work

Selected disabled media are rejected before their search owners run. All-demand uses the authoritative enabled-surface gates. Public search retains its public catalogue projection and screen-only authority even when row parameters request a private medium. No public/private endpoint permissions changed.

An already-aborted request starts no query owner. An abort during initial work prevents later streamed owners from starting. Music retains its existing request-signal propagation. Client cleanup prevents old streamed results from publishing into another query/selection. Existing screen, reading and game provider APIs still have incomplete cancellation ownership; reading single-flight work is shared across consumers. This change does not add a first-consumer abort signal to shared work. Fully cancelling abandoned provider work remains a separate shared-owner task.

For a nonempty single-medium demand, source operation bounds now admit one family instead of four. Initial screen and reading work follows the same mask. Two different row media admit their union; an All row legitimately requires all enabled families. Empty queries start no search owner.

## Actual retained-data evidence

The approved private clone supplied an existing owner and persisted movie, album, game and comic query terms. No catalogue, account, history, policy or provider credentials were fabricated or changed. The probe explicitly set `statement_timeout=30s` and `default_transaction_read_only=on` in its own Bun pool's connection startup settings; `SHOW` verified both settings on four simultaneously reserved connections. No target database defaults were modified, and no `PGOPTIONS` timeout assumption was used.

The audited and current route bodies used the same current local query owners. Fifteen alternating before/after route cases completed. All **30 row-card comparisons and 30 admitted-family complete payload comparisons matched**, including the four All cases and independent row combinations. The equivalence target is the requested kind/scope/availability projection of the audited complete payload. It includes every retained card field and its order. Comparison payloads were discarded in memory; saved evidence contains only counts, booleans and source hashes. Ten tracked source hashes were unchanged during the run.

| Actual query cohort | Scoped view | ORM statements before → after | Admitted final owners |
| --- | --- | --- | --- |
| Movie | Watch | 54 → 33 | Screen initial + screen search |
| Comic | Read | 61 → 7 | Reading initial + reading search |
| Game | Play | 52 → 7 | Game search |
| Album | Listen | 62 → 5 | Music search; zero music cards in this cohort |
| Comic | Independent screen + reading rows | 61 → 48 | Screen and reading owners |
| Album | Independent music + game rows | 62 → 13 | Music and game owners |

The four All query cases retained their original statement counts of 61, 52, 62 and 54 and their complete family/card payloads. Scoped `type=` cases matched their corresponding view counts. ORM instrumentation includes transaction statements but excludes direct Bun SQL; these counts are not total database-call counts.

Provider transports were deliberately denied before DNS/network and returned no fabricated content. Local catalogue/query work and existing fallback behavior ran on actual data. The probe records service and transport **admission**, not successful provider HTTP traffic. All-demand retained one attempted Open Library transport for each measured query; demands excluding reading did not admit that transport. No unexpected fetch reached the secondary guard, and no ORM write was attempted. The explicit read-only connection setting also guarded raw reads and transactions.

The saved card-size metric is JSON string length in UTF-16 code units, not response bytes. Single timing observations vary with cache state and the controlled provider failures, so this evidence establishes skipped work and exact local output preservation without a production latency percentage. See [actual source-pinned evidence](evidence/implementation-search-actual.json).

## Tests and remaining acceptance

Executed focused correctness tests: `search-selection.test.ts`, `ui-search.test.ts`, `search-demand.test.ts`, `search-page-lifetime.test.ts`: **14 passed, zero failed, 93 assertions**. These cover independent defaults/overrides, URL history restoration, normal navigation versus query replacement, stale streamed delivery, rapid two-row changes before either navigation commits, older/latest failures, Back/disposal intent cleanup, selected-family admission, blank queries, feature gates, public authority and existing cancellation. These small fixtures are correctness checks; the performance/output evidence above uses persisted data.

The coordinator owns full checks/build and normal signed-in rendered acceptance. The target flow is Search → independently change both row types → Back → restore both controls and cards → select an empty type → use its retained All control. Rendered identity, console, overlay and interaction proof remain pending that acceptance; this source/DB report does not claim browser completion.

Explicit gaps and remaining opportunities:

- Successful TMDB/Seerr, Jellyfin, IGDB, Open Library and Comic Vine provider searches were not exercised. No live-provider latency, remote pagination or successful cross-provider ranking claim is made.
- This actual probe used one existing owner; private alias/availability behavior for every other owner and public-site configuration remains broader acceptance.
- No actual saved books were present. The actual album-title cohort produced zero music cards in both implementations. Its selector sampled all persisted `music_works`, rather than joining the chosen owner’s access/availability; it does not prove that this owner had an accessible matching album or lost an owned result. In current source, local music admission in `queries/search.ts:116` uses `presentationSearch().matches`, whose predicate searches viewer aliases in `overrides/presentation.server.ts:29`, while ordinary canonical music title search depends on the provider path. Preserving that family output leaves canonical local music admission as a source candidate to assess. A repair first needs an authoritative owner/access cohort and privacy/ranking acceptance; this empty cohort alone is not evidence of a lost owned result.
- Admitted subtype overfetch remains. Pushing row subtype filters into a bounded query/provider call can change which cards survive its cap; that change needs its own result-budget acceptance.
- Existing screen search can ingest provider metadata before rereading the catalogue. That owner and successful provider writes were outside this read-only verification.
- The first probe preflight referenced a title field on the work identity table and failed with SQLSTATE `42703` before any route case ran. Its selector was corrected to the real medium tables. The authoritative retained run exited zero with no writes.

## Reproduction

[search-baseline.py](probes/search-baseline.py) extracts the immutable audited route from local Git into a private temporary file. [search-real.ts](probes/search-real.ts) runs only when `COAST_AUDIT_REAL_DATA_CLONE=1` and the database is a `coast_audit_fix_actual_*` clone. Supply credentials only through the separately approved in-memory runner and an isolated data directory. The checked-in probe has repository-relative imports; the executed temporary copy used equivalent absolute imports. The probe's real-data query terms and result objects remain in memory and never enter the evidence artifact.

[implementation-search.json](implementation-search.json) records source pins, the shared consumer matrix, exact verification limits and acceptance still outstanding.
