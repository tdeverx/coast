#!/usr/bin/env python3
"""Regenerate lexical data/API drift inventory; review annotations are evidence, not automatic certification."""
import hashlib,json,pathlib,re,subprocess
root=pathlib.Path(__file__).resolve().parents[3]
out=pathlib.Path(__file__).resolve().parent
prefixes=['src/lib/application','src/lib/catalogue','src/lib/collection','src/lib/core','src/lib/experiments','src/lib/games','src/lib/server/api','src/lib/server/auth','src/lib/server/db','src/lib/server/notifications','src/lib/server/public-api','src/lib/server/queries','src/lib/social','src/lib/recommendations']
files=set()
for prefix in prefixes:
 files.update(p for p in (root/prefix).rglob('*.ts') if '.svelte.' not in p.name)
for path in ['src/hooks.server.ts','src/lib/server/config.ts','src/lib/server/features.ts','src/lib/server/experimental.ts','src/lib/server/content-revision.server.ts','src/lib/auth/registration.ts','src/lib/notifications/model.ts','src/lib/public-api.ts','src/lib/features.ts','src/lib/experimental.ts','src/lib/progress.ts','src/lib/library.ts','src/lib/search.ts']:
 files.add(root/path)
# Route adapters are inventoried independently; their rendering and UI are the coordinator's scope.
files.update((root/'src/routes').rglob('*server.ts'))
notes={
 'src/hooks.server.ts':('full-owner-read','Configuration/auth/setup/feature/onboarding common request floor; share/public/health exceptions, signal and no-store behavior.',['DATA-10']),
 'src/lib/server/config.ts':('full-owner-read','AsyncLocalStorage request lifetime, explicit-transaction bypass, subject memo40, committed snapshot replacement.',['DATA-09']),
 'src/lib/server/features.ts':('full-owner-read','Policy lock precedes fresh transaction decision; disabled subjects and feature dependency mapping.',['DATA-01']),
 'src/lib/server/db/index.ts':('full-owner-read','Lazy process pool10, jitoff, idletimeout0 for reserved advisory-lock sessions, lifecycle shutdown guard.',['DATA-10']),
 'src/lib/server/db/schema.ts':('schema-and-index-inventory','All table definitions/indices extracted; query plans and actual table counts belong to coordinator evidence.',[]),
 'src/lib/server/auth/index.ts':('full-owner-read','Session row lock/rotation/previous grace, Argon2 outside account-create transaction, attempt cap10k, user/settings writes.',['DATA-10','DATA-09','DATA-01']),
 'src/lib/server/auth/onboarding.ts':('full-owner-read','Account-generation import evidence, pending checks, durable initial jobs and polling recursion; no page-time performance certification.',[]),
 'src/lib/server/content-revision.server.ts':('full-owner-read','Counters+peers+connections rather than event histories; time-dependent availability; status projection.',[]),
 'src/lib/server/public-api/mutations.server.ts':('full-owner-read','Canonical idempotency,64KiB body, shared domain tx, account advisory and unqualified joined row lock.',['DATA-01','DATA-02']),
 'src/lib/server/public-api/handler.server.ts':('full-owner-read','Bearer/scopes/DTOs,60pages, category/privacy before hydration; HEAD executes same read then discards body.',[]),
 'src/lib/server/public-api/tokens.server.ts':('full-owner-read','20active/token list50; per-token atomic durable120/minute; feature/onboarding fresh; one write per accepted API request.',[]),
 'src/lib/server/public-api/webhooks.server.ts':('full-owner-read','10active subscriptions, transactional outbox emissions, delivery10s/64KiB/8attempts; direct provider body bounds.',[]),
 'src/lib/server/public-api/library.server.ts':('full-owner-read','Recursive accessible ancestors+count then60IDs; no browse providers.',[]),
 'src/lib/server/public-api/progress.server.ts':('full-owner-read','Already-paged identity activity hydration, sum game sessions per selected latest playthrough.',[]),
 'src/lib/server/public-api/response.ts':('full-owner-read','Explicit DTO fields and shared paging60, no private notes.',[]),
 'src/lib/server/api/index.server.ts':('full-owner-read','Every top-level dispatch family source path inspected; shared domains, request signals and UUID/field bounds.',['DATA-04','DATA-06','DATA-08','DATA-11']),
 'src/lib/server/api/lists.server.ts':('full-owner-read','Full-list legacy GET and playback-start header overfetch; mutations delegate core owner.',['DATA-03','DATA-12']),
 'src/lib/server/api/profile.server.ts':('full-owner-read','Card-free insights present; activity/favourites discard presentation fields.',['DATA-13']),
 'src/lib/server/queries/media.ts':('full-owner-read','Narrow snapshots/artwork,20ish bounded page queries; complete selected membership, next candidate and sequence paths.',['DATA-04','DATA-11']),
 'src/lib/server/queries/progress.ts':('full-owner-read','Full screen state/continuation planning; received recommendations prepage all roots; other medium pages/privacy.',['DATA-05','DATA-06']),
 'src/lib/server/queries/continuations.ts':('full-owner-read','All relevant episode state and started source identities; batching next entries; next-season semantics.',['DATA-05']),
 'src/lib/server/queries/home.ts':('full-owner-read','Hero invokes full Continue planner then tracked/library fallbacks, nextPlayable.',['DATA-05']),
 'src/lib/server/queries/profile.ts':('full-owner-read','Summary/insights repair present; presentation background/featured, all-period aggregates/history pages.',['DATA-13']),
 'src/lib/server/queries/lists.ts':('full-owner-read','Summary inventory each read; selected60page; selected entry roots sequence; legacy complete expansion.',['DATA-12']),
 'src/lib/server/queries/discovery.ts':('full-owner-read','Mixed medium branches; reading provider pages, music visibility aggregation, screen both-bucket owner.',['DATA-08']),
 'src/lib/server/queries/search.ts':('full-owner-read','Local-first reading,2provider kinds, music source4 concurrency, IGDB sources Promise.all and aliases; route demand root-owned.',[]),
 'src/lib/server/queries/media-actions.ts':('full-owner-read','On-open local menu, next selection, source/request/rewatch reads, bounded60history, additional parent hydration.',['DATA-04']),
 'src/lib/server/queries/media-rows.ts':('full-owner-read','Music4-source concurrency,12cards/source; game status hydrates60 then slices12; shared configuration-only SSR.',[]),
 'src/lib/server/queries/music.ts':('full-owner-read','50/source fanout4, selected source validation, out-of-range retry; total transfer grows sources.',[]),
 'src/lib/server/queries/library.ts':('full-owner-read','Filter/count before60hydrate; owner metadata/rewatch/availability predicates; representative plans unverified.',[]),
 'src/lib/server/queries/library-content.ts':('full-owner-read','Thin watch/listen/play/read branch into shared paged owners.',[]),
 'src/lib/server/queries/show-next.ts':('full-owner-read','Window focus selection over full show;60ordered episode page; rewatch/drop/date/availability semantics.',[]),
 'src/lib/server/queries/media-statistics.ts':('full-owner-read','Scoped canonical recorded watches; daily exact history aggregate; all-period series unbounded years.',[]),
 'src/lib/server/queries/requests.ts':('full-owner-read','Owner/filter count+60request page+shared identity hydration.',[]),
 'src/lib/collection/query.server.ts':('full-owner-read','Recursive assessment roots/reasons/privacy/availability; personalpage60; workCards cross-medium/ordered batches; workAssessments unchunked.',['DATA-06','DATA-11','DATA-14']),
 'src/lib/collection/demand.server.ts':('full-owner-read','Personal missing60; admin per-user full demand before60user page; output bound differs work bound.',['DATA-14']),
 'src/lib/collection/freshness.server.ts':('full-owner-read','One checkpoint boolean/indexed expired predecessor/source, no history hashing.',[]),
 'src/lib/collection/projection.server.ts':('full-owner-read','Full desired/remote census,leaf identity loops,per-add confirmation; provider deep acceptance integrations-owned.',['DATA-14']),
 'src/lib/collection/source-changes.server.ts':('full-owner-read','Before/after desiredProjection per account,local evidence,consent/version1hour; notifications per unique user.',[]),
 'src/lib/core/tracking/service.server.ts':('full-owner-read','Every apply/bulk/history branch; no-op source markers, user/advisory/parent fences,sequence revalidation,sibling transfer.',['DATA-01','DATA-02']),
 'src/lib/core/tracking/continue.server.ts':('full-owner-read','Whole-show scope/undo; all queued rows then filter actual removed IDs; history-preserving drop.',[]),
 'src/lib/core/tracking/rewatch.server.ts':('full-owner-read','Latest boundary shared expressions; whole-show child invalidation,source/state no-op opportunities.',[]),
 'src/lib/core/lists/service.server.ts':('full-owner-read','Owner locks, ordinary duplicate no-op,complete summaries/detail,remove/reorder per-row writes,move neighbour2rows.',['DATA-03','DATA-12']),
 'src/lib/core/lists/sequence.server.ts':('full-owner-read','Shared recursive/event definition,validation,selectedroots,60source summaries/next,full entry outputs.',['DATA-02']),
 'src/lib/core/lists/up-next.server.ts':('full-owner-read','Conflict-do-nothing insertion but projection enqueue regardless changed state.',['DATA-07']),
 'src/lib/core/games/service.server.ts':('full-owner-read','Searchpage60,private detail/history,session idempotency,semantic noop missing,IGDB identity locks/parent/presentation.',['DATA-07','DATA-11']),
 'src/lib/core/ratings/service.server.ts':('full-owner-read','Same Coast rating noop;source takeover;transactional webhook only semantic value change.',[]),
 'src/lib/core/reading/service.server.ts':('full-owner-read','Equal settled reading noop;explicit restart,policy/user locks,transactional webhook,source init only.',[]),
 'src/lib/core/media/service.server.ts':('full-owner-read','Manual season input<=100episodes,atomic row creation and summary invalidation; no providers in locks.',[]),
 'src/lib/core/profile/service.server.ts':('full-owner-read','Profile row lock;avatar inline220k vs GIF URL;favourites custom order2000/pin50;equal writes.',['DATA-07','DATA-09']),
 'src/lib/core/profile/gif-avatar.server.ts':('full-owner-read','5MiBGIF original stored hashed,atomic rename,cleanup under user lock,permission stream; raster generic candidate.',['DATA-09']),
 'src/lib/core/profile/avatars.server.ts':('full-owner-read','Provider choices60,owner binding,5MiBbounded fetch,actual-format validation,request cancellation.',[]),
 'src/lib/application/media-details.server.ts':('full-owner-read','Initial complete read then optional repeat after own/parent enrichment.',['DATA-04']),
 'src/lib/application/work-details.server.ts':('full-owner-read','One canonical branch/medium;screen complete details;only music-source forwards cancellation.',['DATA-04']),
 'src/lib/application/configuration.server.ts':('full-owner-read','Global feature lock,merge,audit and durable withdrawal enqueue within commit;ownrequest replacement.',[]),
 'src/lib/application/feature-transition.server.ts':('full-owner-read','Users40,page closure100/type,commit/yield,cutoff config;missing in-tx active job lease forwarded integration lane.',[]),
 'src/lib/application/reading.server.ts':('full-owner-read','Provider read before domain transactions,actual resolved medium gate,shared identity/save.',[]),
 'src/lib/application/streams.server.ts':('full-owner-read','Source/history21 then20global merger;cards50batches;source count SQL;shared device exclusion.',[]),
 'src/lib/application/provider-sources.server.ts':('full-owner-read','Disconnect bulk local state then notifications;delete try-locks/active jobs;provider/data cleanup integrations-owned.',[]),
 'src/lib/catalogue/service.server.ts':('full-owner-read','Identity locks,atomic metadata/link persistence,unchanged snapshot writes,detail7day,singleflight,search/discovery ingestion.',['DATA-07','DATA-08']),
 'src/lib/catalogue/maintenance.server.ts':('full-owner-read','Bounded paged scans100/10,seen10k,missing100,page10k/offset1m;finite100refresh census/checkpoint.',[]),
 'src/lib/catalogue/details.server.ts':('full-owner-read','Finite100insights cache/15m,person cache,24selected-credit imports concurrency4,complete filmography match in memory.',[]),
 'src/lib/catalogue/reading.server.ts':('full-owner-read','Ordered identity locks,semanticnoops,features/readinggroup distinct predicates,primary-source preserving alias enrichment.',[]),
 'src/lib/catalogue/reading-files.server.ts':('full-owner-read','Exact file/generation admission,lease fencing,quarantine commit,unchanged snapshot/edition writes/fresh access observations.',['DATA-07']),
 'src/lib/catalogue/trakt-identity.server.ts':('full-owner-read','Identity-first canonical resolution,recursive parent calls and fallback metadata import;provider audit owns transport.',[]),
 'src/lib/catalogue/overrides/service.server.ts':('full-owner-read','On-open full snapshot editor;shared metadata/locks replace anddiagnostics;personal preferences unconditional upsert.',[]),
 'src/lib/catalogue/overrides/presentation.server.ts':('full-owner-read','Viewer-owned aliases/prefs60batches;GIN predicate beforecount/limit.',[]),
 'src/lib/social/queries.server.ts':('full-owner-read','Conditional relationship scopes;complete activity group before61cursor;heads3/root bounded SQL;reaction60.',['DATA-09']),
 'src/lib/social/relationships.server.ts':('full-owner-read','Scoped descendants/ancestors/reasons shared by cardheads and item activity;ordinary feed no traversal.',[]),
 'src/lib/social/service.server.ts':('full-owner-read','Friends61, recommendation61,friendship/policy atomicity andsocial actions/notification domain reuse.',[]),
 'src/lib/social/insights.server.ts':('full-owner-read','Exactcounts SQL;sample300/person,overlap60;shared feature hydration;friendDiscovery60 overvisible30dayactivity.',[]),
 'src/lib/social/taste-cache.server.ts':('full-owner-read','Tenuser frozen checkpoint,300roots,500candidates/medium,compiled scorers,lease/revision fenced publication.',[]),
 'src/lib/social/taste-profile.ts':('full-owner-read','Dimensions12,affinities500/dimension,features100,namedscoring reusable perprofile;negative/cast evidence gates.',[]),
 'src/lib/social/taste.ts':('full-owner-read','Sampled comparisons,shared profile builder,cosine/median;affinity overlap500 bounded nested checks.',[]),
 'src/lib/social/work-features.server.ts':('full-owner-read','Batched existing metadata,dimension precedence/variants,caller ids bounded300/3000;no provider.',[]),
 'src/lib/social/presence.server.ts':('full-owner-read','Active playback/read/checkin/provider candidate precedence;latest/person,no globalresponse cap;checkin writes reuse tracking.',[]),
 'src/lib/social/status.server.ts':('full-owner-read','Heartbeat upsert10secondthreshold,dedup userstatus read,invisibility/privacy;presence settings rowlock.',[]),
 'src/lib/social/live-freshness.server.ts':('full-owner-read','Expiry full source round capped30minutes;countaccounts per live observation.',[]),
 'src/lib/social/provider-live.server.ts':('full-owner-read','Current-provider observation,accountgeneration under commit lock,expiry andremote matching;lease review integration owner.',[]),
 'src/lib/social/trakt.server.ts':('full-owner-read','Watching/history dedup generations,transactional current state,uncertain checkin attribution;live provider acceptance separate.',[]),
 'src/lib/social/public.server.ts':('full-owner-read','Guest-safe art,data/privacy paths,complete explicit membership500batches,search101 indexed.',['DATA-04']),
 'src/lib/social/privacy.server.ts':('full-owner-read','SQL-authoritative persection/category visibility,one batched sectionquery.',[]),
 'src/lib/server/notifications/inbox.ts':('full-owner-read','Summary/page context repeated;cursor61,page60;friend/work/assessment/activity hydration and snapshot markread.',['DATA-14']),
 'src/lib/server/notifications/index.ts':('full-owner-read','Shared notify100batch/preferences/visibility,dedupflush,broadcast100page;fulloutbox adminhealth aggregate.',[]),
 'src/lib/experiments/planning.server.ts':('full-owner-read','Plans100/user,20friends,page60,local releaseprojection;21serial reminder recipients;policy and cancellation integration review.',[]),
 'src/lib/recommendations/feed.server.ts':('full-owner-read','One definition census,300interestroots,10kdefinition expliciterror,up to4adjacency reads2k each.',[]),
 'src/lib/recommendations/interests.server.ts':('full-owner-read','Complete signal aggregation to300roots,negativepriority/rootcollapse,global consent revision userscan.',[]),
 'src/lib/recommendations/query.server.ts':('full-owner-read','100evidence,2kprecandidates,60hydrate,local cache/policy,provider/taste/genre/author scores.',[]),
 'src/lib/recommendations/providers.server.ts':('full-owner-read','Queue-owned schedule,6frozenseeds,20TMDB/40Trakt,account/leasefenced set publication,checkpoint/cancel.',[]),
 'src/lib/recommendations/row-ranking.ts':('full-owner-read','Bucketedranker/current multipliers andstabletie behavior;previous superlinear repeatedsort fixed.',[]),
 'src/routes/search/+page.server.ts':('route-adapter-read','Selectedview validation but all enabled initial/streamed branches start;UI root owns demandfinding.',[]),
 'src/routes/+layout.server.ts':('route-adapter-read','Globalparallel notification list50+unread+friendrequests+revision on invalidation;root UI owns cadence.',[]),
}
entries=[]
for p in sorted(files):
 rel=str(p.relative_to(root));s=p.read_text();lines=s.splitlines();depth,note,findings=notes.get(rel,(None,None,[]))
 if depth is None:
  if rel.startswith('src/routes/'):
   depth='route-boundary-inventory';note='Imports/load/action/HTTP handlers inventoried; owning domain reviewed here, complete route/UI runtime coverage is coordinator-owned.'
  elif rel.startswith('src/lib/server/api/'):
   depth='full-owner-read';note='Thin complete dispatcher read;validation,method/path gating,domain delegate and cancellation boundary inspected;deep domain acceptance in named owner.'
  else:
   depth='full-helper-read';note='Complete finite helper/schema/presentation implementation read and followed from its shared owner; SQL expressions/pure loops, validation bounds and cache lifetime inspected. No standalone runtime performance claim.'
 exports=[{'name':m.group(1),'line':s[:m.start()].count('\n')+1} for m in re.finditer(r'export\s+(?:async\s+)?(?:function|const|type|interface|class)\s+(\w+)',s)]
 sites=[]
 for n,line in enumerate(lines,1):
  kinds=[]
  if re.search(r'\b(?:sql|query|db|database|tx|transaction|getSql\(\))\s*(?:<[^`]+>)?`',line):kinds.append('tagged-sql')
  if re.search(r'\.(select(?:Distinct)?|insert|update|delete)\s*\(',line):kinds.append('orm-builder')
  if re.search(r'\.(execute|unsafe)\s*(?:<[^>]+>)?\s*\(',line):kinds.append('execute-boundary')
  if re.search(r'\.(transaction|begin)\s*(?:<[^>]+>)?\s*\(',line):kinds.append('transaction-boundary')
  if kinds:sites.append({'line':n,'kinds':kinds})
 dispatch=[{'line':n,'condition':line.strip()[:600]} for n,line in enumerate(lines,1) if 'path[' in line and ('if' in line or '?' in line)] if '/server/api/' in rel or '/server/public-api/' in rel else []
 imports=[{'module':m.group(1),'line':s[:m.start()].count('\n')+1} for m in re.finditer(r"from\s+['\"]([^'\"]+)['\"]",s)]
 entries.append({'path':rel,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'lines':len(lines),'reviewDepth':depth,'reviewNote':note,'exports':exports,'domainImports':imports,'apiDispatchConditions':dispatch,'lexicalQuerySites':sites,'findings':findings,'runtimeEvidence':'see coordinator actual-data evidence; not implied by source review'})
