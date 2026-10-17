# Comic collection metadata investigation

Investigated 17 October 2026 against Coast `2dded65d78b2c38154eb168e6b912ee3d4bdd538`, including the current uncommitted issue-row changes. This is research and an implementation proposal; no provider, account, dependency, schema or runtime setting was added. Existing development data was not changed.

## Result

The requested **Harley Quinn: The Animated Series → collected volumes → original issues** relationship exists as structured data in **GCD API v2 on `beta.comics.org`**. The corresponding production v2 route returned 404. GCD production v1 supplies the parent and collected volumes, but the inspected issue responses omit structured reprint links. Metron has useful explicit reprint and cross-provider identity contracts, but requires a user token. Hardcover has series and compilation metadata, but its exact coverage and complete containment contract remain unverified without authentication.

Do not add all three providers speculatively. GCD is the strongest demonstrated hierarchy source. Its beta status and the identity bridge to Coast's saved Comic Vine issues need resolution before a production implementation. Metron is a possible optional identity/enrichment source; Hardcover is a broader book-series candidate.

## Evidence and limits

All requests were read-only. Public catalogue queries used no account credentials. Remote bodies were capped at 2 MiB with 20–25 second timeouts. Checks requested known records and bounded pages rather than crawling catalogues. The compact [evidence record](2026-10-17-comic-collection-provider-evidence.json) retains IDs and counts; temporary full public responses are outside the repository.

| Check | Observed result |
| --- | --- |
| GCD production `/api/series/188558/?format=json` | 200; exact parent, two member URLs and descriptors |
| GCD production `/api/issue/2427253/?format=json` | 200; Volume 1, ISBN `9781779516640`, parent series, textual collection note; no structured reprint field |
| GCD production `/api/issue/2567801/?format=json` | 200; Volume 2, ISBN `9781779522894`, parent series, textual collection note; no structured reprint field |
| GCD production `/api/issue/2440295/?format=json` | 200; original Legion of Bats issue #1, separate run identity; no structured collected-volume link |
| GCD production `/api/v2/series/188558/` | 404 |
| GCD beta `/api/v2/series/188558/` | 200; parent identity and two collected-volume IDs |
| GCD beta `/api/v2/issues/?series=188558&variant_of=false&page_size=10` | 200; exactly two volumes, no next page |
| GCD beta `/api/v2/reprints/?target_issue=…&page_size=50` for each volume | 200; all 27 and 35 reprint observations fit in one page each |
| GCD beta `/api/v2/stories/?issue=…&page_size=50` for each volume | 200; all 15 and 38 target story records fit in one page each; every returned issue ID matched the requested volume |
| Metron `/api/series/?name=Harley%20Quinn&limit=10` without credentials | 401, authentication required; this says nothing about catalogue coverage |
| Hardcover read-only GraphQL `books(limit: 1) { id title }` without credentials | 400, `No Authorization header`; exact title coverage not tested |

The six successful GCD beta responses totalled 44,637 response-body bytes. This is one small, warm/unknown-cache catalogue sample, not a latency benchmark, scale guarantee or production acceptance result. GCD's `api-v2` source snapshot was `51251f0f82c1c198b6439dcb19c34c2a71b97069`.

## Verified Harley Quinn structure

Parent GCD series **188558**, *Harley Quinn: The Animated Series*:

| Collected volume | GCD work | Confirmed story-bearing source issues |
| --- | --- | --- |
| 1 — The Eat. Bang! Kill. Tour | 2427253 | 2262124, 2268026, 2274459, 2286071, 2297299, 2306165: issues #1–6 |
| 2 — Legion of Bats! | 2567801 | 2426940: Real Sidekicks special; then 2440295, 2449881, 2466153, 2479026, 2494777, 2507184: Legion of Bats #1–6 |

These are **collected books**, not merely alternate names for Comic Vine runs. A special from a different run can belong to the same collected book. The hierarchy is therefore not an exclusive TV-style tree internally, even if the page can present a familiar volume picker and issues row.

Raw reprints cannot be treated as issue membership. They included 20 distinct source issue records for Volume 1 and 22 for Volume 2, due to cover and variant material. Joining each observation's target story to the volume's story list, selecting the returned `comic story` type, then deduplicating source issue IDs yielded the expected six and seven members. Their earliest target `sequence_number` establishes their order inside this edition; reprint IDs and issue numbers alone do not. Cover-only appearances are not a readable issue inclusion. This rule was checked on these two books only; partial stories, extracts, uncertain links and other publication types still need explicit handling and acceptance fixtures.

