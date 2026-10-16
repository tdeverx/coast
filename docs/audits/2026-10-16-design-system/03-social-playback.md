# Design/component coverage audit: social, profiles, sharing and playback

Date: 16 October 2026. Independent read-only report for the first design audit stage.
Scope snapshot: current working tree in `/Users/admin/Documents/ChatGPT/coast-new`, including the uncommitted row-consistency work. No application files, database, servers, Git state or provider accounts changed. This is a static source/state audit; no rendered acceptance or performance measurements were performed. Prior green tests do not certify the proposed changes.

## Interpretation

The question is whether a user-facing treatment has an established owner and a usable element/composition, not whether every HTML tag must become a component. Native input/select/range/file controls, links and format-specific media renderers are intentional unless a concrete shared owner can replace them without changing behavior. Existing approved design is to be retained. Notification, stream-card and social-indicator treatments explicitly marked Non-approved remain so. A reusable component existing in the manifest is different from its actual variants being inspectable in the UI reference.

Read guides: `docs/design.md`, `docs/performance.md`, `docs/code-organization.md`; component manifest; reference catalog, Demo recipes and injected fixtures. Key constraints: one Shelf renderer, one Button/menu controller, current Field/FormActions/RowFeedback, component-local cancellation, stable command owners outside transient menus, no production calls from examples, and selected-format-only reader imports.

## Summary

Most scoped production UI already composes the established system: panels use Dialog/Heading/Button, parties use PartyCard/PlaybackTimeline/MediaCard, profiles use MediaPage/Shelf/DetailCard, work actions enter WorkMenu, and all media controls use shared Button/menu behavior. This is not grounds to redesign them.

Confirmed gaps are primarily (a) existing primitives bypassed by secondary forms/feedback/pagination/dismiss controls, (b) real production compositions or states absent from the reference, and (c) one profile identity hero with no usable drop-in composite (a route-composition recipe is sufficient before deciding whether extraction is justified). Header anchor triggers additionally expose a small Button API gap. There is no evidence here that a new generic card, menu, dialog, reader engine or transport control system is needed.

Priorities below describe this design-mapping pass: P1 means important reference/safety coverage before broad consolidation, P2 routine consolidation, P3 documentation or lower-impact reference coverage. Confidence is source confidence, not browser certification.

## Findings

### SOC-01 — Production reading/sharing experiences are invisible as reference entries, and cannot safely be mounted as-is

- Priority P1; confidence high.
- Classification: existing variant/composition absent from reference, with preview ownership adaptation required. Not a missing reader/file-input primitive.
- Evidence: `src/routes/ui-preview/Demo.svelte:120` discovers only `ui/components/*.svelte`; recipes at line 121 and dispatch at 208–342 contain no Reader, ReadingLaunch or ShareAction. The component manifest lists their dependency edges (`component-manifest.json:91–93,245–247`) but no standalone entries for those feature-owned components. `src/lib/reading/ReadingLaunch.svelte:16–30` has edition selection, local file, provider search, unsupported results and paging; `src/lib/reading/Reader.svelte:57–62` has edge-to-edge reader, error/save retry, minimized UI, navigation and progress; `src/lib/sharing/ShareAction.svelte:61–80` has source/expiry, create/copy/revoke and error states.
- Safety evidence: ShareAction imports the global API at `ShareAction.svelte:4` and calls it at 20,37,48; ReadingLaunch uses injected reads but calls real `openReading` at 13; Reader imports the global reader/API at 2,8 and creates engine/heartbeat at 17–20. Merely adding these to a glob would not inherit the safe injected specimen contract. `docs/code-organization.md:36` explicitly requires injected API/playback contexts.
- Existing closest: Dialog, Button, Field, FormActions, RowFeedback, ProgressBar, existing preview API/playback contexts. Engines remain feature-owned.
- Smallest route: extend reference recipe registration to explicitly load feature-owned presentation, using existing contexts or narrow injected command adapters. Keep real engines/files behind an explicit selected specimen. Do not move feature code into `ui/components` just to satisfy the inventory, replace global fetch, or import every format at reference-page load.
- Required specimens: reading file chooser (no service / several services / loading / failed / unsupported / empty / paged); reader opening / page / unsaved-save failure / follower-disabled / minimized / closed; share no source / source selection / preparing / created / copy fallback / revoke failure / expired. No real secrets, tokens or provider calls.
- Acceptance: reference entry loads lazily; entry not visited imports no format workers; close/reselect destroys resources; copy/revoke are synthetic; default examples make zero real writes; narrow layout, focus-return and 403/410 withdrawal are represented with current owners.