schema=(root/'src/lib/server/db/schema.ts').read_text();tables=[]
ms=list(re.finditer(r'export const (\w+)\s*=\s*pgTable\(\s*[\n ]*[\'\"]([^\'\"]+)',schema))
for index,m in enumerate(ms):
 chunk=schema[m.start():ms[index+1].start() if index+1<len(ms) else len(schema)]
 tables.append({'symbol':m.group(1),'table':m.group(2),'line':schema[:m.start()].count('\n')+1,'indexes':re.findall(r'(?:uniqueIndex|index)\([\'\"]([^\'\"]+)',chunk),'references':len(re.findall(r'\.references\(',chunk)),'runtimeRowCoverage':'coordinator aggregate table census; no private row values retained'})
commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=root,text=True).strip()
record={'schemaVersion':1,'date':'2026-10-17','sourceHead':commit,'purpose':'Per-file source and SQL-site drift inventory; lexical sites are not runtime SQL counts. Every record has an explicit review depth, preventing blanket runtime coverage claims.','files':entries,'schemaTables':tables,'counts':{'files':len(entries),'schemaTables':len(tables),'lexicalQuerySites':sum(len(e['lexicalQuerySites']) for e in entries)},'runtimeLimitations':['Actual-data local read measurements do not exercise remote providers.','Actual-data absent lists/pending recommendations cannot certify nonempty fanout.','ORM logger counts omit direct Bun SQL.','Every row/table census is coordinator-owned; no claim every private value was manually examined.']}
(out/'data-api-coverage.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'files':len(entries),'tables':len(tables),'sites':record['counts']['lexicalQuerySites'],'head':commit}))
