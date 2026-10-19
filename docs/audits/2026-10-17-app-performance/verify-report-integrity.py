#!/usr/bin/env python3
"""Check current audit bookkeeping; never promote an acceptance status."""
import argparse,datetime,difflib,hashlib,json,pathlib,re,shutil,subprocess,tempfile,urllib.parse
folder=pathlib.Path(__file__).resolve().parent
root=folder.parents[2]
parser=argparse.ArgumentParser();parser.add_argument('--output',type=pathlib.Path);args=parser.parse_args()
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
publication_path=folder/'artifact-publication.json'
publication=json.loads(publication_path.read_text()) if publication_path.exists() else {'projections':{},'withheld':{}}
ledger=json.loads((folder/'implementation-ledger.json').read_text());findings=json.loads((folder/'findings.json').read_text());disposition=json.loads((folder/'remaining-work-disposition.json').read_text())
ids=[x['id'] for x in ledger['items']];open_ids={x['id'] for x in ledger['items'] if x['status']=='open'}
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'canonicalRecords':len(findings['items']),'ledgerRecords':len(ids),'idsUnique':len(ids)==len(set(ids)),'idsMatch':set(ids)=={x['id'] for x in findings['items']},'additionalObservations':len(ledger.get('additionalObservations',[])),'remainingOpenRecords':len(open_ids),'remainingDispositionIdsMatch':open_ids=={x['id'] for x in disposition['items']},'goalComplete':False}
json_errors=[]
for path in folder.rglob('*.json'):
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
  if not (path.parent/target).exists():missing.append({'report':path.name,'target':target})
result.update(localReportLinksChecked=link_count,missingLocalReportLinks=missing)
pins=[]
artifact_pins=[]
for item in disposition['items']:
 for name,value in item.get('currentSourcePins',{}).items():pins.append((root/name,value,'disposition:'+item['id']))
result['dispositionSourcePinsChecked']=len(pins)
current_reports=['implementation-reading-context.json','implementation-material-diagnostics.json','implementation-notification-preferences.json','implementation-work-summaries.json','implementation-profile-genres.json','implementation-avatar-lifetime.json','task-history-lane-seek.json','implementation-activity-feed.json','implementation-detail-hydration.json','implementation-recommendation-scoring.json','implementation-demand-materialization.json','implementation-continuation-admission.json','implementation-interest-fallback.json','implementation-planning-admission.json','implementation-music-snapshot-binding.json','next-catalogue-feature-parameter.json','implementation-reading-feature-binding.json','implementation-ancestor-aggregation.json','implementation-menu-material.json','task-history-q1-current-index.json','task-history-q1b-current-index.json','task-history-index-matrix.json','next-detail-section-demand.json','evidence/detail-section-demand-panel-promotion.json','task-timing-index-consumers.json','library-append-reset.json','scoped-activity-attribution.json','numbered-page-attribution.json','collection-insights-admission.json','implementation-navigation.json','next-scoped-activity-admission.json','implementation-api-http-errors.json','implementation-toast.json','migration-provenance.json','implementation-toast-main.json','next-scoped-activity-workset.json','implementation-scoped-activity-workset.json','library-append-trace.json','next-activity-reasons-materialization.json','implementation-toast-commit.json','detail-close-baseline.json','activity-reasons-broader-verification.json','activity-reasons-unconditional.json','activity-reasons-selective.json','detail-close-candidate.json','implementation-detail-close.json','library-range-candidate.json','task-writer-cost-plan.json','task-writer-cost-actual.json','public-edges-materialization.json','public-edges-multiset-pilot.json','public-edges-resource-verification.json','implementation-public-seed.json','implementation-library-membership.json','library-server-range.json','follow-up-roadmap.json','implementation-handoff.json','implementation-found-01.json','implementation-found-02.json','implementation-found-03.json','implementation-found-04.json','implementation-found-05.json','implementation-found-06.json','implementation-found-07.json','implementation-found-08.json','implementation-found-09.json','implementation-found-10.json','implementation-found-11.json','avatar-storage-candidate.json','implementation-found-12.json','implementation-found-13.json','taste-query-measurement.json','implementation-found-14.json','implementation-found-15.json','implementation-found-16.json','implementation-found-17.json','implementation-found-18.json','implementation-found-19.json','implementation-found-20.json','implementation-found-21.json','implementation-found-22.json','implementation-found-23.json','implementation-found-24.json','implementation-found-25.json','implementation-found-26.json','final-original-comparison.json','implementation-found-27.json','housekeeping-closeout.json']
for name in current_reports:
 report=json.loads((folder/name).read_text());current_pins=report.get('sourcePins',report.get('sourceAfter',{}))
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
mismatches=[{'report':label,'path':str(path.relative_to(root) if path.is_relative_to(root) else path)} for path,value,label in pins if not path.is_file() or digest(path)!=value]
result.update(currentSourcePinsChecked=len(pins),sourcePinMismatches=mismatches)
public_projections=[];private_omissions=[]
def artifact_matches(path,value,label):
 if not path.resolve().is_relative_to(folder.resolve()):return False
 name=str(path.relative_to(folder))
 if path.is_file() and digest(path)==value:return True
 projection=publication.get('projections',{}).get(name)
 if projection and projection.get('originalSha256')==value and path.is_file() and digest(path)==projection.get('publishedSha256'):
  public_projections.append({'report':label,'path':name});return True
 omission=publication.get('withheld',{}).get(name)
 if omission and omission.get('originalSha256')==value and not path.exists():
  private_omissions.append({'report':label,'path':name});return True
 return False