Sources: [parent](https://www.comics.org/series/188558/), [Volume 1](https://www.comics.org/issue/2427253/), [Volume 2](https://www.comics.org/issue/2567801/), [publisher's Volume 2 description](https://www.penguinrandomhouse.com/books/735654/harley-quinn-the-animated-series-volume-2-legion-of-bats-by-tee-franklin/).

## Provider assessment

### GCD

Production v1 has explicit series membership, volume numbers, ISBNs, publication facts, covers and story metadata. Its [published API serializers](https://github.com/GrandComicsDatabase/gcd-django/blob/master/apps/api/serializers.py) agree with the live responses: no typed reprint edges. The collection note is evidence for a human, not a safe identity parser.

V2 has typed reprints with origin/target issue and story IDs, story types and sequence numbers, paginated issue/story/reprint queries, and typed series bonds. A series bond's relationship type must be interpreted; a related, continued or translated series is not automatically a parent collection. Reprints and series bonds have [published source](https://github.com/GrandComicsDatabase/gcd-django/tree/api-v2/apps/api_v2) and were added on the separate [v2 branch](https://github.com/GrandComicsDatabase/gcd-django/pull/716). V2 beta worked live, but the production route did not.

The [API documentation](https://github.com/GrandComicsDatabase/gcd-django/wiki/API) warns that fields/formats can change. Published defaults are 30 anonymous requests/hour and 2,000 authenticated requests/day; these are source/documented budgets, not a measured guarantee about deployment overrides. Catalogue data carries CC BY-SA 4.0 attribution/share-alike terms; cover image rights are separate, as stated in GCD's page footers. A production integration needs explicit attribution and separate treatment of artwork.

**Fit:** best demonstrated source for this collection. Use beta only as an explicitly accepted experimental source; do not silently depend on a beta host or silently fall back to incomplete v1 data. No verified automatic GCD-to-Comic-Vine issue crosswalk was established by the inspected responses.

### Metron

The [series model](https://github.com/Metron-Project/metron/blob/master/comicsdb/models/series.py) distinguishes series format and run volume. Its `associated` relation is a self-referencing many-to-many association, not a directed collection parent. The [issue read serializer](https://github.com/Metron-Project/metron/blob/master/api/v1_0/serializers/issue.py) exposes explicit `reprints` as issue IDs, and issue/series contracts include Comic Vine and GCD IDs. These could bridge exact saved identities without title matching. Story arcs, universes and reading lists are separate concepts, not interchangeable parents.

The [official access terms](https://metron-project.github.io/blog/commercial-api-use) permit free/commercial use with CC BY-SA requirements and separate cover rights. They explicitly require each user of a multi-user app or self-hosted server to have their own account/token. Standard limits are 20 requests/minute and 5,000/day, with supporter increases. This differs from Coast's administrator-owned Comic Vine metadata connection. A bundled or shared administrator token must not be assumed acceptable. Tokens stay server-side and rate limits/caches must respect the authenticated source.

**Fit:** useful optional metadata/identity bridge, pending a real user token and verification that these exact collection records have the required IDs and reprint membership. Its contract is not proof of Harley Quinn coverage. No authenticated requests or account creation were attempted.

### Hardcover

The [published GraphQL schema](https://github.com/hardcoverapp/hardcover-docs/blob/main/schema.graphql) has series identities and ordered `book_series` membership, compilation flags, editions/ISBNs and partial-book parent relationships. Its [field descriptions](https://github.com/hardcoverapp/hardcover-docs/blob/main/field-descriptions.json) describe `parent_book` as a partial entry's complete book; that is not a universal franchise hierarchy. `book_series.compilation` and `position` alone do not identify every issue inside a compilation.

Its [comic standards](https://docs.hardcover.app/librarians/standards/comicstandards/) call for separate issue/collected-format series and compilation membership. Those cataloguing rules are not evidence that every title is fully entered or that a complete containment query works. Authenticated coverage and a returned containment example remain required.

The [API guide](https://docs.hardcover.app/api/getting-started/) documents account tokens, backend-only requests, beta changes, 60 requests/minute and query-depth restrictions. The guide also contains offline-use restrictions; deployed multi-user use needs clarification rather than assuming these terms permit a global metadata service. No per-call price was established, and account availability is not an unrestricted data redistribution licence.

**Fit:** promising for general book series and collected editions, with weaker demonstrated fit for this particular comic hierarchy. No authenticated catalogue query, exact Harley Quinn match or complete containment response was verified.

## Coast integration plan

Current ownership is already suitable for most of the UI and request lifecycle:

- `src/lib/providers/reading.server.ts` owns metadata composition, bounded caches and single-flight requests; concrete adapters validate external responses through the shared approved transport.
- `src/lib/reading/model.ts` currently accepts only Open Library and Comic Vine work identities, with a Comic Vine-only run group contract.
- `src/lib/server/db/schema.ts` constrains `reading_groups` to Comic Vine `4050-…` runs. Membership currently targets saved reading works, with no group-to-group or work-to-work containment relation.
- `src/lib/catalogue/reading.server.ts` locks exact identities and preserves saved UUIDs/state. Its current single-run import replaces other memberships from that provider; that behavior cannot be reused unchanged for overlapping collected books.
- `src/lib/reading/groups.server.ts` and the shared Shelf detail source already support lazy paginated issues, canonical card hydration and a full run page. There is no reason to invent a second catalogue or custom row loader.

Proposed sequence, subject to the source/access decisions above:

1. **Verify the source and identity bridge.** Confirm whether beta GCD use is acceptable or wait for production v2. With an authorized Metron token, query the known Comic Vine issue/run IDs and GCD collection IDs; require actual cross-references. Keep explicit curation available when a bridge is absent. Do not match identities by similar names, sequence numbers or cover hashes.
2. **Represent collection semantics explicitly.** Extend the existing verified group contract for a parent collection series. Represent a readable collected volume as its own work, separate from original issues and from editions of that work. Add ordered, provenance-bearing containment only where required. Retain many-to-many membership, distinguish complete issues from partial extracts and cover-only reprints, and preserve independent reading progress. This needs a reviewed schema change; it has not been implemented here.
3. **Enrich on demand.** Resolve the exact selected parent/volume in the provider layer. Apply the existing priority lane, `Retry-After`, source-scoped bounded caches, cancellation and 2 MiB response cap. Follow every required membership page before treating a snapshot as complete. Yield any durable refresh through the existing queue. Never hold database locks during provider calls or scan the whole provider catalogue on connection.
4. **Reuse the approved presentation.** Parent series hero, volume selector/row, selected volume's ordered issues using MediaPage, Shelf, MediaCard and normal menus. Existing run links stay useful. Searching, Library and detail navigation share canonical identities; no provider-specific catalogue screens. Hydrate a bounded page together with the viewer's state. Metadata membership never grants file access or implies that an issue has a standalone local file.
5. **Verify before enabling.** Cover the two Harley Quinn volumes, special placement, variant/cover exclusion, overlapping collections, partial-story ambiguity, paginated completion, source corrections, repeated unchanged refreshes, concurrent identity enrichment, outage/429/cancellation, token rotation and permission changes. Confirm that existing UUIDs, progress, Jellyfin file links, parties and availability survive enrichment. Use disposable fixtures/databases and the existing performance acceptance criteria.

## Remaining decisions and acceptance gaps

- Accept GCD beta as an experimental integration, or wait for production v2. No host/configuration change was made.
- Metron and Hardcover require authorized account tokens before exact-title live coverage can be verified. None were located or requested from unrelated credentials.
- Exact cross-provider identity mapping remains unproven. ISBNs can locate a collected edition; they do not identify each original issue or prove two works are identical.
- Source attribution, storage/redistribution terms and image rights must be reflected in any implemented provider. No project licence was changed.
- The richer relationship schema and UI above are a plan, not shipped functionality. Current dev still uses the existing Comic Vine run-to-issues flow.

## Follow-up: direct bridges and Metron registration

Later on 17 October, the public Metron registration page displayed **Signups Disabled**, with a notice to check back Saturday afternoon (EST). No account, password, Keychain entry or API token was created. The user subsequently expressed a preference against Metron; leave it out of the proposed integration for now.

Public catalogue inspection did verify one exact Metron crosswalk, without an API account: Real Sidekicks special issue Metron **51988** links Comic Vine **4000-944692** and GCD **2426940**. Its run Metron **3777** links Comic Vine **4050-144830** and GCD series **188523**. This establishes coverage for that record only, not a complete crosswalk for both runs. It does not authorize scraping as an alternative to the authenticated API.

Metron is not necessary to match the two collected books: public Open Library ISBN lookups returned **9781779516640 → OL38019183M → OL27823247W** and **9781779522894 → OL46824526M → OL34517046W**. GCD's exact collected-volume records expose those same ISBNs. An ISBN establishes the publication/edition match; it does not itself identify the original issues or their membership. The two inspected Open Library edition records had no `identifiers` dictionary or `links` field. Coast's current Open Library adapter retains one explicitly labelled Comic Vine issue link when present; neither its shared identity model nor the Comic Vine adapter currently retains GCD identities. No reliable direct Comic Vine-to-GCD identifier contract has been established here.

Revised direction: GCD for verified hierarchy, Open Library/ISBN for the collected publications, and existing Comic Vine identities for saved original issues. A verified bridge or explicit mapping for individual issues remains necessary; do not substitute title matching or guess that it has been solved by the ISBN route.
