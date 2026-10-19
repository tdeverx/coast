# Authenticated normal-development findings

Source `eb0673873462b71118d1c11678d128958a05ff07`, 17 October 2026. This supplement records actual signed-in normal-development behavior, separately from the private clone and signed-out deployed browser. It does not close the remaining live acceptance gaps in the main report. No application fix was applied.

## LIVE-01 — replacing a section with a work detail invalidates the outgoing Shelf's live source

**P1; runtime reproduced on actual data, with a source/compiled-code explanation.** The coordinator reproduced this twice, including after a hard reload, in the signed-in normal development server at port 5173: open Library, choose “View all Listen,” wait for the populated section, then click the first visible caption title. The section contained 50 title links. The detail history gained a Back button, but the old Listen section remained visible and the selected music detail did not appear. The console reported `TypeError: Cannot read properties of undefined (reading 'preview')`, with a component stack through SectionDetails, Dialog, DetailOverlay and DetailPanel. Neither selected work titles nor row identifiers are retained in this report or its evidence.

The document title remaining Library is expected during shallow navigation by itself; the demonstrated failure is the stale section body together with the uncaught exception and missing requested detail. This is not evidence of a provider timeout or a slow database query.

### Shared root cause

The mounted source factory requires a valid, same-family configuration until its owning Shelf is destroyed. Its caller supplies a reactive optional prop that can disappear during replacement:

1. [DetailPanel.svelte](../../../src/lib/media/DetailPanel.svelte) lines 55–58 publishes `shownHref` and replaces the discriminated `data` union. Lines 70–78 key the render block on `shownHref`, but the outgoing row component's `href={data.data.href}` remains a live getter into the shared union. Compiling the unchanged source with the installed Svelte compiler confirms that getter reads the current `data`, rather than the row payload belonging to the outgoing keyed instance.
2. [SectionDetails.svelte](../../../src/lib/ui/pages/SectionDetails.svelte) lines 15 and 30–34 derives `target`, `row` and `source` from that getter. A music result has no row `data.href`. The outgoing SectionDetails consequently loses its section target and its `source` becomes undefined while outgoing consumers can still be read.
3. [Shelf.svelte](../../../src/lib/ui/components/Shelf.svelte) line 98 creates its adapter once with `untrack`, using a getter over the mutable optional `source!`. The non-null assertion supplies no runtime protection. [shelves/index.ts](../../../src/lib/ui/shelves/index.ts) lines 22–35 explicitly assumes that the source family stays fixed for a mounted Shelf.
4. [shelves/library.svelte.ts](../../../src/lib/ui/shelves/library.svelte.ts) lines 40–54 destructures the current configuration. Its `initialScope` default at line 47 calls `getOptions().preview`, which throws when the outgoing Shelf's getter now returns undefined. The browser stack's line number is from transformed development output; line 47 is the corresponding current-source dereference.
5. The outgoing presentation is also available to overlay chrome through [detail-section.svelte.ts](../../../src/lib/ui/detail-section.svelte.ts) lines 9–14 and [DetailOverlay.svelte](../../../src/lib/ui/components/DetailOverlay.svelte) lines 11–19. Its title/controls getters can read the outgoing Shelf before its host registration is detached. Keying content does not freeze those getters or guarantee that every presentation read stops before the shared union changes shape.

The observed undefined-property error and stale UI are confirmed. The intermediate handoff explanation is supported by the exact source contracts and compiler output; individual reactive reads were not instrumented in the live browser. All eight source files recorded in the evidence are byte-identical to the audited HEAD. No HMR source edit occurred during either reproduction.

### Generic repair options

**Preferred smallest coherent option:** make the existing detail owner publish a resolved render snapshot with a stable identity, discriminator and matching payload. Keep the outgoing instance's props and section presentation bound to that snapshot until it is disposed; keep a separate pending destination for the existing inert/busy behavior. A keyed component boundary must capture the payload belonging to its identity rather than read a newly shaped outer union through old props. Preserve controller freshness, permission withdrawal, Back/Forward, edition and active player/reader behavior. This is an ownership repair within the current detail architecture, not a new cache or scheduler.

**Shared Shelf alternative where source replacement is intentional:** enforce the existing fixed-source-family contract at the sourced-Shelf boundary. Mount a source owner only for a valid configuration and dispose/recreate that owner when its source family or documented identity changes. All outgoing adapter and section-host reads must retain a coherent configuration until disposal; no-source rendering uses the existing source-free Shelf path. Avoid resetting every filter/page merely because an equivalent options object is recreated. This option has a broader state-preservation surface and should be selected only if the resolved-detail repair does not establish the invariant for every caller.

Checking only `getOptions()?.preview`, adding default library options, catching this exception, or delaying replacement with a timer is insufficient: other library destructuring and the other source factories also require valid typed configurations. A default can render the wrong medium or issue unintended requests. A section-title active guard can reduce an outgoing read, but is not independently proven to repair the source lifetime contract.

### Owner and consumer matrix

| Shared owner | Consumers requiring acceptance | Evidence boundary |
| --- | --- | --- |
| DetailPanel resolved identity/payload and shallow-history handoff | Section → music/screen/game/reading/group/remote/person; detail → section; section → different section; Back/Forward/close/reopen | Library Listen section → music work reproduced twice; other directions remain acceptance cases |
| Shelf factory and typed configuration lifetime | Library, Progress, For You, Discovery, Social, Journal, Search, List, Credits and Detail source families | All share Shelf's line-98 getter/factory boundary; only Library failure is runtime reproduced |
| Detail section host registration and presentation | Overlay title, segments, controls, outgoing/incoming section Shelf, nested detail history | Source confirms outgoing presentation remains registered until cleanup; no leak is inferred |
| Existing resource and transport ownership | Pending section reads, detail reads/enhancement, social enrichment and menu state on replacement | Existing abort/dispose behavior must remain; no new cancellation defect is claimed solely from this exception |

### Acceptance and regression protection

Run the exact two-reproduction journey on the same normal-development actual catalogue before and after the fix. Record only counts, route kinds, error signatures and timing aggregates. Require all of the following:

- The populated section's title click opens the matching real music detail, with no uncaught exception or stale section body. Back restores its filters, loaded position and scroll; Forward, close, reopen and rapid repeated selection remain coherent.
- Repeat section → item → Back across every enabled medium and section source family using actual saved entries. Exercise section → different source family and detail → section. Record unavailable real families as gaps rather than inventing performance data.
- Delay the next detail response/import, navigate Back or close, and replace the target before it completes. An outgoing mounted adapter never receives undefined or a different configuration family. Its host registration and admitted reads dispose once; late results cannot change the new detail.
- Change account/feature access while pending. Clear private state immediately according to existing policy; retaining the old render snapshot must not extend authorization or display withdrawn data.
- Preserve active personal/party playback, reader visibility, selected editions, keyboard focus, overlay heading/controls, shallow history depth, modified-click/full-route behavior and the approved UI.
- Add one meaningful Svelte/browser regression around the shared replacement invariant and the actual journey. Existing URL-parser tests do not execute this reactive component handoff. Source compilation here is supplementary explanation, not a replacement for runtime acceptance.

No fix or after-change acceptance has been executed. Sanitized reproduction, compiler observations and source hashes are in [normal-dev-row-transition.json](evidence/normal-dev-row-transition.json). The normalized finding is in [frontend-live-findings.json](frontend-live-findings.json); it belongs primarily to W03, with W09/W05 consumer overlap.