### SOC-02 — Profile identity hero has no usable drop-in composite or reference recipe

- Priority P2; confidence high.
- Classification: no existing usable composite; a route-owned composition absent from reference. A new reusable presenter is conditional, not mandatory and not a new visual design request.
- Evidence: the profile identity/background/avatar/bio/actions tree is embedded in `src/routes/profile/[username]/+page.svelte:427–487`, with its own artwork/gradient/layout CSS at 599–695 and responsive CSS starting 696. Featured favourite composition is likewise route-owned at 488–508. The manifest/reference has Avatar, ProfileEditor and ProfileFeatureEditor, but no production profile hero composition. `MediaHero.svelte:24–37` requires a HeroItem/collection presentation, and its content/action semantics at 87–122 are media metadata and WorkMenu. `MediaPage.svelte:18–40,58` cannot provide an identity hero in place of that media role.
- Existing closest: Avatar + Button + profile background policy, MediaPage outer shell; ActivityHeader/IdentityCard are compact row patterns, not drop-in profile heroes.
- Smallest route: first represent this current route-owned composition with an isolated recipe, preserving its markup/styles. Only extract a focused ProfileHeader/ProfileHero presenter if a concrete reusable presentation responsibility is established; retain the route data/mutation owner. Do not force a profile into a fake MediaView, add another playback hero, or generalize every hero at once. Featured favourite can likewise remain a documented route composition.
- Specimens: self/other/private-detail-hidden, no artwork, broken-art fallback, long name/bio, mobile, selected-background positioning, featured note. Reuse actual style; do not resurrect the rejected compare hero.
- Acceptance: screenshot parity before/after extraction, unchanged h1/profile links/privacy, no new background/provider fetch, no autoplay, route mutations unchanged; reference displays the complete profile composition rather than only its editor.

### SOC-03 — Secondary command/reader/share forms bypass available field/footer/feedback primitives

- Priority P2; confidence high.
- Classification: reuse gap.
- Evidence: native labelled fields in `ReadingCommands.svelte:40–45`, `GameCommands.svelte:61–74`, `MusicCommands.svelte:38–40`, `ReadingLaunch.svelte:18–29`, `ShareAction.svelte:64–80`, `FriendsPanel.svelte:71`, `PersistentPlayer.svelte:729–741`, and profile search/position controls at `profile/[username]/+page.svelte:332–346,468–483`. Reading command Cancel is before its primary submit at line 45; other reviewed established editor forms use FormActions (`ProfileEditor.svelte:74–76`, `ProfileFeatureEditor.svelte:55`). Field itself is the native label wrapper (`Field.svelte:3–5`) and is already suitable for these native controls.
- Closest: Field, FormActions, RowFeedback. Do not replace native select/range/file semantics with menus merely to increase component usage. Number/date bounds, datalist, file accept, checkbox groups and validation remain domain-owned.
- Smallest route: adopt wrappers where a genuinely equivalent field/footer exists, retaining exact attributes, label association, disabled state, captured targets and submission behavior. Keep one-action footers one-action; do not manufacture Cancel for forms that intentionally omit it. Preserve compact horizontal forms through explicit existing classes; if geometry cannot be preserved, document the composition variant instead of changing approved layout.
- Specimens: numeric invalid/bounded progress, game datalist/replay/session date, local file disabled while preparing, share source missing, subtitle selection, activity search with checkbox, form validation/error/busy. Existing generic Field recipe only covers a text input (`Demo.svelte:215`).
- Acceptance: identical native semantics and request count; no double submit; command dialog survives menu close and targets the captured work/playthrough; saved-write-plus-refresh-error remains acknowledged; visual parity of footer order and spacing is reviewed, not assumed.

### SOC-04 — Manual pagination is duplicated; known-total cases can reuse Pagination, unknown-total cases cannot yet use it directly