artifact_mismatches=[{'report':label,'path':str(path)} for path,value,label in artifact_pins if not artifact_matches(path,value,label)]
result['publicProjectionArtifactsChecked']=public_projections
result['declaredPrivateArtifactsNotByteVerified']=private_omissions

result.update(currentArtifactPinsChecked=len(artifact_pins),artifactPinMismatches=artifact_mismatches)
render_check=subprocess.run(['python3',str(folder/'render-remaining-work.py'),'--check'],cwd=root,capture_output=True)
result['remainingMarkdownMatches']=render_check.returncode==0
ledger_rows={match.group(1):match.group(2) for match in re.finditer(r'^\| ([A-Z][A-Z0-9-]+) \| ([^|]+?) \| (?:yes|no) \|', (folder/'implementation-ledger.md').read_text(),re.M)}
result['ledgerMarkdownStatusesMatch']=ledger_rows=={row['id']:row['status'] for row in ledger['items']}
toast=json.loads((folder/'implementation-toast.json').read_text());patch=(folder/toast['reviewPatch']).resolve() if toast.get('reviewPatch') else pathlib.Path(toast['patch'])
result['candidatePatchSha256']=digest(patch) if patch.is_file() else None
result['candidatePatchHashMatches']=result['candidatePatchSha256']==toast['patchSha256']
adopted=toast.get('normalApplicationSourceApplied') is True
result['toastSourceState']='adopted' if adopted else 'staged'
check=subprocess.run(['git','apply','--check',str(patch)],cwd=root,capture_output=True);result['candidatePatchApplyCheck']=check.returncode==0
if adopted:
 manifest_path=folder/'evidence/implementation-toast-source-manifest.json'
 manifest=json.loads(manifest_path.read_text())
 result['toastAdoptionManifestHashMatches']=digest(manifest_path)=='fe546c4abb0fa126daa9cf49b16bba8dc388ba567d77ffa5bff622e02102b6ab'
 result['toastAdoptedFilesChecked']=len(manifest)
 # Later reviewed root fixes may touch an adopted toast owner. Keep the original
 # adoption manifest immutable and verify the exact before/current composition.
 later_repairs=toast.get('laterOwnerRepairs',{})
 repair_checks={}
 for name,repair in later_repairs.items():
  before=(folder/repair['beforeRef']).resolve();later_patch=(folder/repair['patchRef']).resolve();current=root/name
  valid=name in manifest and before.is_relative_to(folder.resolve()) and later_patch.is_relative_to(folder.resolve()) and before.is_file() and later_patch.is_file() and current.is_file()
  if valid:
   exact=''.join(difflib.unified_diff(before.read_text().splitlines(True),current.read_text().splitlines(True),fromfile='a/'+name,tofile='b/'+name))
   valid=bool(exact) and exact in later_patch.read_text() and digest(before)==repair['beforeSha256']==manifest[name]['candidateSha256'] and digest(current)==repair['afterSha256'] and digest(later_patch)==repair['patchSha256']
   if valid:valid=subprocess.run(['git','apply','--reverse','--check',str(later_patch)],cwd=root,capture_output=True).returncode==0
  repair_checks[name]=valid
 result['toastLaterOwnerRepairChecks']=repair_checks
 result['toastAdoptedFileMismatches']=[name for name,value in manifest.items() if not (root/name).is_file() or digest(root/name)!=value['candidateSha256'] and not repair_checks.get(name,False)]
 reverse=subprocess.run(['git','apply','--reverse','--check',str(patch)],cwd=root,capture_output=True)
 result['toastAdoptedPatchReverseCheck']=reverse.returncode==0
 # A later append can change an original hunk's surrounding journal context.
 # Validate the immutable adoption patch on its exact manifest epoch, while
 # independently requiring every later repair to compose into current source.
 with tempfile.TemporaryDirectory(prefix='coast-toast-adoption-epoch-') as temporary:
  epoch=pathlib.Path(temporary);epoch_files=True
  for name,value in manifest.items():
   current=root/name
   if current.is_file() and digest(current)==value['candidateSha256']:source=current
   elif repair_checks.get(name,False):source=folder/later_repairs[name]['beforeRef']
   else:epoch_files=False;break
   if digest(source)!=value['candidateSha256']:epoch_files=False;break
   destination=epoch/name;destination.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,destination)
  epoch_reverse=subprocess.run(['git','apply','--reverse','--check',str(patch)],cwd=epoch,capture_output=True) if epoch_files else None
  result['toastAdoptionEpochFilesMatch']=epoch_files
  result['toastAdoptionEpochPatchReverseCheck']=bool(epoch_reverse and epoch_reverse.returncode==0)
 rollout=json.loads((folder/'evidence/implementation-approved-normal-rollout.json').read_text())
 result['toastRolloutReceiptMatches']=rollout.get('sourceApplied') is True and rollout.get('adoptedFiles')==14 and rollout.get('patchSha256')==toast['patchSha256'] and rollout.get('migrationExecutor',{}).get('normalExecutionPerformed') is True
 patch_state_ok=all([result['toastAdoptionManifestHashMatches'],len(manifest)==14,not result['toastAdoptedFileMismatches'],all(repair_checks.values()),result['toastAdoptionEpochFilesMatch'],result['toastAdoptionEpochPatchReverseCheck'],result['toastRolloutReceiptMatches']])
