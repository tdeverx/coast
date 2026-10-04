# Coast source of truth

[The complete build brief](brief.md) records the build requirements. Later approved product changes are detailed in [Behaviour](behaviour.md), [Collection and Library](collection.md) and [Design](design.md). The persistent video players and shared audio controls supersede the initial single-player proposal.

## Product and contracts

- [Scope and delivery](scope.md): release boundary and delivery checklist.
- [Behaviour](behaviour.md): tracking, metadata, playback and queue semantics.
- [Canonical domain](domain-model.md): schema, transactions and read models.
- [Collection and Library](collection.md): personal membership, user access, missing demand and Trakt projection.
- [Background catalogue maintenance](catalogue-maintenance.md): missing user-linked TMDB records and shared metadata refresh.
- [Sync conflict repair](sync-review.md): comparison fixes and the approved dev-data repair.
- [Provider boundaries](providers.md): adapter behavior and verification limits.
- [Music](music.md): persisted identities, browsing, listening, audio playback and verification limits.
- [Games](games.md): metadata, shared relationships and private playthrough details.
- [Social target and roadmap](social.md): first-pass implementation, privacy decisions and deferred social work.
- [Future connector contract](connectors.md): proposed HTTP/webhook boundary; not implemented.
- [Design](design.md): inherited visual language and UI composition.
- [Chart preview](chart-preview.md): non-approved chart families, fictional fixtures and preview isolation.
- [Synced experiences and invitation onboarding](synced-experiences.md) — experimental playback sessions and initial-import registration.
- [Invitations and experiments](invitations.md): signup links, provisioning, disposable playback and four first passes.
- [Public API](public-api.md): scoped tokens, reads, writes, signed webhooks, pagination and errors.

## Operations and development

- [Architecture](architecture.md): domain, database, service boundaries and security.
- [Deployment](deployment.md): container, storage, accounts and recovery.
- [Performance methods](performance.md): shared optimisation patterns, benchmarks, isolated measurements and acceptance checks.
- [Diagnostic logging](diagnostic-logging.md): safe exports, bounded logs and persistent exit evidence.
- [Verification platform](verification-platform.md): inventories, fixtures and isolated database testing.
- [Experimental features](experimental-features.md): independent gates and preserved data.

## Evidence and roadmap

- [Performance implementation — 3 October](audits/2026-10-03-performance-implementation.md): controlled query/revision measurements, client work and benchmark verification.
- [Frontend performance evidence](audits/2026-10-03-frontend-performance-implementation.md) and [server performance evidence](audits/2026-10-03-server-performance-implementation.md): focused findings and acceptance limits.

- [Open questions](open-questions.md): unresolved product and validation needs.
- [Readiness](readiness.md): evidence, known gaps and post-1.0 work.
- [Audit implementation](audits/2026-10-02-implementation.md): immediate repairs, consolidation, measured query improvements and verification limits.
- [Whole-codebase audit — 2 October 2026](audits/2026-10-02.md): findings, coverage, ownership recommendations and ordered follow-up passes.
- [App follow-up roadmap](roadmap.md): agreed priorities and deferred UX exploration.
- [Audit follow-up verification](audits/2026-10-02-follow-up.md): retention/recovery, accessibility, playback lifecycle, provider parity and failure remedies.
- [Selected audit follow-ups — 3 October](audits/2026-10-03-selected-follow-ups.md): read-only API, consolidation, accessibility, empty shelves and playback evidence.

Keep the readiness report honest: implementation is not proof of a live provider journey. Dated audits preserve their original evidence; use the performance guide for current working methods.
