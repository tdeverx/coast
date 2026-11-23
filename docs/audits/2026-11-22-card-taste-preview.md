# Taste matches on browsing cards

An opt-in setting in Admin → Policies enables a private percentage on eligible cards. Each percentage opens the viewer's detailed taste calculation. The card uses the existing bold text link and chevron. Scores below 50 use red, 50–79 use the regular subtitle colour and 80–100 use green. The numeric label, keyboard action and accessible name convey the meaning independently of colour.

## Loading and privacy

A shared near-viewport observer queues canonical work IDs across shelves. The signed-in viewer has one active score request at a time, capped at 72 unique IDs per batch. A bounded in-memory cache retains up to 288 numeric results and abstentions. Scrolling a mounted card offscreen releases the request subscription and preserves its last result. A remounted card can read a cached value synchronously. Score responses arrive after ordinary cards and preserve their order. Cards representing social events, unresolved provider-only titles and collections do not request this percentage. The normal detail and admin actions retain their own support for collections.

The cache is scoped to the viewer and the permissions on the published taste profiles. Previous versions of the preview replaced it on broad tracking or social revisions, including changes to a friend's presence. Refreshing a published profile now rechecks visible matches in the background, retaining the previous value until the new result arrives. Signing out, withdrawing access or changing accounts disposes of the old scope. The server still checks permissions before releasing each private response, including on a bookmarked or manually entered API URL. Ordinary browsing only transfers integer percentages. The viewer's own breakdown is calculated on selection. The admin action retains its additional live social evidence.

In the running preview, the first Library request warmed 18 movie IDs. After switching to Collections and back to Movies with further score responses held, all 12 visible original movies immediately showed the same percentages. The round trip issued zero new score requests.

## Local preview and score distribution

The preview used a fresh copy of the live Coast database, the matching encrypted provider settings, the original avatars and 1.4 GB of artwork, with Coast's Developer mode enabled. PostgreSQL and the web server were local. On a fresh Library navigation, the raw Vite frontend fetched 300 modules and 27.17 MiB of script. The compiled frontend fetched 78 scripts and about 700 KiB in the same comparison. Earlier image failures came from copying database records without the matching key and asset files.

The score distribution and blind ratings replay are documented separately. [Catalogue census and calibration](2026-11-22-card-taste-score-distribution.md) · [Prior isolated server benchmark](2026-11-22-taste-card-loading.md)

## Infinite rows

For You and Discover reserve two shelf placeholders when the trailing row comes into view. The first row gets the first data request. The second starts after the first settles. A browser fixture checked both surfaces, including empty and final odd-sized batches. Both placeholders were visible before the first response, and moving away from the boundary stopped further batches. Subsequent pairs started while the previous row's bottom was still 351 px and 282 px below the viewport in the respective fixtures.

## Browser timings

Five measured visits per route per setting followed a warm-up. Headless Chromium opened a fresh authenticated 1440 × 900 context each time, visited For You or Library, scrolled vertically seven times and horizontally three times, and recorded resource timings. The switch used the actual admin setting on a second development database. The interactive preview stayed enabled. For You exercised the Recently Added shelf and neighbouring rows. Library exercised a 60-card page. For You selects dynamic row definitions per visit, so the journey did not necessarily see the same number of titles in every pair.

| Median, unless labelled | For You off | For You on | Library off | Library on |
| --- | ---: | ---: | ---: | ---: |
| First visible shelf card after navigation | 11.74 s | 5.56 s | 1.84 s | 1.28 s |
| Browser score requests per journey | 0 | 4 | 0 | 6 |
| Median completed score request | — | 114 ms | — | 139 ms |
| 95th percentile completed score request | — | 468 ms | — | 522 ms |
| 95th percentile completed row-data request | 21.22 s | 21.27 s | — | — |

Library delivered its initial cards in the document. Neither arm generated a separate initial Library row fetch. No journey requested a title twice. The largest batch was 18 titles on Library and eight on For You. With scores on, the median delay from the first visible card of any kind to the first visible score was 1.04 s on Library and 3.53 s on For You. The latter can include waiting for a score-eligible shelf after an Activity or Request card is already visible.

One cold Library trace showed the same subtitle shrink from 22.39 px to 19.19 px with every score response blocked. The first paint used the inherited 14 px font. The existing media-card stylesheet then applied its 12 px subtitle font. After the stylesheet loaded, adding the match and delivering a real score caused no height change. On desktop and mobile, the match opened the same breakdown by pointer or keyboard, and closing it restored focus to the initiating card.

The two database copies shared a two-core, 768 MiB guest. Background verification and cold filesystem reads added substantial variance. The timings establish the actual request volume and that the long row stalls also occurred with the feature disabled. They do not establish that turning scores on speeds up browsing, or predict production page latency. Passive sampling during a slow period found simultaneous Activity, tracking and availability queries lasting about 3.7–5.2 seconds. The existing native benchmark measured the incremental scoring work separately. [Native benchmark](2026-11-22-taste-card-loading.md)

The final interactive preview has a dedicated three-core, 2 GiB PostgreSQL guest. On the same account, three standalone API reads returned the same ordered IDs on both guests. Median Progress time for 20 cards fell from 3.08 s to 1.44 s. Library returned 60 cards in 248 ms, down from 300 ms. In three browsing visits that immediately scrolled Recently Added into view, the first visible card during that journey arrived at 6.53, 10.86 and 10.58 s. Activity was the slowest completed row on every visit at 14.78, 12.36 and 14.20 s, respectively. Each visit also had a later request outstanding at the end of observation.

Three separate authenticated visits used the normal browser cache and stayed at the top of For You. First contentful paint took 2.04, 0.67 and 0.38 s. The hero artwork appeared at 2.13, 0.78 and 0.44 s, and the first Progress title appeared at 9.49, 3.68 and 3.29 s. Only Progress and Requests activated in the initial viewport at 1440 × 900. Delaying shelf styles by 1.8 s in a controlled check also left the lower rows idle. The initial delay belongs to the visible shelves and their data requests. Activity contributes a separate delay after scrolling. These local measurements describe two distinct browsing conditions.