else:patch_state_ok=result['candidatePatchApplyCheck']
avatar=json.loads((folder/'implementation-found-16.json').read_text())
avatar_state_ok=False
if avatar.get('normalApplicationSourceApplied') is True:
 avatar_manifest_path=folder/'candidates/avatar-storage/adoption-manifest.json'
 avatar_manifest=json.loads(avatar_manifest_path.read_text())
 avatar_patch=folder/'candidates/avatar-storage/adoption.patch'
 # Freeze the reviewed adoption, including the removed GIF-only owner. This is
 # independent of historical candidate receipts and of general current pins.
 result['avatarAdoptionManifestHashMatches']=digest(avatar_manifest_path)=='b81bf80b59cde94f83f53d28d83c7f77f954ba6fc0eb232fca85941a0cc05432'
 result['avatarAdoptedFilesChecked']=len(avatar_manifest['files'])
 result['avatarAdoptedFileMismatches']=[name for name,value in avatar_manifest['files'].items() if ((root/name).exists() if value['candidateSha256'] is None else not (root/name).is_file() or digest(root/name)!=value['candidateSha256'])]
 result['avatarPatchHashMatches']=digest(avatar_patch)==avatar_manifest['patchSha256']==avatar['approvedPatchSha256']
 result['avatarPatchReverseCheck']=subprocess.run(['git','apply','--reverse','--check',str(avatar_patch)],cwd=root,capture_output=True).returncode==0
 avatar_rollout=json.loads((folder/'evidence/implementation-approved-avatar-0064-normal.json').read_text())
 executor=avatar_rollout.get('executor',{})
 result['avatarNormalRolloutReceiptMatches']=all([avatar_rollout.get('sourceApplied') is True,avatar_rollout.get('normalServerListenerVerified') is True,executor.get('conversionApply',{}).get('converted')==3,executor.get('conversionRepeat',{}).get('checked')==0,executor.get('verification',{}).get('exactImageBytes')==3,executor.get('verification',{}).get('allOtherSettingsPreserved') is True,executor.get('migration',{}).get('ledgerAfter')==65,executor.get('migration',{}).get('exactFunctionBodies')==3,executor.get('migration',{}).get('exactTransitionTrigger') is True])
 avatar_state_ok=all([result['avatarAdoptionManifestHashMatches'],result['avatarAdoptedFilesChecked']==10,not result['avatarAdoptedFileMismatches'],result['avatarPatchHashMatches'],result['avatarPatchReverseCheck'],result['avatarNormalRolloutReceiptMatches']])
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
result['publicationArchiveHashMatches']=publication_path.exists() and (folder/publication['archive']).is_file() and digest(folder/publication['archive'])==publication['archiveSha256']
checks=[result['currentOpenLedgerHashMatches'],result['idsUnique'],result['idsMatch'],result['remainingDispositionIdsMatch'],not json_errors,not missing,not mismatches,not artifact_mismatches,result['remainingMarkdownMatches'],result['ledgerMarkdownStatusesMatch'],result['candidatePatchHashMatches'],patch_state_ok,avatar_state_ok]
checks.extend([result['housekeepingCountsMatch'],result['housekeepingMethodBoundaryMatches'],result['futureChecklistIdsUnique'],result['futureDesignDeferralsPreserved'],result['currentSummaryCountsMatch'],result['publicationArchiveHashMatches']])
result['passed']=all(checks)
if args.output:args.output.write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2));raise SystemExit(0 if result['passed'] else 1)
