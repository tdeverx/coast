# Menu rollout follow-up: completed parity and bounded proof

17 November 2026. This follow-up supersedes the **current implementation status** in the earlier [source review](source-refresh.md). That report, its measurements and source receipt remain observations of their earlier local epoch. No hosted, provider, device or production-capacity result is upgraded by this follow-up.

## Current feature boundaries

| Scope | Current implementation | Deliberately separate or deferred |
| --- | --- | --- |
| Artist | Canonical artist works, shared rating/reaction/saved/list/background actions, local track-choice check-in and listen logging, paged history, and source-authorized Play/Shuffle | Metadata and personal tracking do not grant playback. Artist membership and a viewer's permitted playable sources remain separate SQL predicates. |
| Reading | Continue from a current-cycle bookmark, Read from beginning, dated completion/reread and guarded End reread, confirmed Mark unread and Reset reading position | Resetting current state does not delete reading history. Reader/provider/file-engine acceptance stays format-specific. |
| Disposable reading links | Website-only anonymous reading sessions bound to one permitted Jellyfin source, account generation and exact edition; existing expiry, revocation and shared allocation policy | Guest sessions cannot write owner progress/bookmarks/presence or join reading parties. Browser-local files and owner-tracking/together options are excluded. |
| Reading and games history | Shared paged dialog, exact local-entry/session removal after confirmation, ownership and current-feature checks | Reading progress/bookmarks and playthrough status/dates/progress are preserved. These local journals do not acquire an invented provider-history deletion/import contract. |
| Listening history | Track, selected-album-edition and canonical-artist scopes; exact occurrence removal, count correction and retained-position behavior | Connected services remain unchanged. Tombstones prevent the exact removed batch/provider occurrence from returning, rather than deleting unrelated later listens. |
| Filters | Shared unlabeled sections and owner-supplied Reset filters across supported row sources, including recommendations and the custom music/games/profile/taste rows | Navigation segments and fixed entity/recipe constraints stay in their own owners. Unsupported or ineffective choices are omitted. |
| Requests | Season checkbox choices, standard/4K variants and existing request management | Episode request submission remains disabled. Its legacy checklist draft is retained with `episodeRequestsEnabled = false`; no unsupported production endpoint is invented. |
| Personal artwork | Existing stored private presentation still applies; shared administration remains available | The personal artwork picker/editing remains deferred and hidden. |

The earlier artist-only provider-favourite limitation and view-only reading history are no longer the current boundary. `WorkHistory` is an internal catalogue-command renderer, represented through `CatalogueActions` in the reference inventory rather than a duplicate public widget.

## Subsequent pre-PR performance and link review

After the green local epoch recorded below, a further source review against the actual performance guide found concrete defects and corrected them before publication. The earlier complete gates remain evidence for their recorded epoch. Implementation and fixtures are now frozen after the deeper rendered comparison below, and the final consolidated gates passed at that source epoch.

- New tabbed Progress summaries aborted only their browser request. API and SSR now forward their genuine `Request.signal` into the shared read-only cancellation owner, covering parallel summary probes and subsequent retained-page reads. A held native-shaped query regression verifies cancellation, zero later page hydration and no read admission for an already-aborted request.
- The same server cancellation boundary was missing from affected optional music history/log-choice, work action/list-membership, screen action/history and playthrough-choice reads. They now use the existing read cancellation helper. Nine route-body cases exercise real Request/handle cancellation, while a separate case confirms an explicit game-session write still acknowledges independently. Reading/game history and check-in choices already had the correct cancellation owner. Explicit artist Play/Shuffle queue preparation retains its command lifetime.
- Cached action state acquired active check-ins, but its scope still tracked only tracking revisions. A check-in written through another menu invalidated social revisions, leaving other loaded card menus stale. The shared scope now includes that relevant revision. A two-instance regression preserves 100 passive snapshots with zero reads, refreshes the loaded instances after external start/cancel, and retains unchanged reopen reuse.
- History removal refreshed twice: the write's revision triggered a replacement and the acknowledged mutation callback restarted it. The history effect now follows the existing mutation guard. The actual-script regression observes one initial read plus exactly one replacement, zero canceled duplicates and a continuing idle external-revision refresh. Removing only the guard reproduces three reads instead of two.
- Canonical artist navigation still had alias assumptions. Conflict links now use the real music work route for artists. Artist Activity prefers the durable work ID over a connected source alias and includes the artist's own events/relationships alongside credited works. A disposable PostgreSQL case covers merged aliases, disconnected details, exact root/track events, strangers, private sections, independent undated Progress visibility and feature withdrawal. It passed **1 test / 16 assertions**; related focused units passed **13 / 109**. Maintained actual-data scope/policy/reason guards explicitly describe the approved additional artist-root membership; their historical receipts are unchanged and these edited guards have not been rerun on a natural-data clone.

