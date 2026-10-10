# Books and comics

Books and Comics are independent, disabled-by-default experiments in **Settings → Policies → Experimental features**. Open Library supplies books and comics, including graphic novels; Comic Vine supplies comic issues. Neither requires Jellyfin. Reading uses Coast's existing media experience, with an optional lazy file reader for PDF, EPUB and CBZ.

## Browse and track

Search combines all enabled media into **Available** and **Unavailable** rows, with shared media-type segments including Books and Comics. Use **Read** in Discover, Library, Continue, Next and Favourites. Books/comics are filters within those shared views, with the usual Shelf headers, cards, menus, skeletons, relationships and pagination. There are no separate browsing pages. Saved details use `/media/{workId}`, including the shared hero and optional detail overlay. Unsaved provider previews resolve to the canonical page when that identity is already stored.

Search renders bounded local results first, then streams enabled provider results without repeating the local query. Media-type segments filter each row locally without navigation or another provider request, following the existing Search shelf pattern. Both rows use Shelf's standard lazy card loading and horizontal scroll. Search stays bounded: deeper provider results require refining the query, rather than paging controls or an additional loading path. Provider-only reading cards carry `available: false`; only observed files on the viewer's connected account set it to true. The shared MediaCard applies the missing-artwork monochrome preference to every medium, never to guests. Comic Vine source attribution remains visible. Discover uses Open Library's trending rank and first-publication-year ordering, and Comic Vine's store-date release feed. Comic Vine has no supported popularity feed; Coast explains that limitation instead of calling recent edits trending. Search/discovery do not import every result or fetch details for every card. Explicit additions initialize Planned only if the user has no existing progress.

Search uses shared relevance across media: normalized exact titles, title prefixes and phrases precede word matches and typo-tolerant matches. Series and authors contribute secondary matches; equal scores retain source order. Local candidate queries use indexed full-text search before bounded hydration. Comic Vine search looks up matching series as well as issue names, then fetches one bounded issue page for at most two series. A successful empty provider response may trigger one broader query; failures and rate limits do not trigger this fallback.

The metadata source does not determine the medium. Open Library subjects identify comics, and either source can resolve to the same saved comic UUID through registered provider identities. An Open Library work's dedicated Comic Vine issue link can register that association during explicit import. Search then resolves both identities in one batched lookup, retaining the saved record and personal progress. Matching names alone never merge a collected volume, edition or issue. If the identities already belong to different saved records, import reports a conflict and preserves both records. Reclassifying an existing Open Library work from Book to Comic retains its UUID and progress.

Library supports the shared Collection, Available, subtype and reading-state filters. Available means an observed file on that user's connected server, not a friend's access or a metadata result. A local file stays in the browser and does not create a server-library availability claim. Continue includes Reading/Paused; Next includes planned reads and explicit saved relationships. Page totals use the common card progress component.

Collection preserves Reading's source/availability filters, and Reading and Paused remain distinct selections. Fresh file observations establish positive availability without waiting for a full movie/show scan. Missing reading-file observations remain Unknown; a screen-library census does not prove that a book is unavailable. Reader cancellation interrupts outstanding decoder waits, and each format removes only its own rendered content when closing or failing.

States are Planned, Reading, Completed, Paused and Dropped. Completion is explicit: the last page does not automatically complete a read. Reopening a completed file preserves completion; Reread explicitly resets bookmarks and starts another reading period. State changes produce dated history and Activity events; page turns update progress without flooding Activity. Existing progress is not backfilled with invented historical events. Ratings, lists, favourites and collection rules use the shared work UUID and category privacy.

Reactions and friend recommendations use shared social controls and category privacy. The notification inbox includes Reading and excludes disabled media from cards and unread counts. Received friend recommendations use the same persistent Recommendations row, Reading segment, subtype filters and recipient-only access rules. Reading participates in cached taste/recommendation signals through subjects, authors, series and personal state. Dropped works contribute negative evidence. Dynamic rows remain lazy and use the same ranking, loading and heading links as other media. Upcoming uses exact comic store dates when present; a book's publication year is not converted into a fictional release day. Author and series labels search their metadata; they are not fabricated person or volume entities.

## Read your own files

Select **Read** on a saved title and choose a local file or a file from your connected Jellyfin account. Local files are limited to 128 MiB and stay in your browser. A lazy worker computes their content digest for edition identity; Coast stores the identity and position, never the file bytes. Reopening the same file resumes its bookmark. Show UI minimizes the reader without ending its session; Resume reading restores it. Closing releases rendering resources and saves the final position.

PDF and CBZ synchronize numbered pages. EPUB synchronizes a canonical fragment identifier (CFI), so another viewport can display the same content even when its visual page breaks differ. EPUB's displayed fraction is approximate and does not overwrite the page total of a physical edition.

Only the selected format's renderer is imported when the reader opens:

- PDF uses `pdfjs-dist` with its separate worker and one rendered page. Rendering cancels superseded work, limits resolution and releases page/document resources.
- CBZ uses `@zip.js/zip.js`, natural page ordering and one decoded image/object URL at a time. Archives are bounded to 10,000 entries, 512 MiB declared expanded size, 32 MiB per page and 32 megapixels per image. Remote archives can use byte ranges.
- EPUB uses `epubjs` with one paginated view. Archives are bounded to 128 MiB compressed, 256 MiB declared expanded size, 10,000 entries and 32 MiB per entry. Package XML has a separate 2 MiB limit. Scripts, forms, embedded frames and event attributes are removed; the content iframe disallows scripts and uses a restrictive content security policy. External manifest resources are rejected and external links disabled.