- Priority P2; confidence high.
- Classification: reuse gap for known-total pages; existing composition/reference gap (small API capability gap if consolidation desired) for cursor/lookahead pages.
- Evidence: `MusicCommands.svelte:48` duplicates Previous/Next although history includes `page/pages` at 16. Profile favourites already passes page/pages to Shelf at `profile/[username]/+page.svelte:284–286`, then renders additional Pagination for non-history views at 532–537: inspect rendered favourites before deciding whether a redundant second control is intentional. Friends uses page+lookahead (`FriendsPanel.svelte:73–75`); ReadingLaunch uses nextOffset (`ReadingLaunch.svelte:10,29`); these do not have an exact final page count. Current `Pagination.svelte:20–34` renders only for `pages>1` and displays “Page x of y”, so guessing total pages would be wrong.
- Closest: Pagination for known totals, existing Button for lookahead/cursor navigation, Shelf if the data already belongs to a shelf. Do not introduce Shelf solely to paginate an edition picker.
- Smallest route: reuse Pagination in known-total secondary dialog; document a compact navigation composition for unknown total (or a narrowly justified next/previous variant without fabricated totals). Preserve domain cursors and counts. Consolidate profile duplicate controls only after screenshot/interaction review.
- Specimens: first/middle/last/loading known page; initial/more/end cursor/lookahead; short final page; no “of y” for unknown total.
- Acceptance: disabled ends, full reachability, one page request per selection, current previous/next semantics, no truncated friends/editions; focus stability when replacing results.

### SOC-05 — Plain feedback is still host-marked in several scoped surfaces despite RowFeedback

- Priority P2; confidence high.
- Classification: reuse gap; bespoke composite panels intentionally specialized.
- Evidence: `FriendsPanel.svelte:54,68`, `StreamsPanel.svelte:35–37`, `SyncedControls.svelte:35,49`, `ReadingLaunch.svelte:18,28`, `ShareAction.svelte:80`, `Reader.svelte:59`, `share/+page.svelte:47`, `synced/[id]/+page.svelte:11–12`, secondary command examples in SOC-03. Contrast `NotificationInbox.svelte:117` and `ProfileEditor.svelte:59` using RowFeedback.
- Closest: RowFeedback plain error/message/retry. Its `tag` branch only renders the message (`RowFeedback.svelte:15–18`), so preserve a host-owned Retry button or use the supported non-tag composition; do not silently drop retries. Reader unsaved-bookmark retry and server issue list are domain compositions. Player error/postplay panels (`PersistentPlayer.svelte:552–591`) remain intentionally specialized.
- Smallest route: share plain feedback rendering without changing wording/severity, aria role or retry ownership. Keep aggregate server issues keyed and complete; do not turn each into a toast. Use design-reference examples for compound error/action states.
- Acceptance: error remains near its control, read/status errors do not erase settled data, no stale error after close/replacement, correct status vs alert, retry runs once. No hidden empty fetch as a replacement for disabled feature teardown.

### SOC-06 — Toast dismissal bypasses the established icon Button and introduces a separate 28px target

- Priority P2; confidence high.
- Classification: reuse gap.
- Evidence: `NotificationToasts.svelte:64–68,75–84` render native close controls and Icon17; `.toast .icon-button` is 28x28 at 122–125. Ordinary icon Button exists and preserves icon sizing/labels/disabled state. This is a concrete renderer/target drift, not a claim all native buttons are forbidden. The larger `.toast-open` native button at 72–74 is a legitimate whole-notice hit target; forcing a normal action Button there would change the composition.
- Closest: Button size=icon, plus existing toast host.
- Smallest route: use shared icon Button for dismissal, preserving outcome/error rollback and action-feedback busy behavior. Review approved toast spacing before removing a 28px override; coarse pointer target and current 36/44 control rules need deliberate reference treatment. No new Toast system is needed: NotificationToasts already owns this composite.
- Specimens: single/three notices, long title/body, persistent dismiss fails and returns, undo busy/fails, player-active placement, mobile and keyboard focus.
- Acceptance: same dismiss/undo behavior, usable touch target, no accidental whole-notice activation; keyboard and accessible names preserved; no material redesign.

### SOC-07 — Header panel triggers expose an actual Button capability gap, not a trivial replacement

- Priority P2; confidence high.
- Classification: genuine small missing usable capability in existing primitive; coordinate with foundation owner.
- Evidence: `Header.svelte:75–82` native stream/friend/notification controls have stable IDs and inline count/dot badges. Corresponding Dialog anchors are literal IDs (`FriendsPanel.svelte:50`, `NotificationInbox.svelte:148`, `StreamsPanel.svelte:32`). `Button.svelte:11–24` props have no caller id, and native button id at 91 is generated only for menus. Replacing these native buttons today loses anchor ownership.
- Closest: Button size=icon with children (badges can remain children), Header own badge styling. Native navigation anchors/sliding pill at Header58–69 and POST logout at105–108 are intentional semantic compositions, not new menu systems.
- Smallest route: foundation owner considers safe ordinary-control id forwarding while keeping menu generated IDs/ARIA stable; then use Button without changing anchor contract/badge placement. No need to invent HeaderButton.
- Specimens: unread0/large, stream unknown/0/99+, friend-request count, public/normal/admin, reduced motion/coarse pointer; all panel anchors must still flip/clamp.
- Acceptance: same IDs, dialog anchor/focus return, matching icon/touch sizing, no duplicate IDs, no unauthorized stream count reads. Do not regress Header's existing preview mode guard.