The parallel counter review also found that overlapping provider accounts could each consume the same imported contribution during accepted resets, eventually consuming an independent Coast listen. The correction records one active imported-contribution scalar in existing per-work sync JSON, distinct from historical occurrences and each account's coverage watermark. A reset consumes at most that remaining contribution; local listens retain their residual count. The value shares the existing aggregate query, equal metadata updates are skipped, and neither history dates/rows nor the database schema are rewritten. Preview reported **16 native tests / 113 assertions** and **4 units / 17 assertions**, including overlapping accounts, aliases and tombstones. This supersedes the earlier single-account projection as the current counter owner without changing the historical test results above.

The cancellation/scope/history selection passed **52 focused tests / 310 assertions**. This is demand and lifecycle evidence, not a latency or memory improvement claim. The added reads remain scoped to the requested owner; choices select 20 labels plus a sentinel, history/list membership select one existing 60-row page, and summary/page planning shares the original screen planner instead of hydrating alternate card pages. Exact total/membership planning can still grow with an owner's catalogue; no new arbitrary truncation is introduced.

The housekeeping pass inspected import reachability and actual route/link producers, because every route being counted as an inventory root does not establish that a destination is useful. The code inventory reports **644 reachable production modules, zero unused modules and 79 roots**. Internally used `libraryPath`, `loadSyncPreferences` and `musicMetadataSnapshot` no longer expose unused exports. Provider-adapter seams used by execution/tests remain exported. The descriptive Availability paragraph in the performance guide now matches the approved shared RowFilter owner; historical audit prose and acceptance thresholds remain intact.

No duplicate media/filter draft route exists in the application tree: the Menus area composes the existing shared preview owners. `/ui-preview/demo` is intentionally retained as the administrator-gated standalone specimen host, reusing `PreviewExample` and its isolated transport rather than duplicating components. Canonical `/music/work/:id` and source-backed `/music/:connection/:id` are both intentional: the latter admits a connected provider identity before a durable work is available. Provider metadata detail entries, full history/deep-link routes, authentication/setup/invite/logout, Steam callback, `/share` and its token entry, public APIs and anonymous resource APIs retain their distinct entry contracts. They were not removed merely because an in-app overlay or a different host currently provides another entry point.

## Shared-owner corrections

`FilterGroup`/`ShelfControl` sections group content, access, activity and ordering choices without truncating options. `RowFilter` adds only nonempty boundaries and an explicit source-owned reset. Source reset callbacks update all applicable selections before their one replacement request; they do not iterate individual change callbacks and produce a request per field. Shelf composes a declared custom reset with its source reset. In show progress, Show specials and availability therefore reset in the same reactive replacement. Artist Library reset cannot reintroduce hidden Collection/availability controls.

Show detail progress now passes `progressView` into the shared style owner's segment key. Episodes and Seasons no longer share a temporary artwork/shape override. Other descriptor-backed segments already supply their active values; credits and focused favourites explicitly supply their custom segment. The override state remains in the mounted rail and is neither persisted to storage nor written to the database. A new rail starts with defaults.

`WorkHistory` uses the existing scoped menu resource and retry policy. It reads only while its dialog is open, pages history in the current owner and cancels on replacement/close. Game history captures the selected playthrough identity; listening and reading commands capture the work they opened. A removal confirmation captures its exact occurrence and target. Server commands revalidate ownership/features and retain transaction/advisory-lock policy rather than borrowing the screen tracking-event deletion path.

Local reading/game removals also remove their corresponding social activity projection. Music removal records its exact track/batch tombstone and adjusts the active listen summary while preserving position; import and playback replay admission use that tombstone. These are domain rules, not cosmetic menu grouping.

The full disposable-database run exposed a real music regression: rebuilding a current summary from lifetime history restored a provider's genuinely cleared count. The correction in `music/sync-count.server.ts`, `sync/values.server.ts` and `sync/jellyfin.server.ts` projects only accepted provider ordinal deltas. Historical rows and their dates remain intact. An ignored-removal offset distinguishes a retained tombstone outside the provider's current ordinal range from a local removal of an active occurrence. History removal checks accepted ordinal membership before decrementing, so removing inactive provider history cannot consume an independent Coast listen. Same-account connection coverage is updated together. Ordinal comparisons retain the importer's existing 10,000-occurrence bound; they run only for an affected reconciliation/removal command, with no lifetime-history hydration or card/menu read fan-out.

