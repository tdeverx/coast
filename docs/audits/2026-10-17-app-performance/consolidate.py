#!/usr/bin/env python3
"""Regenerate this pinned audit register from its curated area reports (stdlib only)."""
import argparse,json,os,pathlib,re
p = pathlib.Path(__file__).resolve().parent
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--implementation-ledger',type=pathlib.Path,help='Optional current-status overlay; defaults to the sibling implementation-ledger.json when present.')
args=parser.parse_args()
ledger_path=args.implementation_ledger or p/'implementation-ledger.json'
if args.implementation_ledger and not ledger_path.is_file():parser.error('The requested implementation ledger does not exist.')
ledger=None
if ledger_path.is_file():
 try:ledger=json.loads(ledger_path.read_text())
 except (OSError,json.JSONDecodeError) as error:parser.error('Cannot read implementation ledger: '+str(error))
 if not isinstance(ledger,dict) or type(ledger.get('schemaVersion')) is not int or ledger['schemaVersion']!=1:parser.error('Implementation ledger requires schemaVersion 1.')
 if ledger.get('baseline')!='eb0673873462b71118d1c11678d128958a05ff07':parser.error('Implementation ledger baseline must match this pinned audit SHA.')
 if not isinstance(ledger.get('items'),list):parser.error('Implementation ledger requires an items array.')
