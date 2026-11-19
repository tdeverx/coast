#!/usr/bin/env python3
"""Check current audit bookkeeping; never promote an acceptance status."""
import argparse,datetime,difflib,hashlib,json,pathlib,re,subprocess,tempfile,urllib.parse
from audit_evidence import EvidenceArchive,digest,history_matches

folder=pathlib.Path(__file__).resolve().parent
root=folder.parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--output',type=pathlib.Path);args=parser.parse_args()
publication=json.loads((folder/'artifact-publication.json').read_text())
toast=json.loads((folder/'implementation-toast.json').read_text())
toast_repairs=toast.get('laterOwnerRepairs',{})
archive_path=folder/publication['archive']
archive_hash_matches=digest(archive_path)==publication['archiveSha256']
if not archive_hash_matches:
 raise SystemExit('The historical evidence archive SHA-256 does not match its publication manifest.')
archive=EvidenceArchive(archive_path,{
 'evidence/detail-section-demand-panel-promotion.json',
 'evidence/implementation-toast-source-manifest.json',
 'evidence/implementation-approved-normal-rollout.json',
 'evidence/implementation-approved-avatar-0064-normal.json',
 'candidates/avatar-storage/adoption-manifest.json',
 'candidates/avatar-storage/adoption.patch',
 toast['reviewPatch'],
 *(repair[key] for repair in toast_repairs.values() for key in ('beforeRef','patchRef')),
})

def evidence_bytes(name):
 if name in archive.payloads:return archive.payloads[name]
 return (folder/name).read_bytes()

def evidence_name(path):
 return path.relative_to(folder).as_posix() if path.is_relative_to(folder) else None

ledger=json.loads((folder/'implementation-ledger.json').read_text());findings=json.loads((folder/'findings.json').read_text());disposition=json.loads((folder/'remaining-work-disposition.json').read_text())
ids=[x['id'] for x in ledger['items']];open_ids={x['id'] for x in ledger['items'] if x['status']=='open'}
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'canonicalRecords':len(findings['items']),'ledgerRecords':len(ids),'idsUnique':len(ids)==len(set(ids)),'idsMatch':set(ids)=={x['id'] for x in findings['items']},'additionalObservations':len(ledger.get('additionalObservations',[])),'remainingOpenRecords':len(open_ids),'remainingDispositionIdsMatch':open_ids=={x['id'] for x in disposition['items']},'goalComplete':False}
json_errors=list(archive.json_errors)
for path in folder.glob('*.json'):
 try:json.loads(path.read_text())
 except Exception:json_errors.append(str(path.relative_to(folder)))
result['jsonParseErrors']=json_errors
result['currentOpenLedgerHashMatches']=disposition['currentOpenSetVerification']['ledgerSha256']==digest(folder/'implementation-ledger.json')
missing=[];link_count=0
for path in folder.glob('*.md'):
 for match in re.finditer(r'!?\[[^\]\n]*\]\((<[^>]+>|[^)\n]+)\)',path.read_text()):
  link=match.group(1).strip('<>');link=link.split(' "',1)[0]
  if re.match(r'^[a-zA-Z][\w+.-]*:',link) or link.startswith('#'):continue
  target=urllib.parse.unquote(link.split('#',1)[0].split('?',1)[0]);target=re.sub(r':\d+$','',target)
  if not target:continue
  link_count+=1
  destination=(path.parent/target).resolve()
  name=evidence_name(destination)
  if not destination.exists() and name not in archive.hashes and name not in archive.directories:
   missing.append({'report':path.name,'target':target})
result.update(localReportLinksChecked=link_count,missingLocalReportLinks=missing)
pins=[]
artifact_pins=[]
for item in disposition['items']:
 for name,value in item.get('currentSourcePins',{}).items():pins.append((root/name,value,'disposition:'+item['id']))