The final focused correction selection passed **24 disposable-database tests / 142 assertions**: recovery **8/56**, reconciliation **11/48**, catalogue history **5/38**. It includes genuine 3→0→1 observations with unchanged history, repeated observations, removed ordinals returning, independent Coast listens surviving provider resets/increments, and inactive-history removal after both zero and a later one-count observation. The existing local-removal/preferred-source/pending-watermark reconciliation sequence also passed unchanged. These replace the earlier failed reset result; they do not turn historical failed runs into passing evidence.

## Disposable reading isolation and lifecycle review

Independent source review covered `sharing/reading.server.ts`, sharing admission/request leases, `reading/sessions.server.ts`, delivery/cache authorization, anonymous routes, the shared client and the root/Reader/share render owners. A reading grant pins the owner's connection generation, external source and edition hash. Ordinary authenticated reading APIs explicitly exclude shared sessions, including when called by the owner. Shared reads return a fresh session with a null location; client page movement stays local and cannot publish owner progress or party state. Private resume, bookmark, presence and related queries exclude shared sessions.

Warm comic manifest/page delivery reauthorizes after cache acquisition/lookup and before publishing. PDF delivery reauthorizes after upstream headers, including current download permission. Revocation and expiry abort tracked responses even when the caller has not consumed them, cancel upstream readers, release guest-specific cache leases and reject bytes that settle after an abort. Cleanup uses the captured session; stale close, expiry and heartbeat work cannot retire or renew its successor. Aborting duplicate preparation preserves an existing valid reader. Provider I/O is outside the short admission transactions.

The existing policy limits remain explicit: **20 active links per owner**, **64 viewer records per link**, the owner's shared allocation budget, **8 dispatch leases per viewer**, and **8 live reading transfers per session**. Revoke closes viewers in bounded batches of two; the expiry sweep selects at most 20. The admitted transfer registry owns cancellation/expiry timers and deletes settled entries. These are allocation and lifecycle bounds, not a new hard transfer-rate shaper or a measured memory/throughput guarantee.

Domain reported the isolated reading-sharing selection as **6 tests / 59 assertions**. It exercises owner API rejection, no owner progress/history/presence mutation, source/download/account/edition withdrawal, warm-cache and delayed-header revocation, exact-target close/renewal races, aborted duplicate preparation, and pending/unconsumed transfer cancellation. Preview reported **33 focused client tests / 176 assertions**, including permanent shared-reader withdrawal, successor protection and transient-error retention. The audit independently reviewed these test paths; they remain authored transport/cache fixtures. No remaining concrete isolation or lifecycle defect was found in the reviewed approved scope.

Domain subsequently exercised one **real Jellyfin CBZ** through native handlers using a freshly verified read-only logical snapshot of the live database/key in an isolated disposable copy. Owner grant creation, anonymous claim/state, fixed-source preparation, a **296-page manifest**, one real **1,875,347-byte page**, heartbeat, close/reopen with a warm manifest and revoked **410** all passed. The run made **22 upstream GET/HEAD requests and no upstream writes**. Complete owner progress/history/bookmark/tracking/check-in/activity and host-party hashes remained identical. Domain reported that the copied database, key, cache and dump were cleaned up. This adds actual-source native-handler acceptance for that CBZ; it is not an anonymous browser/PDF/EPUB/CBR/device journey, a sustained-load result or general provider/file-engine certification.

## Focused local evidence

At this source-edit stage, the independent filter/lifetime proof includes:

- A 12-file focused selection passed **85 tests / 533 assertions** before the additional combined-Specials and artist-reset cases. The later exact Library selection passed **6 tests / 67 assertions**; the combined reset/source selection passed **26 tests / 195 assertions**. Selections overlap and are not summed as unique tests.
- Reset regressions preserve the source entity/recipe/default scope, issue one replacement read, abort superseded work and reject its late response. Combined Specials/availability reset has the same one-read contract.
- One hundred passive menu snapshots admit **zero reads**. Twenty reopen cycles of one unchanged snapshot admit **one read** in total. One hundred closed menu controllers retain **zero active breakpoint listeners/observers**; twenty parent/child cycles return measured fixture resources to zero. This is executable lifecycle accounting, not a browser memory-plateau or latency benchmark.
- Production Button script checks distinguish click/Enter primary activation from disclosure-only submenu opening and reject disabled activation. Controller checks exercise hover cancellation, delayed leave, keyboard-open ownership, narrow drill-down and teardown.
- The reference check passes with **65 public components, 29 explicit compositions, 19 internal renderers and 9 delegated routes**. Source-style checks cover **57 adopted modules**. Later full-unit/type/build results must be recorded at the final stable source epoch.

