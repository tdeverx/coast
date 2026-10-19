# Request-options cancellation implementation

Implements UIC-02 in the shared option-read lifetime. Submitted request commands retain their existing acknowledgement/durable-delivery behavior. No dependency, schema/index or visual design changes.

## Common ownership and consumers

`ui/controls/request-options.svelte.ts` is a thin endpoint-specific wrapper around the existing `createResource` owner. Both `RequestDialog.svelte` and the screen work-menu's `createRequestControls` use it. They retain independent lifetimes; cancelling a menu cannot poison an interested dialog or another viewer. The wrapper owns one pending read, aborts superseded work, rejects late success/error publication and supports supplied options (including an authoritative empty array) without HTTP. The dialog retains destination, 4K and season-selection behavior. Effect cleanup cancels on close/target/options replacement; destroy permanently disposes it. Retry replaces the prior read. The existing menu guard still avoids duplicate lazy demand and retains successful empty results.

Every production RequestDialog comes through ScreenActions, used by work menus/heroes/cards and all applicable screen detail/section contexts. The same owner also covers direct dialog invocation and the preview catalogue's supplied-option scenarios. The scope remains requestable screen titles; unrelated media do not receive synthetic request behavior.

## Actual signal propagation

The existing Client API already accepts `{signal}`. The requests GET handler now passes its real HTTP request signal to `requestOptions`, through `getSeerr`, and into the common provider-instance transport factory. That factory accepts an optional owner lifetime and combines it with a per-call signal when both exist. Existing callers without an owner signal retain their original transport behavior. Seerr linked-user resolution, permission verification, server discovery and title details consequently use the same owner lifetime and existing provider admission/HTTP/body cancellation behavior.

The service checks cancellation between stages and before optional capability-cache persistence. An aborted read cannot be treated as an outage and silently return cached options. The existing `loadMediaDetails` enhancement also passes its route/API request signal into the same request-options branch; its initial saved detail response and enhancement Promise contract remain intact. Metadata enrichment without a supported cancellation contract remains its existing owner; this patch does not claim to cancel unrelated catalogue work.

**Database boundary:** database statements already admitted are not cancelled by this change. Existing account/permission verification or cache writes can finish if abort arrives during their SQL await. Checks prevent subsequent optional stages after a known abort. Submitted request reads/writes call the same service without an interactive disposal signal, so closing a disposable options viewer does not undo an acknowledged request command or weaken dispatch authorization.

## Focused verification

Nine focused tests passed with 51 parent-runner assertions:

```sh
.tools/bun-1.4.3/bun-darwin-aarch64/bun test tests/request-options-cancellation.test.ts tests/request-dialog-lifetime.test.ts tests/ui-request-controls.test.ts tests/media-details-enrichment.test.ts
```

The Svelte rune tests execute the real dialog script, shared resource and both option consumers. They cover pending target replacement, manual retry, close/reopen/dispose, uncooperative late success/error, independent consumer abort ownership, supplied empty/nonempty options, quality/season selection and preserved enhancement signal. Existing lazy menu and metadata-outage behavior stays green.

The isolated provider-queue test executes current route/service/account/transport function bodies and the real Seerr adapter against inert database/config boundaries. It holds the real provider queue at linked-user, permission and server/detail stages, aborts the real HTTP request signal and verifies all queued work releases with **zero cancelled provider executions**. The permission verification already completed before cancellation in the last stage remains an observed write; no database cancellation is inferred. These are correctness/failure fixtures, not actual-data latency measurements.

Actual signed-in normal-development Request/options opening is assigned to the coordinator after source freeze, with no request submission. Until that result is recorded, this report does not claim live Seerr/provider acceptance or a performance speedup. Broader slow-provider, account/feature withdrawal and supported destination combinations remain acceptance cases. Combined TypeScript/build/source-inventory checks belong to the coordinator after parallel source edits settle.
