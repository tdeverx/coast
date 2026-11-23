# Progress continuation and Library timings

The existing airtime fallback used the same episode alias as its caller. In Continuations, that made PostgreSQL compare an inner row to itself. Around the air date, it could search schedules from unrelated shows. The shared predicate now looks up the episode's own show by primary key and skips the schedule lookup when there is no date. Explicit timestamps, overrides, provider order, timezone validation and the older-date fallback retain their existing rules. A controlled fixture twice tests two shows with opposing schedules.

Library's Continue and Next filters now expand selected episodes and seasons to their show once. The library query applies privacy and restricts candidates before joining source availability. Counting and card hydration still use the same page boundary. Trials that put the expansion inside the broad availability join were rejected after a timeout and an 18.3-second Next read.

## Native read comparison

The application read owners ran against a single live account through PostgreSQL 17.12 in read-only sessions, with JIT off, a 23-second statement timeout and no external provider requests. Comparisons matched complete serialized responses, including cards, order and totals. These are descriptive local measurements from separate reads with production activity still present.

| Read | Original | Candidate | Result count |
| --- | ---: | ---: | ---: |
| Continue, available | 9.25 s | 1.03–1.22 s | 60 |
| Up next, all | 8.41 s | 0.71 s | 225 |
| Library Next | 7.38 s | 1.79 s | 114 |
| Library All | 0.22 s | 0.12–0.21 s | 2,712 |

The representative continuation query admitted 37,849 episodes and returned 36,608 episode state rows on both sides. Its EXPLAIN ANALYZE time fell from 8.384 s to 0.615 s. Root inclusive shared buffer accesses fell from 3,818,530 to 229,490. The old series-schedule lookup ran 1,099 times and consumed 7.686 s at that node. The Library Next count and page query fell from about 0.96–1.20 s to 0.43 s after scoping; the new parent query adds one lookup over the selected IDs. Library Continue returned 69 matching roots with a 0.31 s count and page query, compared to 0.83 s in the earlier unfenced trial using identical expanded IDs.

## Independent slow paths

The unfiltered Library read stayed below 0.23 s in these probes. Screen Collection mode took 6.58 s and 18.47 s across two equivalent responses. Its assessment query took 10.16 s in EXPLAIN ANALYZE. It recursively expanded 78,787 descendant relationships and assessed 37,291 works before returning 1,517 roots and hydrating the first 60 cards. Existing HTTP diagnostics label both Library and Collection requests as Library, so historical 11-second requests cannot be assigned to a specific filter. In the sampled logs, no slow Library request had a matching continuation timing record. Progress had a matching continuation timing on 153 of 155 requests over five seconds.

Activity's screen feed took about 1.67 s for watches and 2.24–2.41 s with all event types. It deduplicated and grouped over 27,000 event rows before paging. The live streams and stream history panels took 47 ms and 113 ms in the same probe. A policy-join experiment retained both feed responses but had mixed elapsed results, so the feed query was left as it was. Whole-history episode grouping, listen ordinals and cursor semantics need separate validation before changing the feed's work bound.

## Main follow-up on the isolated copy

Both revisions read the same copied account on local PostgreSQL 17. The copy contained 381,393 works and 30,986 activity events. Timings are single application reads with no provider calls or browser rendering. Each response included 60 cards. Full serialized responses matched, including Activity cursor, ordering, and event metadata. The next-page measurement includes obtaining the first page's cursor.

| Read | Main | Follow-up |
| --- | ---: | ---: |
| Screen Activity | 5.17 s | 1.10 s |
| Screen watches | 3.66 s | 1.06 s |
| All Activity | 5.76 s | 1.05 s |
| First and next screen Activity pages | 8.18 s | 2.30 s |
| Continue Watching | 7.84 s | 2.84 s |
| Up Next | 7.60 s | 1.08 s |
| Library Next | 9.06 s | 1.84 s |

Activity's parent fallback performed 2,049 sequential scans of media relationships while assembling the screen feed. The partial index turns those into index-only lookups. The policy join also uses equality on its non-null keys. The measured screen SQL fell from 5.07 s to 0.97 s. This pass keeps the existing grouping and pagination.

## Glass defaults

Light and Dark use 70% fill and a 7 px blur in both materials and fallbacks. Clear and Prominent keep their existing values. The material tests verify the preset and fallback values. Renderer GPU cost was not measured.