result['dispositionSourcePinsChecked']=len(pins)
current_reports=['implementation-reading-context.json','implementation-material-diagnostics.json','implementation-notification-preferences.json','implementation-work-summaries.json','implementation-profile-genres.json','implementation-avatar-lifetime.json','task-history-lane-seek.json','implementation-activity-feed.json','implementation-detail-hydration.json','implementation-recommendation-scoring.json','implementation-demand-materialization.json','implementation-continuation-admission.json','implementation-interest-fallback.json','implementation-planning-admission.json','implementation-music-snapshot-binding.json','next-catalogue-feature-parameter.json','implementation-reading-feature-binding.json','implementation-ancestor-aggregation.json','implementation-menu-material.json','task-history-q1-current-index.json','task-history-q1b-current-index.json','task-history-index-matrix.json','next-detail-section-demand.json','evidence/detail-section-demand-panel-promotion.json','task-timing-index-consumers.json','library-append-reset.json','scoped-activity-attribution.json','numbered-page-attribution.json','collection-insights-admission.json','implementation-navigation.json','next-scoped-activity-admission.json','implementation-api-http-errors.json','implementation-toast.json','migration-provenance.json','implementation-toast-main.json','next-scoped-activity-workset.json','implementation-scoped-activity-workset.json','library-append-trace.json','next-activity-reasons-materialization.json','implementation-toast-commit.json','detail-close-baseline.json','activity-reasons-broader-verification.json','activity-reasons-unconditional.json','activity-reasons-selective.json','detail-close-candidate.json','implementation-detail-close.json','library-range-candidate.json','task-writer-cost-plan.json','task-writer-cost-actual.json','public-edges-materialization.json','public-edges-multiset-pilot.json','public-edges-resource-verification.json','implementation-public-seed.json','implementation-library-membership.json','library-server-range.json','follow-up-roadmap.json','implementation-handoff.json','implementation-found-01.json','implementation-found-02.json','implementation-found-03.json','implementation-found-04.json','implementation-found-05.json','implementation-found-06.json','implementation-found-07.json','implementation-found-08.json','implementation-found-09.json','implementation-found-10.json','implementation-found-11.json','avatar-storage-candidate.json','implementation-found-12.json','implementation-found-13.json','taste-query-measurement.json','implementation-found-14.json','implementation-found-15.json','implementation-found-16.json','implementation-found-17.json','implementation-found-18.json','implementation-found-19.json','implementation-found-20.json','implementation-found-21.json','implementation-found-22.json','implementation-found-23.json','implementation-found-24.json','implementation-found-25.json','implementation-found-26.json','final-original-comparison.json','implementation-found-27.json','housekeeping-closeout.json']
for name in current_reports:
 report=json.loads(evidence_bytes(name));current_pins=report.get('sourcePins',report.get('sourceAfter',{}))
 assert isinstance(current_pins,dict) and current_pins, 'Missing current source pins: '+name
 for path,value in current_pins.items():pins.append((root/path,value,name))
 for key in ('coverageSourcePins','writerSourcePins','additionalInventorySourcePins'):
  values=report.get(key,{})
  assert isinstance(values,dict), 'Additional current source pins require a path/hash map: '+name
  for path,value in values.items():pins.append((root/path,value,name+':'+key))
 for key in ('artifactPins','evidencePins'):
  values=report.get(key,{})
  assert isinstance(values,dict), 'Artifact pins require a path/hash map: '+name
  for path,value in values.items():artifact_pins.append((folder/path,value,name+':'+key))
 for artifact in report.get('artifacts',[]) if isinstance(report.get('artifacts',[]),list) else []:
  if isinstance(artifact,dict) and 'path' in artifact and 'sha256' in artifact:
   assert isinstance(artifact['path'],str) and isinstance(artifact['sha256'],str), 'Artifact paths and hashes must be strings: '+name
   artifact_pins.append((folder/artifact['path'],artifact['sha256'],name+':artifacts'))
plugin=json.loads((folder/'implementation-plugin-crop.json').read_text())
for name,value in plugin['sourceHashes'].items():pins.append((root.parent/'coast-plugin'/name,value,'implementation-plugin-crop.json'))
companion=root.parent/'coast-plugin'
companion_available=(companion/'.git').exists()
runtime_pins=json.loads((folder/'historical-runtime-pins.json').read_text())
archive_digests=set(archive.hashes.values())

