# App housekeeping and live-data verification

The comparison starts at `b7208c05225a69005eba1b6b81731d1b1ac2ff70`, the merge of the Personalise width fix. A complete logical restore of the live database into local PostgreSQL 17 contained 93 applied migrations, 382,873 works and six user records. The audit account had 18 capabilities enabled, including every experiment except the Settings redesign. Developer mode admitted the Progress experiment. The restored app used an independent data directory and paused copied workers and backups. The original deployment served only the read-only export.

## Changes

- Feature policy projects the three preferences it uses. Command checks read policy and account data in one SQL statement. Integration listings also fetch only the required columns and group connected accounts once. Encrypted credentials stay in the database when the list needs only a configured indicator.
- Search keeps the first ordered, viewer-scoped screen result when enrichment attempts no imports. It reads again after any attempted batch, including a partial failure. The initial cap and resulting truncation still use 101 fetched rows for 100 displayed results.
- Admin Overview shows the existing summary immediately and opens the cross-account report through Show missing demand. Both Settings layouts share the report renderer. Direct pagination keeps the report open, and cancelled reads release the existing database query scope.
- Jobs skips the catalogue due-date calculation in Developer mode. The page still reports connection eligibility, state and last runs.
- Planning owns its service and dialog under `src/lib/planning`. The page uses the common heading and medium selector. The dialog uses the shared switch and form actions. Shared playback and party invitation pages use the application heading and content spacing, reflected in the preview.
- One unused card radius token and two duplicate values were removed. The coarse-pointer checkbox height and toast radius use their established shared tokens. The source inventory found zero unreachable modules across the application roots, preview and tooling.

## Measurements

The native reads ran locally with Bun 1.4.4 canary on macOS and a PostgreSQL 17 container. Feature checks and provider lists retained equal complete ordered outputs across six accounts and the anonymous and missing-account states where applicable. Projection sizes compare aggregate text values for the selected fields and JSON row sizes for the provider results. They exclude PostgreSQL protocol overhead.

| Sample | Before | After |
| --- | ---: | ---: |
| Feature settings values across six accounts | 46,042 B | 1,683 B |
| Provider instance projection across the snapshot | 6,423 B | 4,301 B |
| Provider connection projection across the snapshot | 24,668 B | 20,836 B |
| Search median across four local queries, two measured rounds | 381 ms | 297 ms |
| Paused Jobs timing read median, five alternating pairs | 1,178 ms | 731 ms |
| Admin Overview complete HTTP document, one observed pair | 9.21 s | 1.02 s |

Search samples before were 358, 364, 365, 378, 383, 398, 655 and 672 ms. Samples after were 208, 213, 228, 288, 305, 340, 550 and 566 ms. Complete results matched, including per-query counts of 100, 100, 53 and 53. The copied installation had no usable provider secrets in the audit runtime. This measurement covers the local search path when enrichment makes no writes.

Paused Jobs samples before were 1,228, 1,178, 1,200, 1,123 and 1,057 ms. Samples after were 779, 819, 721, 695 and 731 ms. Each pair returned the same 40 timing rows. Active scheduling is covered separately by the native database suites.

The Admin Overview trace distinguished response headers from complete document time. The cross-account demand calculation took 6.62 s in an isolated API call on the same store and 17.07 s during a concurrent browser check. Moving it out of the initial request reduces default work while the explicit report still performs the complete calculation.

## Verification boundaries

The browser used the local built app and restored catalogue at 1,440 × 900 and 390 × 844. Across 46 routes and route configurations it exercised For You, Discover, the four Library media views, Progress, Planning, Search, profile and lists, media details, the design reference and the classic Settings sections. It also opened Personalise, changed Planning medium, and verified explicit and deep-linked missing demand. A separate fixture covered the Planning switch, onboarding and an ended party at both widths. The build retains two large on-demand chunks for HLS and the physical reader. A fresh Login, For You and Watch Library visit requested neither. Provider writes, media decoding, real-device rendering and sustained concurrent production load require separate acceptance. Type checking, the production build, the UI and source inventories, 1,360 unit tests and 151 distinct tests from nine PostgreSQL suites passed.

The [source refresh](2026-11-26-app-housekeeping-source-refresh.json) advances the changed source pins and records the Planning moves. Prior audit evidence remains at its original source and data snapshots.