### SOC-08 — Existing reference entries underrepresent party, roster, notifications and playback states

- Priority P1 for complete review coverage; confidence high.
- Classification: existing variant/composition absent from reference; some fixture docs drift.
- Evidence: `Demo.svelte:304` PartyMenu uses one idle audio host, `306–310` PartyCard only inParty+footer with two members, `311` FriendRoster only one accepted online friend, `317–320` PersistentPlayer disabled idle audio. `Demo.svelte:223–224` SyncedControls depends on isolated preview player session and live room absence, so opening it cannot demonstrate joined embedded party by itself. `fixtureFetch` in `demo/fixtures.ts:40` pending roster always empty; no `/synced` room listing fixture exists (falls through line65), so FriendsPanel Parties path cannot depict normal invite/rejoin states. Notification fixtures at24–30 still contain friend-request, no friend-accepted FriendRoster attachment, and reaction carries `media` rather than `activity`; no locked/read notice, partial availability, next page or action success. Streams fixture at42 has success-only Now/History, no issue/empty/slow/failed or shared-viewer example. Toast example at `Demo.svelte:314` is one persistent notice. Hero example at285 has one movie and no selectable trailer/pagination state.
- Closest: all production components already exist. Add parameterized/state recipes and deterministic isolated transport cases; do not clone production markup into new demos.
- Smallest route: small specimen selectors per existing component, with safe local room/controller context. Keep one mounted active specimen and lazy imports; no provider requests, playback writes or root-global state mutation. Use the actual production header, embedded sticky-footer and timeline compositions. Add explicit badges for currently Non-approved variants.
- Required party matrix: invited header+Join/Decline, joined idle and playing, rejoin, embedded sticky footer, host/member permissions, pending people, many avatars, disconnected/buffering/unavailable, reading/music/video, queue empty/paged/error. Required playback matrix: inactive/audio/video/browsing/paused/playing, loading/error/retry/subtitle prompt/postplay, controlled follower, both timeline seekable and passive reading variants, hero multi-slide/trailer controls. Notification/stream/roster matrix as evidence above.
- Acceptance: every branch selectable without a live account/provider; injected writes cannot escape preview; closed/hidden specimens dispose timers/observers/engines, no concurrent live gallery instances; desktop/mobile keyboard/focus; captions and counts use synthetic coherent DTOs.

### SOC-09 — Loading placeholder compositions are host-specific and absent from reference states

- Priority P2; confidence high.
- Classification: existing composition absent from reference; potential missing named placeholder composite, not yet justification for a new generic Skeleton component.
- Evidence: FriendsPanel at72/86 renders three 66px blocks, NotificationInbox118/181 four112px blocks, StreamsPanel38/48 two140px blocks. These all use global `.skeleton` animation (`src/app.css:753`) but have different actual card families and no reference scenario drives loading. Neither IdentityCard nor PartyCard provides a placeholder variant; MediaCard/Shelf artwork skeletons serve a different geometry.
- Closest: global skeleton styling, IdentityCard/notification/MediaCard actual families, RowFeedback status. Existing rectangular block may be an intentional approximation; browser-check before calling it broken.
- Smallest route: first expose existing loading states next to settled card variants in reference. If review confirms geometry drift, add presentation-only family-specific placeholder snippets at their existing owner (or one shared shape primitive only if repeated needs justify it). Do not add a new global loader, avatar fetch lifecycle or eager artwork while fixing design coverage.
- Acceptance: stable layout across loading→empty/error/success, aria-busy/status not duplicated, reduced-motion behavior, zero data activation caused by measuring a placeholder, no random fake images/history.

### SOC-10 — Profile/taste/share page compositions lack complete reference and current behavioral copy