def source_location(path):
 path=path.resolve()
 if path.is_relative_to(root):return root,path.relative_to(root).as_posix()
 if 'coast-plugin' in path.parts:
  return companion,pathlib.Path(*path.parts[path.parts.index('coast-plugin')+1:]).as_posix()
 return path.parent,path.name

source_records=[(*source_location(path),value,label) for path,value,label in pins]
application_history=history_matches(root,(
 (path,value) for repo,path,value,_ in source_records if repo==root and value not in archive_digests
))
companion_history=history_matches(companion,(
 (path,value) for repo,path,value,_ in source_records if repo==companion
)) if companion_available else set()

mismatches=[];environment_unavailable=[];companion_unavailable=[]
history_count=archive_count=local_count=0
for repo,path,value,label in source_records:
 item={'report':label,'path':path if repo==root else f'{repo.name}/{path}','sha256':value}
 if (repo==root and (path,value) in application_history) or (repo==companion and (path,value) in companion_history):
  history_count+=1
 elif value in archive_digests:
  archive_count+=1
 elif repo==root and runtime_pins.get(path)==value:
  local=repo/path
  if local.is_file() and digest(local)==value:local_count+=1
  else:environment_unavailable.append(item)
 elif repo==companion and not companion_available:
  companion_unavailable.append(item)
 else:
  mismatches.append(item)
result.update(historicalSourcePinsChecked=len(pins),sourcePinsVerifiedInGit=history_count,
 sourcePinsVerifiedInArchive=archive_count,sourcePinsVerifiedInLocalRuntime=local_count,
 historicalRuntimePinsUnavailable=environment_unavailable,companionPinsUnavailable=companion_unavailable,
 sourcePinMismatches=mismatches)

public_projections=[];private_omissions=[]
def artifact_matches(path,value,label):
 name=evidence_name(path.resolve())
 if name is None:return False
 actual=archive.hashes.get(name)
 if actual is None and path.is_file():actual=digest(path)
 if actual==value:return True
 projection=publication.get('projections',{}).get(name)
 if projection and projection.get('originalSha256')==value and actual==projection.get('publishedSha256'):
  public_projections.append({'report':label,'path':name});return True
 omission=publication.get('withheld',{}).get(name)
 if omission and omission.get('originalSha256')==value and name not in archive.hashes:
  private_omissions.append({'report':label,'path':name});return True
 return False

unmatched_artifacts=[(path.resolve(),value,label) for path,value,label in artifact_pins if not artifact_matches(path,value,label)]
artifact_history=history_matches(root,(
 (path.relative_to(root).as_posix(),value) for path,value,_ in unmatched_artifacts if path.is_relative_to(folder)
))
artifact_mismatches=[{'report':label,'path':str(path),'sha256':value}
 for path,value,label in unmatched_artifacts if not path.is_relative_to(folder) or (path.relative_to(root).as_posix(),value) not in artifact_history]
result['publicProjectionArtifactsChecked']=public_projections
result['declaredPrivateArtifactsNotByteVerified']=private_omissions
result['artifactPinsVerifiedInGit']=len(unmatched_artifacts)-len(artifact_mismatches)
result.update(historicalArtifactPinsChecked=len(artifact_pins),artifactPinMismatches=artifact_mismatches)
render_check=subprocess.run(['python3',str(folder/'render-remaining-work.py'),'--check'],cwd=root,capture_output=True)
result['remainingMarkdownMatches']=render_check.returncode==0
ledger_rows={match.group(1):match.group(2) for match in re.finditer(r'^\| ([A-Z][A-Z0-9-]+) \| ([^|]+?) \| (?:yes|no) \|', (folder/'implementation-ledger.md').read_text(),re.M)}
result['ledgerMarkdownStatusesMatch']=ledger_rows=={row['id']:row['status'] for row in ledger['items']}
# Verify adoptions against the publication commit. Later runtime changes have
# their own receipts, so live source is checked by the current audit register.
publication_commit='f7a3e3f71f1241a967106d5c6615726e965c3a5b'