root=[
 {'id':'FRT-01','priority':'P2','title':'Selected search medium still starts other enabled searches','sharedOwner':'Normalized search demand plan at the canonical route/provider boundary','consumers':['unified and medium/type Search','screen/music/game/book/comic providers','public search','reading pagination'],'state':'source-confirmed excess demand; actual provider timing unmeasured','evidenceRefs':['frontend-routes.md'],'smallestOption':'Use one normalized selection plan for local/provider work and busy state; propagate cancellation.','acceptance':'Actual selected/all-medium searches; exact results; zero irrelevant provider calls; superseded/aborted/disabled cases.'},
 {'id':'FRT-02','priority':'P2','title':'Public details activate private enrichment and false expiry handling','sharedOwner':'Canonical detail capability model and shared API error delivery','consumers':['public and signed-in full details','shallow detail panels','insights/reviews/credits','public detail links'],'state':'actual deployed public401 observed; matching current source; normal dev public acceptance separate','evidenceRefs':['frontend-routes.md','evidence/deployed-real-browser.json'],'smallestOption':'Gate optional work using explicit viewer capabilities; preserve endpoint authorization and real expiry behavior.','acceptance':'Actual anonymous details produce no private calls or false expiry; authenticated and genuine expiry remain correct.'},
 {'id':'FRT-03','priority':'P2','title':'Profile reads and onboarding polling bypass shared cancellation ownership','sharedOwner':'Existing resource/poll/transport and logical preference mutation owners','consumers':['profile favourites/insights','onboarding/device/import status','related registration/presence seams'],'state':'source-confirmed cancellation/visibility gap; present latency unmeasured','evidenceRefs':['frontend-routes.md'],'smallestOption':'Use abortable latest-read ownership and one owned poll; coalesce equivalent pending preference snapshots.','acceptance':'Actual profile/onboarding flows; rapid supersession; hidden/resume; unmount pending; write failure/final choice.'},
 {'id':'FRT-04','priority':'P2','title':'Lazy component imports have no scoped error and retry state','sharedOwner':'Shared lazy-component resource/error/retry contract','consumers':['Reader','detail panel','Friends','Notifications','Streams','DynamicFeed','preview/chart imports'],'state':'source-confirmed recovery defect under chunk failure; real chunk injection not executed','evidenceRefs':['frontend-routes.md'],'smallestOption':'Give all demand imports a common actionable failure and retry state; fence late publication.','acceptance':'Fail an actual built chunk during actual-data flow; retry; close/replace; reopen; account replacement.'},
 {'id':'FRT-05','priority':'P2','title':'Public detail ancestry includes recommendation edges and can replace the hero title','sharedOwner':'publicDetails structural parent query','consumers':['all anonymous screen details','public hero title and breadcrumb parents','public parent card hydration'],'state':'found during implementation acceptance; actual normal-dev wrong title and actual-data non-hierarchy parents reproduced on baseline','evidenceRefs':['frontend-routes.md','evidence/public-hierarchy-before.json','evidence/implementation-public-hierarchy.json'],'smallestOption':'Restrict public relationship parents to structural edge kinds; preserve explicit episode-show ancestry and other response fields.','acceptance':'Actual public wrong-title retry plus complete actual response comparisons for movie/show/season/episode/collection and related-edge cohorts.'},
]
assign={'DATA-01':'W01','DATA-02':'W05','DATA-03':'W06','DATA-04':'W05','DATA-05':'W02','DATA-06':'W02','DATA-07':'W06','DATA-08':'W06','DATA-09':'W08','DATA-10':'W01','DATA-11':'W08','DATA-12':'W05','DATA-13':'W08','DATA-14':'W02','PJ-01':'W03','PJ-02':'W04','PJ-03':'W04','PJ-04':'W10','PJ-05':'W06','PJ-06':'W06','PJ-07':'W07','PJ-08':'W06','PJ-09':'W06','PJ-10':'W07','PJ-11':'W07','PJ-12':'W08','PJ-13':'W08','PJ-14':'W03','PJ-15':'W07','PR-01':'W04','PR-02':'W03','PR-03':'W03','PR-04':'W03','PR-05':'W06','PR-06':'W04','PR-07':'W04','PR-08':'W03','PR-09':'W08','PR-10':'W08','PR-11':'W05','PR-12':'W09','PR-13':'W04','PR-14':'W07','UIS-01':'W09','UIS-02':'W03','UIS-03':'W09','UIS-04':'W09','UIS-05':'W10','UIS-06':'W09','UIS-07':'W04','UIC-01':'W08','UIC-02':'W03','UIC-03':'W06','UIC-04':'W08','UPP-01':'W11','UPP-02':'W11','UPP-03':'W11','UPP-04':'W12','FRT-01':'W10','FRT-02':'W10','FRT-03':'W03','FRT-04':'W10','HELPER-01':'W08','HELPER-02':'W09','HELPER-03':'W03','HELPER-04':'W08','HELPER-05':'W12','PANEL-01':'W09','LIVE-01':'W03','LIVE-02':'W08','LIVE-03':'W12'}
assign['FRT-05']='W10'
assign.update({f'LOCK-{n:02}':'W01' for n in range(1,5)})
items=[]
for name in ['data-api','providers-jobs','playback-readers','ui-second-pass','ui-components','ui-preview-platform','frontend-routes','frontend-live','reading-live','panel-scroll','mutation-locks']:
 x={'findings':root} if name=='frontend-routes' else json.load(open(p/(name+'-findings.json')))
 for v in x['findings']+(x.get('helperFindings',[])if name=='data-api'else[]):
  items.append({'id':v['id'],'priority':v.get('priority',v.get('severity','measurement-gated')),'title':v['title'],'workstream':assign[v['id']],'sharedOwner':v.get('sharedOwner'),'consumers':v.get('consumers',[]),'evidenceClass':v.get('classification',v.get('state',v.get('status','See source report'))),'confidence':v.get('confidence','See source report'),'evidenceRefs':v.get('evidenceRefs',v.get('evidence',[])),'relatedFindingIds':v.get('relatedFindingIds',[]),'analysis':name+'.md','detailArtifact':name+'-findings.json','implementationApplied':False,'crossConsumerAcceptanceRequired':True})
 if name=='data-api':
  for n,v in enumerate(x.get('smallerOpportunities',[]),1):items.append({'id':f'MIN-{n:02}','priority':'P3','title':v['cost'],'workstream':'W08','sharedOwner':v['source'],'consumers':'See data-api.md smaller opportunities','evidenceClass':v.get('classification','source-only opportunity'),'options':v['sharedOptionAndVerification'],'analysis':'data-api.md','detailArtifact':'data-api-findings.json','implementationApplied':False,'crossConsumerAcceptanceRequired':True})
  for n,v in enumerate(x.get('sqlCandidates',[]),1):items.append({'id':f'PLAN-{n:02}','priority':'measurement-gated','title':v['owner'],'workstream':'W12','sharedOwner':v['owner'],'consumers':'See query family coverage','evidenceClass':'Plan-gated lead; may overlap a promoted confirmed finding','options':v['investigationOptions'],'scale':v['dimensionAndBound'],'analysis':'data-api.md','detailArtifact':'data-api-findings.json','implementationApplied':False,'crossConsumerAcceptanceRequired':True})