- Priority P3; confidence high.
- Classification: existing composition absent from reference and documentation/copy drift.
- Evidence: Profile overview/insight/history/favourites composition at `profile/[username]/+page.svelte:370–539` and taste breakdown/overlap at `taste/[friendId]/+page.svelte:14–20` are not recipes, though their constituent Shelf/MetricGrid/DetailCard exist. `share/+page.svelte:44` uses default row Heading and no page content composition; `synced/[id]/+page.svelte:9–12` uses page Heading but copy hardcodes Jellyfin/playback despite reading parties. `docs/design.md:64,86` says paused reveals browsing without separate UI toggle; current PersistentPlayer exposes Show UI at631 and Reader58. The docs are stale; do not change approved behavior back to match them. Sharing page `together` branch is retained code; this static audit does not assert it is currently reachable from normal v1 link creation.
- Closest: page Heading, current .content/page composition, Shelf/DetailCard/MetricGrid, actual profile/party/reading state contracts.
- Smallest route: document route composition specimens using existing components; correct behavioral guidance/copy only after checking actual supported link/party modes. Choose established page Heading/shell if a visual review confirms unintentional row/page drift. No new alternate page layout.
- Specimens: own/other/private profile, no-history/empty favourite, expanded insights, all taste media/null scores/progress, share unclaimed/claimed/error/finished and joined/ended reading/music/video invite.
- Acceptance: profile privacy/read-only behavior preserved; no numeric missing data presented as zero; native links retain query state; no extra route/provider reads for composition; app text describes supported media accurately.

### SOC-11 — Existing party previews do not isolate all commands from live application state

- Priority P1; confidence high from direct source path. No command executed.
- Classification: preview capability/isolation gap; consolidate with parent reference audit. Not a request to redesign party controls or invent a second party engine.
- Evidence: `FriendsPanel.svelte:20` imports live `syncedPlayer/startSynced/joinSynced`. Its preview flag only stops polling at41; `inviteFriend` at32, `joinParty` at35, and visible Create party at67 call the live commands without preview guard. Existing `Demo.svelte:293` mounts the component directly. Injected transport blocks component `change` writes but cannot intercept `startSynced` or `joinSynced` from the global party module (`src/lib/playback/synced/client.svelte.ts:35,51`). A preview action can therefore reach live command ownership before the synthetic call fails. `SyncedControls.svelte:18,28` has a preview guard only in show(); its room/members/media identities at22–26 and content at32 are live singleton state; member actions42 and Leave45 are direct commands if content is made visible. Richer scenarios must not seed the real singleton to work around the lack of preview data.
- Other candidates: ShareAction imports global `api` (`ShareAction.svelte:4`); PlanAction global `change/api` (`src/lib/experiments/PlanAction.svelte:4,21,29`); ReadingLaunch global openReading (`ReadingLaunch.svelte:4,13`); Reader global state and heartbeat (`Reader.svelte:2,8,17–20`). Both contexts exist but do not replace these direct imports (`ui/client-context.ts`, `playback/context.svelte.ts`).
- Closest: current `useClient` transport and `usePlayback` local state, plus PartyMenu's explicit `preview?demoRoom` and preview command guards (`PartyMenu.svelte:16–24,39`). Safe extension should expose commands/state through the narrow existing owner rather than monkeypatch module globals.
- Smallest route: before expanding reference coverage, give these specimens isolated read data and commands, or temporarily disable unsafe imperative controls with a clear specimen limitation. Reuse production presentation. Do not rely on `Demo.svelte:205` click/submit capture: it suppresses default anchors/form submission, not imperative API calls/goto/singleton methods.
- Acceptance: network spy denies all live POST/PATCH/DELETE; create/join/leave/invite cannot change the signed-in user's real room/player; no real-session metadata leaked into demo; mount/close/reopen leaves real state untouched. Keep synthetic command outcomes to demonstrate success/busy/error without making reference a production integration test.

#### Preview isolation matrix