Reading sessions expire after 24 hours. Foreground reader heartbeats support live activity; progress and bookmarks persist separately from that transient presence. Expired duplicate sessions are pruned after 30 days while retaining the newest bookmark per user/work/edition/format. Reading history persists. Fast page turns coalesce behind one write at a time, and close drains the final position before closing the session.

Kindle, CBR/CB7/CBT, DRM, audiobooks and cross-format location conversion are not supported by these readers. A valid filename does not guarantee that a malformed or unusually large document can render.

## Jellyfin access and imports

Jellyfin is optional. Its [book documentation](https://jellyfin.org/docs/general/server/media/books/) describes more formats than Coast's three supported readers. Coast reads Book items using authenticated, bounded `/Items` pages and rechecks `/Users/{userId}/Items/{itemId}` before opening or serving a file. Downloads pass through the authenticated Coast session; provider tokens, filesystem paths and download credentials never enter the browser DTO. Requests retain cancellation, byte limits and single-range validation.

File identity is separate from metadata identity. A Jellyfin file version is scoped to its server/item and available ETag, modification date, size and path. Opening detects a changed version before serving it. This is a server version identifier, not a byte digest: it does not automatically equate a local copy, another server's copy or a file with incomplete version metadata.

The existing Jellyfin library/user job has a Reading phase. It maps verified Open Library work IDs, resolvable edition/ISBN identifiers, exact Comic Vine issue IDs (`4000-…`), or an explicit file link the user previously chose. Titles and filenames never merge works; a Comic Vine volume or ambiguous numeric ID is not an issue. Files without verified identifiers require an explicit link through Read. Shared catalogue imports never grant another user's file access. User availability remains account/generation scoped.

Each observed item commits before saving its durable Reading cursor and yielding to the common job scheduler. Skipped/unsupported files advance that cursor too. Personal onboarding does not add a full Book scan; normal background access jobs and supported companion Book updates use the same mappings and permission fences. Incomplete scans do not publish final removals.

## Reading parties

Opening a reader can become the current item in the existing party. Members use their own authorized source: previously linked accessible files can be resolved automatically, while local readers must open their own matching copy before joining. Party state includes work, format, edition and location; matching titles or page totals alone are insufficient.

The same controller permissions and revision checks apply to page changes. Guests follow the shared location, including EPUB link navigation. Changing between video, music and reading clears incompatible source/queue/location state. Reading menus omit playback-time offsets, buffering and ready-check controls. Leaving follows the existing Keep reading preference. Parties do not distribute the host's file or grant a guest access to its server.

## Provider setup and terms

Open Library needs no key. Comic Vine requires an administrator-owned integration in **Settings → Integrations**, with encrypted server-only credentials; users do not link Comic Vine accounts. Saved metadata and progress remain usable during provider outages. Disabling an experiment filters shared reads before pagination and rejects its operations without deleting stored data.

Comic Vine allows **non-commercial use only**. Its source link appears with its metadata and remains in public DTO attribution. Review its [official API terms](https://comicvine.gamespot.com/api/) before commercial use. Open Library recommends application identification and a real contact address for regular traffic; Coast identifies its project and uses conservative pacing, but does not invent an operator email. See its [usage guidelines](https://openlibrary.org/developers/api).

Provider queries use the existing fixed-origin transport, priority lanes, cancellation, cooldowns and single-flight caches. Open Library requests are spaced at 1.1 seconds, Comic Vine at 18.1 seconds. These process-local limits do not constitute a distributed quota. Responses are capped at 2 MiB; normalized descriptions and covers are bounded and provider URLs constrained. Open Library search fetches 20 works per page. Comic Vine fetches up to 10 issue-name matches and 10 series issues, deduplicated by issue identity. Series lookup uses one request and one batched issue request when a matching series exists, with at most one additional empty-result fallback. Local hydration uses the shared 60-item bound. Search/discovery/detail caches remain bounded; network metadata lookups finish before canonical or personal transaction locks.

## Code boundaries and API

`reading/model.ts` owns shared identity/state/location contracts. Provider adapters validate remote responses; `providers/reading.server.ts` supplies metadata transport/cache composition. `catalogue/reading.server.ts` owns canonical ingestion; `catalogue/reading-files.server.ts` owns exact file links and guarded availability. `core/reading/service.server.ts` owns personal mutations. `reading/query.server.ts` owns bounded read models, and `reading/sessions.server.ts` owns authenticated file sessions. `sync/jellyfin-reading.server.ts` composes imports within the existing queue. UI uses the shared Shelf, MediaCard, MediaHero/MediaPage, Dialog, Button and progress components; reader engines are lazy format-specific modules.

Browser routes under `/api/v1/reading` provide explicit imports, progress, history, source selection and session lifecycle. Public `/api/public/v1` exposes enabled reading Catalogue/Collection/Library/Progress reads, owner-only paginated history and idempotent `reading:write` progress changes. `reading.changed` webhooks commit with the mutation. Public tokens do not open files or expose provider credentials; see [Public API](public-api.md).

## Verification and remaining acceptance

Provider/model/hash tests cover identity, bounded payloads, format locations and streamed hashing. Disposable database tests cover permissions, account generations, import resumption after yields, no-op writes, history, rereads, party controllers/revisions, scope/idempotency/webhook behavior, shared availability and cached recommendation signals. Run database tests through `scripts/test-database.ts`, never against live data.

Production-build browser fixtures exercise PDF, EPUB and CBZ on desktop and mobile, close/resume, lazy loading and two-browser page synchronization. Synthetic fixtures do not certify every real document, a deployment Comic Vine key or a live Jellyfin book/download configuration. Those deployment checks, richer author/series entities, additional formats and cross-source edition identity remain explicit follow-up work.