An intermediate root working-tree unit run reported **1,096 passed, 819 skipped and 6 failed**; all six failures were stale audit-source pins while the source batch remained open. A later intermediate run reported **1,122 passed, 828 skipped and 3 failed**. Two failures were Reader-script fixture import bindings; the third exposed a real lazy-Reader identity fence regression. The fix restores explicit viewer-ID/shared-session dependencies so viewer replacement cancels the old pending import. The source/fixtures were frozen again and complete gates rerun. Those intermediate failures remain historical evidence, superseded by the current green gate below. Guarded skips are not database or actual-data acceptance.

At the earlier frozen implementation epoch, before the subsequent pre-PR corrections above, root reported:

| Gate | Executed result |
| --- | --- |
| Complete unit selection | **1,126 passed, 828 guarded skips, 0 failed; 37,461 assertions across 340 files** |
| Complete disposable-database selection | **106 suites, 765 passed, 0 failed; 6,322 assertions**, pinned Bun `963452075` and PostgreSQL 17 test container |
| Schema 0076 backup/recovery | Passed PostgreSQL 17.11 dump/restore, fresh-process credential decrypt, missing-key denial and retained queue checks |
| Type/Svelte check | **0 errors, 0 warnings** |
| Production build | Passed; retained existing oversized-chunk and `NO_COLOR`/`FORCE_COLOR` warnings, with no threshold relaxation |
| Source/style/inventories | **57 adopted style modules; 644 production sources, 0 unused; UI 65/29/19/9**; whitespace clean |

Root logs are `/tmp/coast-menu-final-units-2.log`, `/tmp/coast-menu-all-db-final-2.log`, `/tmp/coast-menu-recovery-0076.log`, `/tmp/coast-menu-final-check.log` and `/tmp/coast-menu-final-build-2.log`. These are local execution receipts; test run duration is not an application-latency result.

Following the subsequent deep-review corrections and final rendered comparison, root reran the complete gates against the frozen source:

| Final pre-PR gate | Executed result |
| --- | --- |
| Complete unit selection | **1,159 passed, 833 guarded skips, 0 failed; 37,680 assertions across 346 files** |
| Complete disposable-database selection | **108 suites, 770 passed, 0 failed; 6,369 assertions** |
| Type/Svelte check | **0 errors, 0 warnings** |
| Production build | Passed; existing oversized-chunk and environment color warnings retained |
| Source/style/inventories | **57 adopted style modules; 644 production sources, 0 unused, 79 roots; UI 65/29/19/9**; whitespace clean |

Final logs are `/tmp/coast-menu-review-final-units.log`, `/tmp/coast-menu-review-final-db.log`, `/tmp/coast-menu-review-frozen-check.log` and `/tmp/coast-menu-review-final-build.log`. These green gates supersede the earlier epoch for the current implementation. Guarded skips, existing retained performance blockers and the specifically unexecuted natural-data/device/load methods are not promoted by that result. Materials are unchanged and remain deferred.

## Rendered synthetic proof through CUA

Root exercised the existing visible browser against the scratch-only `/ui-preview/menu-proof` route. The fixture mounts actual `Shelf`, `MediaCard`, `WorkMenu` and shared filter/menu components, with an isolated counted transport that cannot fall back to live provider commands. No additional browser process was started by this audit agent. These observations establish rendered demand/cancellation behavior for the exercised synthetic workload, not native provider access, production latency or a browser memory plateau.

| Workload/action | Observed counts or state |
| --- | --- |
| 100 actual cards, after hydration | Action reads **0**, list reads **0**, request-option reads **0** |
| Open the first card's menu | Action reads **1** |
| Close/reopen that unchanged menu ten times | Action reads remain **1** |
| First open of Lists | List reads **1** |
| First open of Request | Request-option reads **1** |
| Separate 20-card workload, after hydration | Action/list/request-option reads **0**; opening its first menu raises action reads to **1** |
| Keyboard selection of the Extended version radio | The menu stays open; Escape restores focus to Resume |
| Browser health | Recorded browser errors: **[]** |