| Candidate | Existing isolation | Remaining boundary before richer specimen |
|---|---|---|
| Header | useClient preview prevents count polling and panel action handlers; local preview status; usePlayback local player | Preserve id/badges and existing guards; native logout submission guarded. |
| MediaHero | usePlayback local player/hero; preview trailer mute path | Keep same presentation owner; scripted specimens must not call global media commands through unrelated actions. |
| PersistentPlayer | usePlayback local player; useClient API; explicit preview returns in preparation/effects/onMount (`PersistentPlayer.svelte:127,137,350,366,426,430`); current reference fieldset disabled | Audio idle reference is intentionally constrained. Imported global transport/sync functions remain; do not merely remove fieldset disabled to claim full interaction support. |
| PartyMenu | demoRoom and preview-guarded command wrapper (`PartyMenu:16–24,39`), synthetic picker | Usable controlled-state blueprint; needs safe local settings updates for interactive success cases, not real singleton seeding. |
| FriendsPanel | useClient injected API/change; preview stops interval | Live room/create/join/invite commands bypass transport; fix isolation before enabling those specimen actions. |
| SyncedControls | injected media read; show() early return in preview | Live room/member/actions; safe room/commands needed for joined/embedded specimen. |
| PartyCard | presentational props; preview member actions no-op | Safe existing composition; use synthetic members. |
| NotificationInbox | useClient; preview skips seen-observer/poll | Safe synthetic actions return blocked409; add local synthetic successful outcomes; no real auto-read writes. |
| NotificationToasts | preview suppresses global undo feedback; injected dismiss; open handler guarded | Safe existing entry; add synthetic undo feedback without setting root singleton. |
| Reaction/Recommend/WorkMenu command dialogs | mostly useClient plus stable command state | Preserve transport blocking; downstream reading/plan/share command entry needs the additional boundaries above. |
| ShareAction / PlanAction | no injected API today | Must use safe injected transport before registering interactive recipe. |
| ReadingLaunch / Reader | launch metadata reads useClient; global reader/navigation/render/save | Isolated reader state/commands or presentation-only specimen, selected renderer/file behind explicit demand. |
| Profile route recipe | native links and imperative change/API/goto in route | Route presentation recipe must not mount entire mutating route under a fake data object; pass inert/local actions and preserve privacy views. |

## Covered well / intentional specializations

- `ActivityHeader.svelte:8–18`: compact actor/avatar/trailing owner; keep it distinct from large profile identity and notification source+description. Arbitrarily forcing notification headers into it would lose source-icon and multiline description semantics.
- `Avatar.svelte:10–20`: shared image/initial/status fallback. Party members intentionally use MediaCard circle because primary-menu/context behavior is different; ordinary Avatar should not acquire catalogue command ownership.
- `IdentityCard.svelte:6–29` and `FriendRoster.svelte:9–18`: established friend card presentation with status/activity/progress and menu/request actions; do not merge back into PartyCard.
- `PartyCard.svelte:8–42`: established invite/header/member/footer composition with pending grayscale, hover lift, clipping and embedded treatment. Reuse it; no new universal identity container required.
- `PartyMenu.svelte:42–112`: uses shared Button nested menus, menu-resource and explicit permissions. Native offset range at55–56 is valid; generic range primitive is not shown necessary by this audit. Preserve keyboard-menu interactivity and personal offset semantics when adding reference coverage.
- `PlaybackTimeline.svelte:34–54`: explicit native transparent seek input over shared ProgressBar and passive mode. Poster thumbnail is intentionally custom (historical user rejected full MediaCard in this controller); do not “fix” back to MediaCard. Passive/reading and seekable modes need their own specimens.
- `MediaHero.svelte:40–145`: specialized persistent/content roles already one component, native media rendering intentional; work actions use WorkMenu and trailer arrows Buttons.
- `PersistentPlayer.svelte:497–542`: native video/audio element and HLS lifecycle belong here. Do not extract into a visual library for its own sake. Error/postplay composite panels remain host-owned.
- `Reader.svelte:15–47`: renderer/format engine/heartbeat/cancellation and one-view resource limits intentional specialization, not missing shared screen card. Presentational shell can be referenceable without generalizing engines.
- `ReactionActions.svelte:35–47`: Button menu panel + shared reaction choices; do not replace with ad hoc popover. `RecommendAction.svelte:37–44`: Dialog/RowFilter/FormActions and stable menu ownership already established.
- `ProfileEditor`, `ProfileFeatureEditor`: already adopt Field/FormActions/RowFeedback/Dialog and resource/operation boundaries; AvatarPicker is existing upload/provider chooser, not reason for a new profile-picture control.
- Native Header navigation and logout form retain required semantic roles/submission. Panel trigger gap covered SOC-07.
- Root lazy imports (`src/routes/+layout.svelte:4–6,29–40,129–143`) are important performance owners. UI reference should not turn them into eager global imports.

## Coverage matrix

`Mapped` means actual rendered markup inspected; it does not certify every interaction in a browser. Source paths are relative to repository root.