def published_source(name):
 item=subprocess.run(['git','show',f'{publication_commit}:{name}'],cwd=root,capture_output=True)
 return item.stdout if item.returncode==0 else None

def adoption(manifest,patch,repairs=None):
 sources={};mismatched=[];repair_checks={}
 for name,entry in manifest.items():
  current=published_source(name)
  expected=entry['candidateSha256']
  if repairs and name in repairs:
   repair=repairs[name]
   before=evidence_bytes(repair['beforeRef'])
   later_patch=evidence_bytes(repair['patchRef'])
   diff=''.join(difflib.unified_diff(
    before.decode().splitlines(True),current.decode().splitlines(True),
    fromfile='a/'+name,tofile='b/'+name)) if current is not None else ''
   repair_checks[name]=bool(diff) and diff.encode() in later_patch and (
    hashlib.sha256(later_patch).hexdigest()==repair['patchSha256'] and
    hashlib.sha256(before).hexdigest()==repair['beforeSha256']==expected and
    hashlib.sha256(current).hexdigest()==repair['afterSha256'])
   current=before
  actual=hashlib.sha256(current).hexdigest() if current is not None else None
  if actual!=expected:mismatched.append(name)
  elif current is not None:sources[name]=current
 if mismatched:return mismatched,repair_checks,False
 with tempfile.TemporaryDirectory(prefix='coast-audit-epoch-') as temporary:
  epoch=pathlib.Path(temporary)
  for name,content in sources.items():
   destination=epoch/name
   if not destination.resolve().is_relative_to(epoch.resolve()):
    raise ValueError(f'Invalid adoption source path {name!r}')
   destination.parent.mkdir(parents=True,exist_ok=True)
   destination.write_bytes(content)
  reverse=subprocess.run(['git','apply','--reverse','--check','-'],input=patch,cwd=epoch,capture_output=True)
 return mismatched,repair_checks,reverse.returncode==0

toast_patch=evidence_bytes(toast['reviewPatch'])
toast_manifest=evidence_bytes('evidence/implementation-toast-source-manifest.json')
manifest=json.loads(toast_manifest)
toast_paths,repair_checks,toast_reverse=adoption(manifest,toast_patch,toast_repairs)
result['candidatePatchSha256']=hashlib.sha256(toast_patch).hexdigest()
result['candidatePatchHashMatches']=result['candidatePatchSha256']==toast['patchSha256']
result['toastAdoptionManifestHashMatches']=hashlib.sha256(toast_manifest).hexdigest()=='fe546c4abb0fa126daa9cf49b16bba8dc388ba567d77ffa5bff622e02102b6ab'
result['toastAdoptedFilesChecked']=len(manifest)
result['toastLaterOwnerRepairChecks']=repair_checks
result['toastAdoptedFileMismatches']=toast_paths
result['toastAdoptionEpochPatchReverseCheck']=toast_reverse
rollout=json.loads(evidence_bytes('evidence/implementation-approved-normal-rollout.json'))
result['toastRolloutReceiptMatches']=rollout.get('sourceApplied') is True and rollout.get('adoptedFiles')==14 and rollout.get('patchSha256')==toast['patchSha256'] and rollout.get('migrationExecutor',{}).get('normalExecutionPerformed') is True
patch_state_ok=all([toast.get('normalApplicationSourceApplied') is True,result['toastAdoptionManifestHashMatches'],len(manifest)==14,
 not toast_paths,repair_checks.keys()==toast_repairs.keys(),all(repair_checks.values()),toast_reverse,result['toastRolloutReceiptMatches']])

