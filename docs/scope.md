# Product scope

Coast owns canonical movie and television tracking and remains useful without an external service. The 1.0 scope includes local accounts; watched state, progress, history, collection, watchlist, favourites, dropped state, ratings and ordered lists; TMDB metadata and discovery; per-user Jellyfin availability and playback; optional Trakt exchange; Seerr requests; durable external actions; notifications; unified settings and administration; bundled or external PostgreSQL.

Primary destinations are For You, Collection, Library, Discover and Search. Secondary destinations are details, lists, requests, notifications and settings. Collection and Library reuse lazy rows and expanded grids. Every work has a stable Coast URL. The approved [Collection and Library](collection.md) extension separates personal membership from server access and adds music listening/audio and shared game relationships under existing experimental gates.

## Delivery

1. Documentation and concrete canonical schema.
2. Local authentication and first-run setup.
3. Metadata, tracking, ratings, lists and history.
4. Provider contracts and integrations.
5. Availability, playback and external action processing.
6. Consolidated interface and administration.
7. Verification, deployment and readiness assessment.

The [readiness report](readiness.md) tracks acceptance evidence against the complete brief. There is no automatic promotion to 1.0 on a successful build.

## Non-goals

No cloud service, telemetry, proprietary dependency, microservices, browser offline mode, invitation platform, general plugin runtime, FFmpeg distribution, or speculative future-provider implementation. Books, audiobooks and comics can add concrete tables later; their UI is not implemented. Music and games have approved experimental implementations. No compatibility migrations are required for discarded private 0.x schemas.

The first [social pass](social.md) is implemented, superseding the original social-system exclusion. This includes an administrator choice between a private website and designated public read-only surfaces, while preserving user privacy and authenticated account actions. Its deferred roadmap, including invitations, remains outside the current implementation.

Licensing is explicitly AGPL-3.0-only, contributions inbound-equals-outbound. The application and corresponding build source must remain available for every distribution, including paid releases. Inter is separately distributed under OFL-1.1. Dependency licences are recorded in THIRD_PARTY_NOTICES.md.