| File / surface | States inspected from source | Mapping / remaining issue |
|---|---|---|
| `src/routes/profile/[username]/+page.svelte` | own/other identity; background/no-background/fallback; positioning; feature; favourites arrange; activity filters; insights; expanded pages | MediaPage/Shelf/Avatar/DetailCard/MetricGrid/Button/RowFilter; route profile hero missing composite; SOC02/03/04/10 |
| `src/routes/taste/[friendId]/+page.svelte` | null/qualified scores; medium breakdown; overlap filter and progress | Heading/MetricGrid/Shelf/RowFilter; composition reference SOC10 |
| `src/lib/ui/components/ProfileEditor.svelte` | opening/reset, avatar choices, save/error/busy | Mapped; reference more states SOC08 |
| `src/lib/ui/components/ProfileFeatureEditor.svelte` | initial note, error, save/cancel | Mapped; reference more states |
| `src/lib/ui/components/ProfileRecap.svelte` | no activity, previous count threshold, difference, other subject | Mapped specialized copy; demo only one success |
| `src/lib/ui/components/AvatarPicker.svelte` | upload/image/GIF/failed/oversize/provider/remove | Mapped Field/Avatar/Button/RowFilter; only empty-choice reference |
| `src/lib/ui/components/Avatar.svelte` | source pending/error/no image/status | Mapped primitive |
| `src/lib/ui/components/Header.svelte` | guest/user/admin, badges, presence menu, minimized reader | Mapped nav/Buttons; SOC07; parent foundation overlap |
| `src/lib/ui/components/ActivityHeader.svelte` | avatar/no avatar, no profile link, trailing | Mapped primitive; reference only basic |
| `src/lib/ui/components/IdentityCard.svelte` | background/no background/progress/wrapped actions | Mapped composite; keep separate from PartyCard |
| `src/lib/ui/components/FriendRoster.svelte` | accepted, outgoing pending, incoming pending, activity/idle, comparison | Mapped IdentityCard/Avatar/Button; missing reference states SOC08 |
| `src/lib/ui/components/FriendsPanel.svelte` | accepted/pending/parties, busy/error/empty, paging, active sticky party footer | Mapped Dialog/Heading/SegmentedControl/PartyCard/SyncedControls; SOC03/04/05/08/09 |
| `src/lib/ui/components/PartyCard.svelte` | invited header, members/actions, idle/playing footer, embedded, pending/hover | Mapped composite; SOC08 |
| `src/lib/ui/components/SyncedControls.svelte` | no room/notice, joined media, retry, host/member, inline/dialog/embedded | Mapped PartyCard/PlaybackTimeline/PartyMenu/Dialog; SOC05/08 |
| `src/lib/ui/components/PartyMenu.svelte` | host/member, reading/video/audio, queue paging/error, settings/status/offset | Mapped shared Button menu; SOC08; range intentional |
| `src/lib/ui/components/NotificationInbox.svelte` | loading/empty/error, filters/read state, source/actor headers, media/activity/friend attachments, action/dismiss, older page | Mapped Dialog/Heading/RowFilter/MediaCard/FriendRoster; item/layout remains non-approved; SOC08/09 |
| `src/lib/ui/components/NotificationToasts.svelte` | transient/persistent/undo/error, max three, close behavior | Existing composite; SOC06/08 |
| `src/lib/ui/components/StreamsPanel.svelte` | now/history, mapped/unmapped user/item, server issues, shared details, empty/loading/error/more | Mapped Dialog/Heading/MediaCard/EmptyState/Button; arrangement Non-approved; SOC05/08/09 |
| `src/lib/ui/components/SocialControls.svelte` | compact heads/overflow/party rail, selected reaction | Mapped Avatar/Button; explicit Non-approved design retained |
| `src/lib/ui/components/ReactionActions.svelte` | root/nested trigger, selected/none/loading/error/write | Mapped Button/Icon/RowFeedback; reference missing states SOC08 |
| `src/lib/ui/components/RecommendAction.svelte` | lazy friends/none/page/error/send, menu-owner lifecycle | Mapped Dialog/RowFilter/FormActions/RowFeedback; reference fixture limited SOC08 |
| `src/lib/ui/components/WorkMenu.svelte` | read-only/guest, screen/catalogue dispatch, stable identity | Mapped command entry; no alternate renderer proposed |
| `src/lib/ui/work-menu/ScreenActions.svelte` | form/confirmation/playback error/request/edit/planning/sharing modal entry and ownership | Stable command dialogs + shared primitives; secondary fields SOC03; catalogue agent owns main action-tree audit |
| `src/lib/ui/work-menu/CatalogueActions.svelte` | command owners, remove occurrence, playback error, reading launch | Shared WorkMenu composition; catalogue agent owns main action-tree audit |
| `src/lib/ui/work-menu/GameCommands.svelte` | start/replay, progress, session log, errors | Dialog/Button; fields/footer/feedback SOC03 |
| `src/lib/ui/work-menu/MusicCommands.svelte` | log/history, loading/empty/error, paged events | Dialog/Button/DetailCard/EmptyState; SOC03/04/05 |
| `src/lib/ui/work-menu/ReadingCommands.svelte` | progress state/page/total, validation, save/cancel | Dialog/Button; SOC03 |
| `src/lib/ui/components/RequestDialog.svelte` | destination, 4K, season availability/requested, watchlist, loading/empty/error/submit | Dialog/Field/RowFeedback/Button; native grouped checkboxes intentional; only empty options demo |
| `src/lib/ui/components/PersistentPlayer.svelte` | audio/video, preparation/error/postplay, timeline, queue/subtitles/edition/crop/fullscreen/volume, sync ownership | Mapped Button/menu/Timeline/Dialog; intentional engine; SOC03/08 |
| `src/lib/ui/components/PlaybackTimeline.svelte` | seek/passive, audio/video art fallback, reading progress, scrubbing/mobile | Mapped ProgressBar/Icon; intentionally specialized; SOC08 |
| `src/lib/ui/components/MediaHero.svelte` | persistent/content, fallback art/logo, parent hierarchy, trailers, multipage, WorkMenu | Mapped composite; reference success-only SOC08 |
| `src/lib/reading/ReadingLaunch.svelte` | same session resume, file/provider, unsupported/empty/page, busy/error | Mapped Dialog/Button/native fields; SOC01/03/04/05 |
| `src/lib/reading/Reader.svelte` | opening, controlled/following, error/retry, close/minimize, progress | Dialog/Button/ProgressBar plus format renderer; SOC01/05 |
| `src/lib/experiments/PlanAction.svelte` | scheduled plan/party/friend selection/errors | Dialog/Button/native forms; global API preview gap SOC11; catalogue/experiment agent primary owner |
| `src/lib/sharing/ShareAction.svelte` | source select/load/fail, expiry/create, copy/revoke | Dialog/Button/native fields; SOC01/03/05 |
| `src/routes/share/+page.svelte` | invitation claim/open/preparing/error, playback/shared state | Heading/Button + persistent player; SOC10 |
| `src/routes/synced/[id]/+page.svelte` | join/preparing/ended/error | Heading/Button; SOC10 |
| `src/routes/+layout.svelte` | lazy panels/reader/modal, playback visibility, policy withdrawal, session notice | Shared root ownership preserved; docs drift SOC10 |
| `src/routes/ui-preview/catalog.ts` | inventory partition, elements/composites | Missing feature-owned recipes SOC01; parent owner |
| `src/routes/ui-preview/Demo.svelte` | all relevant recipes/dispatch/loaders | SOC01/08; parent owner |
| `src/routes/ui-preview/demo/fixtures.ts` | roster/checkins/streams/notice/work state synthetic transport | SOC08; parent owner |
| `src/routes/ui-preview/demo/+page.svelte` | preview injection and root suppression | Existing safe context pattern; use for SOC01 |
| `src/lib/ui/components/Button.svelte` | ordinary/icon/menu/item/trigger, props | SOC06/07; foundation owner |
| `src/lib/ui/components/Field.svelte`, `FormActions.svelte`, `RowFeedback.svelte`, `Pagination.svelte` | actual slots/native semantics/paging count and retry conditions | Closest primitives validated, not assumed |