avatar=json.loads((folder/'implementation-found-16.json').read_text())
avatar_manifest_bytes=evidence_bytes('candidates/avatar-storage/adoption-manifest.json')
avatar_manifest=json.loads(avatar_manifest_bytes)
avatar_patch=evidence_bytes('candidates/avatar-storage/adoption.patch')
avatar_paths,_,avatar_reverse=adoption(avatar_manifest['files'],avatar_patch)
result['avatarAdoptionManifestHashMatches']=hashlib.sha256(avatar_manifest_bytes).hexdigest()=='b81bf80b59cde94f83f53d28d83c7f77f954ba6fc0eb232fca85941a0cc05432'
result['avatarAdoptedFilesChecked']=len(avatar_manifest['files'])
result['avatarAdoptedFileMismatches']=avatar_paths
result['avatarPatchHashMatches']=hashlib.sha256(avatar_patch).hexdigest()==avatar_manifest['patchSha256']==avatar['approvedPatchSha256']
result['avatarAdoptionEpochPatchReverseCheck']=avatar_reverse
avatar_rollout=json.loads(evidence_bytes('evidence/implementation-approved-avatar-0064-normal.json'))
executor=avatar_rollout.get('executor',{})
result['avatarNormalRolloutReceiptMatches']=all([avatar_rollout.get('sourceApplied') is True,avatar_rollout.get('normalServerListenerVerified') is True,executor.get('conversionApply',{}).get('converted')==3,executor.get('conversionRepeat',{}).get('checked')==0,executor.get('verification',{}).get('exactImageBytes')==3,executor.get('verification',{}).get('allOtherSettingsPreserved') is True,executor.get('migration',{}).get('ledgerAfter')==65,executor.get('migration',{}).get('exactFunctionBodies')==3,executor.get('migration',{}).get('exactTransitionTrigger') is True])
avatar_state_ok=all([avatar.get('normalApplicationSourceApplied') is True,result['avatarAdoptionManifestHashMatches'],
 result['avatarAdoptedFilesChecked']==10,not avatar_paths,result['avatarPatchHashMatches'],avatar_reverse,result['avatarNormalRolloutReceiptMatches']])
# The closeout is method execution, never promotion of missing runtime acceptance.
closeout=json.loads((folder/'housekeeping-closeout.json').read_text())
future=json.loads((folder/'next-investigation-checklist.json').read_text())
actual_counts={'canonical':len(ledger['items']),'sourceApplied':sum(row['implementationApplied'] for row in ledger['items']),'implemented':sum(row['status'].startswith('implemented') for row in ledger['items']),'partial':sum(row['status'].startswith('partial') for row in ledger['items']),'open':len(open_ids)}
actual_counts['other']=actual_counts['canonical']-actual_counts['implemented']-actual_counts['partial']-actual_counts['open']
result['housekeepingCountsMatch']=closeout['canonicalCounts']==future['counts']==actual_counts
result['housekeepingMethodBoundaryMatches']=closeout['readyUntriedPrescribedMethods']==0 and closeout['currentExecutionPassComplete'] is True and closeout['wholeAuditComplete'] is False and future['automaticContinuation'] is False
result['futureChecklistIdsUnique']=len({row['id'] for row in future['areas']})==len(future['areas'])==9 and len({row['id'] for row in future['newIssues']})==len(future['newIssues'])==3
result['futureDesignDeferralsPreserved']={row['id'] for row in future['deferredDesigns'] if row['status']=='user-deferred'}=={'PR-02','PJ-15'}
result['currentSummaryCountsMatch']=all(json.loads((folder/name).read_text())['currentSummaryCounts']==actual_counts for name in ['implementation-handoff.json','implementation-queue.json','follow-up-roadmap.json']) and disposition['count']==len(open_ids)
result['publicationArchiveHashMatches']=archive_hash_matches and len(archive.hashes)==publication['members']
checks=[result['currentOpenLedgerHashMatches'],result['idsUnique'],result['idsMatch'],result['remainingDispositionIdsMatch'],not json_errors,not missing,not mismatches,not artifact_mismatches,result['remainingMarkdownMatches'],result['ledgerMarkdownStatusesMatch'],result['candidatePatchHashMatches'],patch_state_ok,avatar_state_ok]
checks.extend([result['housekeepingCountsMatch'],result['housekeepingMethodBoundaryMatches'],result['futureChecklistIdsUnique'],result['futureDesignDeferralsPreserved'],result['currentSummaryCountsMatch'],result['publicationArchiveHashMatches']])
result['passed']=all(checks)
if args.output:args.output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2));raise SystemExit(0 if result['passed'] else 1)
