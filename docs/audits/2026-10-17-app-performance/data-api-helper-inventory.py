import pathlib,hashlib,json,re
root=pathlib.Path('/Users/admin/Documents/ChatGPT/coast-new');folder=root/'docs/audits/2026-10-17-app-performance'
files=list((root/'src/lib/media').glob('*.ts'))+list((root/'src/lib/profile').glob('*.ts'))+list((root/'src/lib/ui/controls').glob('*.ts'))
files += [root/f'src/lib/ui/{name}' for name in ['operation.svelte.ts','mutation.svelte.ts','action-feedback.svelte.ts','client-context.ts','content-revision.svelte.ts','client.ts','relationships.ts','queue.ts','section-target.ts','types.ts']]
files += [root/'src/lib/social/status.svelte.ts']
notes={
'media/artwork.ts':'Finite artwork-level/type selection and URL deduplication; source precedence retained; no network allocation or cache.',
'media/detail-target.ts':'Finite same-origin destination dispatch;2048URL bound,query uniqueness,page andidentity gates;no arbitrary remote fetch.',
'media/edition-metadata.ts':'Fixed9field extraction;skip empty values;duration-derived runtime;no cache/lifecycle owner.',
'media/editions.ts':'Technical-label normalization and finite per-source edition choice dedup/sort;input source cardinality caller-owned.',
'media/credits.ts':'Per-string split/normalize/dedup;preview2roles/full original result;no cache.',
'media/hero.ts':'Linear identity collapse/dedup;no fetch or retained cache.',
'media/model.ts':'Finite category/lifecycle/progress validation andpresentation vocabulary;no effects/resources.',
'media/requests.ts':'requestScope reconstructs distinct destination Set on each call;per-request list amplification opportunity H04.',
'profile/activity.ts':'All-time>730days uses yearboundaries andrecorded days,avoiding quietday allocations;shorter charts<=730dayloop.',
'profile/journal.ts':'One ordered pass groups contiguous day/episode runs;unknown dates/applied/actions preserved.',
'profile/period.ts':'UTC calendar day bounds,30/365dayperiod;no timers.',
'profile/url.ts':'Stateless encodeURIComponent username route.',
'ui/controls/menu-resource.svelte.ts':'Shared resource has close cancellation,scope checks,singleflight,ready-empty memo,dispose;writes retain intentional lifetime.',
'ui/controls/menu.svelte.ts':'Global outside listener referencecount;open-only resize/scroll/observers,frame teardown;closedcontrollers each retainmediaquery listener H02.',
'ui/controls/work.svelte.ts':'Shared workMenuScope fullsettings serialization;scope changes reset/reload active resource only;onDestroy disposal H01.',
'ui/controls/requests.svelte.ts':'Lazy options,generation+ID guard,AbortController/cancel/reset;empty array memoized;caller owns cancel lifecycle.',
'ui/controls/sequence.svelte.ts':'Single explicit playback command guardedbusy;captured source anduserintent;no autonomouspoll/cache;read cancellation notowned here.',
'ui/controls/queue.svelte.ts':'Per-entry in-flight guard/pendingfinally cleanup;unrelatedentry retries permitted;writes intentionallycomplete.',
'ui/operation.svelte.ts':'One in-flight command,finally busy cleanup;no timer/listener/cache.',
'ui/mutation.svelte.ts':'Acknowledged writes do notfail because optional refreshfails;oneoperationguard;notification andUndo retained.',
'ui/action-feedback.svelte.ts':'One unownedlatestnotice;ownedfailures replace perowner andonDestroyclear;host referencecleanup;retrybusyguard.',
'ui/client-context.ts':'Preview transport andfeedback isolated bySveltecontext;realclient fallback;no networkuntilrequested.',
'ui/content-revision.svelte.ts':'Three monotonic counters,primitiveuser/revision key;unchangedsession replacement isnot content;finite state.',
'ui/client.ts':'Captured playbackauthority;abort signal passed;explicitmutationrefreshdomains;shallowstate-preserving refreshAll isbroad butintentional.',
'ui/relationships.ts':'Everycategory usesonecollection/tracking/queue deliverycontract;no privateimplementation.',
'ui/queue.ts':'Pure boundedtaskrepresentative display/grouping;repeatedstatefilters proportionaldisplayedjobs;no network/timer.',
'ui/section-target.ts':'Same-origin supportedrow destinations only;reuses Shelfconfigs/profileprojection;2048URL bound;no arbitraryfetch.',
'ui/types.ts':'Type-only display/card/progress/playback shape contracts;no runtimework.',
'social/status.svelte.ts':'One in-flight30second heartbeat,hiddenunlessplaying,abort/timer/listenercleanup;missingpost-awaitstopped guard H03candidate.'}
entries=[]
for p in sorted(set(files)):
 rel=str(p.relative_to(root));s=p.read_text();key=rel.removeprefix('src/lib/')
 entries.append({'path':rel,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'lines':len(s.splitlines()),'reviewDepth':'full-helper-control-flow-read','reviewNote':notes.get(key,'Complete finite action/model/schema/helper read;identity/card contracts andvalidation boundaries;no independent resource owner.'),'exports':[{'name':m.group(1),'line':s[:m.start()].count('\n')+1} for m in re.finditer(r'export\s+(?:async\s+)?(?:function|const|type|interface|class)\s+(\w+)',s)],'verification':'Source/control-flow review only; no additional tests or fabricated data; actual avatar sizes from coordinator aggregates.'})
(folder/'data-api-helper-coverage.json').write_text(json.dumps({'schemaVersion':1,'date':'2026-10-17','sourceHead':'eb0673873462b71118d1c11678d128958a05ff07','files':entries,'count':len(entries),'findings':['HELPER-01','HELPER-02','HELPER-03','HELPER-04'],'runtimeLimitations':['No helper browser race/allocation benchmark executed in this residual pass.','Geometry and post-disposal behavior source-reviewed, not stress-certified.','No new tests requested or run.']},indent=2)+'\n')
print(len(entries))