## Suggested sequence for the parent plan

1. Consolidate cross-agent foundation findings (ordinary-control id forwarding; skeleton/composition reference coverage; exact role of Field/FormActions/RowFeedback). Do not create duplicate new primitives from multiple reports.
2. Extend safe reference registry for feature-owned compositions and state recipes. Make absent states inspectable before choosing geometry changes. Explicit Non-approved markers remain.
3. Represent profile identity presentation preserving the current approved design; extract a named presenter only if justified, keeping feature data/actions in their current owner.
4. Adopt already-usable wrappers for secondary forms/plain feedback/known-total navigation/icon dismiss. Add narrow variants only where existing contract cannot express real semantics.
5. Validate unchanged UI plus state transitions at desktop/narrow/coarse pointer/reduced motion. Verify no provider/real writes in reference; requests only on open/selection; no eager reader engines; menu/dialog/panel close releases owned work; no altered background/hero/party playback behavior.

## Limitations

No browser screenshots, live provider tests, tests/builds or production performance claims were produced. Findings describe template/source coverage and the smallest proposed route; visual parity and target sizes still require rendered inspection. Backend permissions, schema, import correctness, full share decoding and reader format certification are outside this design-mapping audit. The catalogue agent owns catalogue presentation/Shelf loading and the parent owns foundation/reference/charts, so those references are shared-owner pointers rather than duplicate competing fixes. Native primitive use and approved unique compositions are not automatically defects.