At the final preview epoch, root also opened the actual Book menu's Share → Create disposable link flow. The titled native dialog exposed the synthetic Jellyfin source and six-hour expiry; Create produced Copy/Revoke and a preview-only invitation. Turning the connected-capability condition off removed that action while Recommend/Plan remained. At **390 × 844**, Manage used the existing drill-down with Back. Recorded console errors and warnings were **[]**. A preview-only `aria-hidden` ancestor caught during that rendered pass was removed; these fixture checks do not establish a real anonymous provider reading journey. Root retained local captures at `/tmp/coast-reading-share-preview.jpg`, `/tmp/coast-menu-narrow.jpg` and `/tmp/coast-menu-desktop.jpg`.

The subsequent deep rendered comparison covered **11 media variants, 9 filter variants, 17 other menu families and 8 Episode flyouts**. Root compared the actual menu tree against the retained approved draft, including main action order, separators, conditional branches and labels. Main order/groups matched; deliberate conditional differences were retained rather than adding inert actions. The review corrected fixture condition/medium controls, source-choice targeting, quick-toggle fill and rating/write guards, and a shared-reader/party coupling found in that pass. It did not adopt material changes or reintroduce removed top-level actions.

At device-pixel ratio **1.6**, root measured exactly matching draft/implementation geometry: **223.994px width, 18px container radius, 14.875px row radius, 10px padding on all four sides, 40px action/star/quick-control heights and the same snapped 2px gaps**. The detached specimen initially missed production's device-pixel snapping; its inline preview action now applies that same unit and owns one resize listener, removed on destruction. This is preview fidelity, not a material/production-geometry redesign.

The final fresh CUA pass exercised Watchlist on/off, profile background on/off, a rating surviving another write, visible selected/hover fills and destructive text measured at **rgb(255, 180, 171)**. Conditional End rewatch, Finish check-in and metadata Refresh were reachable; pending playback was disabled with no submenu. Header navigation condition toggles correctly exposed Music, Books and Comics. Console errors/warnings were **[]**. Root retained `/tmp/coast-menu-draft-final.jpg`, `/tmp/coast-menu-implemented-final.jpg`, `/tmp/coast-menu-structure-comparison.json`, `/tmp/coast-menu-branch-comparison.json`, `/tmp/coast-filter-comparison.json` and `/tmp/coast-other-menu-comparison.json`. This is synthetic rendered parity/interaction acceptance for the exercised variants; physical-device/screen-reader, natural provider mutations and sustained resource measurements remain separate.

With recommendation responses held by the isolated transport, root observed the following sequence. Counts are absolute for that workload; the initial recommendation response was read 1.

| Action | Recommendation reads | Aborted reads | Pending reads |
| --- | ---: | ---: | ---: |
| Select Movies | 2 | 0 | 1 |
| Select Shows before delivery | 3 | 1 | 1 |
| Reset filters before delivery | 4 | 2 | 1 |
| Release the retained response | 4 | 2 | 0 |
| Hold another Movies read, then unmount | 5 | 3 | 0 |

Reset therefore admitted exactly one replacement read. Each obsolete held response was canceled, and unmount released the remaining pending read. This adds rendered proof to the source-level single-request reset and late-publication regressions above.

`catalogue-history-db.test.ts`, `music-artists-db.test.ts`, `reading-sessions-db.test.ts` and the medium command fixtures protect the new domain rules. Their latest executed results belong to the root/domain acceptance report; a test file's presence alone is not a passing result. Disposable-database fixtures do not substitute for natural provider history or production-size plans.

## Materials are outside this main-work epoch

The user instructed the team to pause the material investigation and revert all of its changes. Its rendering artifact remains unresolved and deferred outside the main menu work. No material candidate, sampling-region result or renderer-fix claim belongs to this follow-up's acceptance or source refresh. Menu read-count and keyboard observations above are independent of that deferred investigation.

## Remaining acceptance

The follow-up source receipt includes this report and the executed root/browser results, preserves the earlier receipt, and continues exact predecessor chaining. Full native provider/auth journeys, physical touch/keyboard/screen-reader acceptance, real-file/party behavior, sustained resource plateaus and large-catalogue plan/latency comparisons remain distinct. The retained performance-audit blockers and rejected optimizations are unchanged. There is no blanket cross-provider or production-performance certification.

Disposable website reading links were subsequently added to the approved main-work scope and have the bounded source/fixture and actual CBZ acceptance above. The complete gates and source receipt bind their recorded local epoch. Earlier publication instructions required that the user must explicitly approve opening a pull request or merging this work. The user subsequently gave that approval, conditional on this deeper review and green checks. Those local review/gate conditions are now satisfied; publication and CI/merge remain separate actions owned by the parent agent.
