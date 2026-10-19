#!/usr/bin/env python3
"""Render deliberately curated open-work decisions; never infer acceptance."""
import argparse,datetime,hashlib,json,pathlib
folder=pathlib.Path(__file__).resolve().parent
parser=argparse.ArgumentParser();parser.add_argument('--check',action='store_true');args=parser.parse_args()
record=json.loads((folder/'remaining-work-disposition.json').read_text())
ledger=json.loads((folder/'implementation-ledger.json').read_text())
open_ids={row['id'] for row in ledger['items'] if row['status']=='open'}
assert open_ids=={row['id'] for row in record['items']}, 'Refresh the curated disposition before rendering'
ledger_hash=hashlib.sha256((folder/'implementation-ledger.json').read_bytes()).hexdigest()
if args.check:
 assert record['currentOpenSetVerification']['ledgerSha256']==ledger_hash, 'Ledger identity is stale; run render-remaining-work.py'
elif record['currentOpenSetVerification']['ledgerSha256']!=ledger_hash:
 record['currentOpenSetVerification']={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'count':len(open_ids),'ledgerSha256':ledger_hash,'idsMatchLedger':True}
 (folder/'remaining-work-disposition.json').write_text(json.dumps(record,indent=2)+'\n')
link=lambda ref:'['+ref+']('+ref+')'
prior=record.get('priorCapturedDispositionRef','remaining-work-disposition-20261018-route-refresh.md')
if isinstance(prior,dict):prior=prior.get('markdown',prior.get('report','remaining-work-disposition-20261018-route-refresh.md'))
lines=['# Remaining open work — maintained disposition','',
 f'This view covers exactly **{len(open_ids)} canonical records with status=open**. Applied and staged changes, their evidence and remaining acceptance stay in the [implementation ledger](implementation-ledger.md). Partial status never means complete. The [machine record](remaining-work-disposition.json) retains original options and source pins; source identity is not runtime coverage.','',
 'The previous captured disposition remains intact: '+link(prior)+'. New actual-data and controlled evidence belongs to the linked implementation reports. This list does not replace those evidence boundaries.','',
 'Routine existing-owner repairs remain authorized. The user requires the simplest complete solution and a concrete decision before unavoidable complexity or a new production dependency. Missing actual cohorts remain explicit; no synthetic catalogue is added to claim acceptance. The approved normal migration/toast rollout and pinned navigation repair are adopted; their remaining acceptance stays in the linked implementation records.','']
for item in record['items']:
 lines+=['## '+item['id']+' — '+item['title'],'',
  '**Shared owner:** '+str(item['sharedOwner'])+'.','',
  '**Smallest option:** '+item['minimalSharedOption'],'',
  '**Actual evidence and gap:** '+item['actualData'],'',
  '**Next meaningful test:** '+item['nextMeaningfulTest'],'',
  '**Disposition:** '+item['whyNotImplementedInThisPass'],'']
 refs=list(dict.fromkeys(item.get('evidenceRefs',[])+item.get('additionalEvidenceRefs',[])))
 if refs:lines+=['Evidence and original alternatives: '+', '.join(map(link,refs))+'.','']
 if item.get('overlaps'):lines+=['Overlaps: '+', '.join(item['overlaps'])+'. Shared gains must not be counted twice.','']
lines+=['## Drift and reproduction','',
 'Edit the machine disposition deliberately, preserving each unresolved behavior, actual cohort gap and option. Keep historical snapshots and baseline evidence immutable. Refresh current source pins after reviewed owner changes; never promote acceptance from a static hash or a guarded skip. Run `render-remaining-work.py`, the ledger renderer and `verify-report-integrity.py` after changes. Re-run the linked actual-data probes when semantics or relevant source dependencies drift.','']
rendered='\n'.join(lines);target=folder/'remaining-work-disposition.md'
if args.check:
 assert target.read_text()==rendered, 'Remaining-work Markdown is stale; run render-remaining-work.py'
else:target.write_text(rendered)
print({'openRecords':len(open_ids),'rendered':not args.check,'matches':True})
