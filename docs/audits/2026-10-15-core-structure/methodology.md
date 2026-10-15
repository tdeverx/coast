# Audit method and boundaries

The user requested a broad organization check followed by independent feature-level deep audits and a deduplicated combined report. This audit records the current working tree, including untracked implementations, rather than treating a clean historical commit as the product under review.

Application code, tests, configuration, dependencies, dev/live database contents and live services are not changed. Audit documents are the only repository writes. Read-only source inspection and existing pure tests run independently; root owns builds and any isolated database verification. Database suites use `scripts/test-database.ts` to create/drop fresh synthetic databases, never the configured admin database, dev database or live database.

Each specialist writes a separate Markdown report and structured JSON. Reports distinguish substantive reading, automated scans and unverified areas. They retain findings supported by actual callers and consequences; questions without a reachable trigger remain separate. Passing tests are reported as evidence for their specific contracts, not proof that untested behavior is correct.

Root checks reported evidence and groups findings by root cause and the necessary correction, not by similar wording. A single flaw with several affected screens keeps one canonical flag with all original report IDs and references. Different invariants requiring different corrections remain separate even when they share a file. Priority, confidence, known roadmap overlap and verification limits remain visible. Cosmetic preferences, a long file alone, intentionally retained protocols and deferred import groups are not promoted to high-severity defects.

## Work division

| Report | Assigned area |
| --- | --- |
| 00 | Repository names, tree, imports, dependency groups and baseline checks |
| 01 | Authentication, setup, onboarding, invitations, account/settings/access policy |
| 02 | Durable jobs, scheduling, Trakt/Seerr delivery, staging and conflict reconciliation |
| 03 | Jellyfin catalogue/access, companion feed, user reconciliation and live observations |
| 04 | Canonical domain writes, metadata, Collection/Library/lists/progress/profile read models |
| 05 | Search, Discover, For You, recommendations and planning/detail experiments |
| 06 | Books/comics providers, identity, progress and file readers |
| 07 | Playback, shared links, stream delivery and media-controller lifecycle |
| 08 | Friends, presence, parties, notifications and social privacy/taste |
| 09 | Public API, webhooks and browser API dispatch consistency |
| 10 | Shared UI, shelves, cards, materials, charts, accessibility and resource lifecycle |
| 11 | Music/gaming, Steam/IGDB, medium-specific tracking and provider parity |
| 12 | Database/migrations, common security/network/storage, runtime/deployment, benchmarks and verification tooling |

The specialist scopes intentionally cross at direct callers. This is useful corroboration, not permission to count the same defect multiple times. Final coverage should be read together with each report's explicit limitations. No static review can establish all real-provider, physical-device, concurrency or deployment behavior.