assert len({v['id']for v in items})==len(items)
if ledger is not None:
 canonical={item['id'] for item in items}
 updates={}
 for entry in ledger['items']:
  if not isinstance(entry,dict) or not isinstance(entry.get('id'),str) or entry['id'] not in canonical:parser.error('Implementation ledger entries require canonical finding IDs.')
  if entry['id'] in updates:parser.error('Duplicate implementation ledger ID: '+entry['id'])
  if not isinstance(entry.get('status'),str) or not entry['status'].strip():parser.error('Implementation ledger entry requires a nonempty status: '+entry['id'])
  if type(entry.get('implementationApplied')) is not bool:parser.error('Implementation ledger entry requires boolean implementationApplied: '+entry['id'])
  if not isinstance(entry.get('evidenceRefs',[]),list) or any(not isinstance(ref,str) for ref in entry.get('evidenceRefs',[])):parser.error('Implementation evidenceRefs must be an array of strings: '+entry['id'])
  updates[entry['id']]=entry
 for item in items:
  current=updates.get(item['id'],{'id':item['id'],'status':'not-addressed','implementationApplied':False,'evidenceRefs':[],'remaining':['Not covered by the current implementation ledger.']})
  item['baselineImplementationApplied']=item['implementationApplied']
  item['implementation']=dict(current)
  item['currentStatus']=current['status']
  item['implementationApplied']=current['implementationApplied']
# Validate the overlay before writing any generated artifact.
(p/'frontend-routes-findings.json').write_text(json.dumps({'commit':'eb0673873462b71118d1c11678d128958a05ff07','findings':root},indent=2)+'\n')
backlog={'schemaVersion':1,'commit':'eb0673873462b71118d1c11678d128958a05ff07','status':'audit and options documented; actual signed-in dev checked; remaining acceptance gaps explicit','boundary':'Entries include overlaps, confirmed/source findings, smaller opportunities and plan-gated leads. Not a count of independent production defects or additive speedups.','count':len(items),'items':items}
if ledger is not None:backlog['implementationLedger']={'path':os.path.relpath(ledger_path.resolve(),p),'baseline':ledger['baseline'],'count':len(ledger['items'])}
(p/'findings.json').write_text(json.dumps(backlog,indent=2)+'\n')
progress=('Current implementation and outstanding acceptance are tracked in [the implementation ledger]('+os.path.relpath(ledger_path.resolve(),p)+'). Status and implementation flags below reflect that overlay; audit-time evidence fields remain historical. ' if ledger is not None else 'Implementation progress is tracked separately; an optional `implementation-ledger.json` supplies current status without replacing audit-time evidence. ')
lines=['# Full finding and opportunity register','','Source and runtime boundaries are in [the main report](README.md). '+progress+'This is a register of **'+str(len(items))+' recorded items**, including overlaps, small opportunities and plan-gated leads; it is not '+str(len(items))+' independently verified production defects. Canonical owners and complete acceptance live in the linked detailed reports. Every accepted fix must cover all of its consumers.','']
lines+=['| ID | Priority / type | Shared plan | Finding / opportunity | Analysis |'+(' Current status |' if ledger is not None else ''),'| --- | --- | --- | --- | --- |'+(' --- |' if ledger is not None else '')]
for v in items:
 title=v['title'].replace('`','').replace('|','/').replace('\n',' ')
 lines.append('| '+v['id']+' | '+v['priority']+' | '+v['workstream']+' | '+title+' | ['+v['analysis'].replace('.md','')+']('+v['analysis']+') |'+(' '+v['currentStatus'].replace('|','/').replace('\n',' ')+' |' if ledger is not None else ''))
lines+=['','## Deduplication and task use','','Implement by W01–W12 in the main report. For example, DATA-02 and the screen-sequence portion of PR-11 share one sequence repair; DATA-07/PR-05/PJ import cases share canonical no-op/batching requirements; PR-02/03/04/PJ-01/UIS-02/UIC-02/FRT-03 share request lifetime contracts but retain distinct required policies; UIC-01/HELPER-01 overlap settings scope serialization. Do not sum those entries as separate gains.','','PL AN leads remain in the register to make future review visible; a matching promoted finding such as DATA-14 takes precedence over its earlier measurement-gated query-family lead. Planning or implementing an item must link its actual-data workload, all consumers, behavior invariants, evidence status and open acceptance gaps.','']
lines=[x.replace('PL AN','PLAN')for x in lines]
(p/'findings.md').write_text('\n'.join(lines))
print({'items':len(items),'primaryAndHelper':len([v for v in items if not v['id'].startswith(('MIN-','PLAN-'))]),'opportunities':8,'planLeads':10})
