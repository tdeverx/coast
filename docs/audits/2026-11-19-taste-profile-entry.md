# Taste and Overlap profile access

The Taste segment and the Friends roster action share the same profile destination. On your own profile, Taste shows your latest saved genres, themes and other affinities for enabled media. The owner-only view reads at most six cached profiles and three preview names per dimension. All supported dimensions stay visible with muted missing values. The affinity browser loads at most 25 entries from the selected dimension per request, including negative and neutral values. It never recalculates a profile during navigation. On a friend’s profile, the comparison is available when both accounts have Social and Personalisation enabled and the owner shares Insights with the viewer. The comparison query still authorizes the request independently.

The permission check is part of the existing username lookup. It uses the indexed friendship pair and returns one boolean. Only Taste loads the comparison. The query retains the existing 300-entry evidence cap per person and hydrates one page of up to 60 overlap cards. The panel response omits duplicate item IDs and the view indexes card progress once. PostgreSQL checks cover pending and accepted friends, unrelated viewers and private Insights.

## Title scores

The maintenance job already builds private viewer profiles for movies, shows, games, music, books and comics. It scores up to 500 recommendation candidates per medium and retains confidence and up to three reasons. Recommendation ranking combines the match with provider signals and viewing interests. Canonical title details can request a match against the viewer’s latest saved taste profile. The read hydrates one title’s features without a provider call or a profile rebuild.

The friend comparison uses visible evidence for movies, TV, music, games, books and comics. It reports exact progress and overlap counts, including page and EPUB progress where permitted. Section visibility is evaluated once for each of the two viewers and five media categories. Scoring balances the existing 300-entry cap across media. The exact overlap still operates on the full visible set and hydrates one page.

## Shared profile hero

Profiles use the shared media hero. One optional card replaces the logo within the artwork slot. Profiles place the same circular person card used in cast rows above the display name, handle and bio. The shared gap below a visible title is 12 pixels. Profile segments use the existing navigation material and control. The overflow menu contains link copying and owner privacy. Edit is a primary action and has its own overflow menu for clearing a selected background.

The profile hero uses the existing profile response. A static hero keeps the shared resize observer for page layout. Playback video, trailer requests and media gesture listeners remain tied to media heroes. The Lists segment loads the existing owner-scoped list overview only on selection. It reuses the existing create action, list shelves and detail routes. Retiring the featured favourite removes its validation query, card hydration and note editor. Saved featured fields are excluded from delivered profiles. Pinning and rearranging the Favourites row use the existing tracking settings.

The account menu uses the existing avatar and presence state. Its combined profile row opens the profile on selection and exposes activity status through a submenu. The Requests row in For You owns request browsing. Stored notification targets to the retired page resolve to For You, and management commands remain in the media menu.

Signed-in profile links use the expandable details panel and the same profile loader as direct links. The section picker sits in the shared panel header. Switching sections replaces the current panel history entry, so the Close control can return to the original page without a new Back step. The compact hero fits its content and keeps its padding above the avatar.

Profile editing uses the hero in place. The display name and bio keep the hero typography and layout. The circular avatar card previews changes and uses the shared card menu for upload, import and removal. Connected avatar choices load only during edits and abort on exit. Save uses the existing authenticated profile command and the same refresh path. The red cross discards the draft. Pointer dragging changes the selected backdrop crop locally and saves both axes in the same profile write. Selected backgrounds prefer the backdrop, fall back to the poster, and supply the only tint sample. Clearing a selection restores Last activity.

Overview shows Favourites followed by the profile-scoped Activity row and the individual progress rows. The profile-only query restricts the event scan to that owner and retains category and event privacy. Statistics and Lists remain separate selections. The panel destination survives reload through the reserved URL parameter. Friends, Notifications and Activity remember their selected segments.

## Profile row destinations

Expanded Favourites, Activity, progress and list rows use the same tint as their profile. Progress and lists each hydrate at most one background work for tint and reuse the existing shelf resource for items. Activity, Lists and Taste skip overview counts, favourite ordering and history reads. The shared artwork sampler still uses a single 32×32 sample per selected image and a bounded colour cache. The old standalone Taste page and the parallel profile section renderer have been removed.

## Evidence and matching

Paused and in-progress items, repeat watches and admitted Steam play observations now contribute to private taste evidence. Scoped recommendation reads select evidence for their own medium. Evidence still collapses episodes to shows and tracks to albums before the bounded personal scoring read. Provider metadata retains complementary signals. Screen genre conflicts follow the configured Details priority, and imported languages, countries, networks, studios, reading publishers and illustration credits can supply additional dimensions. Existing saved evidence ages out through the taste job’s revision check.

The local PostgreSQL overlap regression with 321 shared movies plus music and reading took about 22 seconds with per-item visibility calls. It took about 0.37 seconds after admitting the same privacy rules through the per-viewer, per-category matrix. This is one fixture run before and after the matrix and scoring changes. No live latency or production load result is inferred.

The final read-lifetime check covers cancellation of the native overlap and metadata queries in the same request. Closing or replacing a comparison also aborts its card hydration and prevents a superseded request from publishing. Personal saved-signal pages stay bounded at 25 entries.
