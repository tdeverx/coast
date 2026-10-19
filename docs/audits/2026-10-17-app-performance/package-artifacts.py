#!/usr/bin/env python3
"""Package audit proof for public review; retain private originals outside Git."""
from pathlib import Path
import gzip,hashlib,io,json,re,tarfile
base=Path(__file__).resolve().parent
archive=base/'verification-artifacts.tar.gz'
manifest_path=base/'artifact-publication.json'
directories=['candidates','evidence','probes','proof','DATA07screen-noop','history']
sha=lambda b:hashlib.sha256(b).hexdigest()
canonical=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
previous=json.loads(manifest_path.read_text())if manifest_path.exists()else{}
projections={k:v for k,v in previous.get('projections',{}).items()if not any(k.startswith(d+'/')for d in directories)}
withheld=dict(previous.get('withheld',{}));members=[];source_bytes=0
for directory in directories:
 for path in sorted((base/directory).rglob('*')):
  if not path.is_file():continue
  if path.is_symlink():raise RuntimeError('Do not package symlink: '+str(path))
  name=str(path.relative_to(base));data=path.read_bytes();source_bytes+=len(data)
  if path.suffix.lower()in ['.png','.jpg','.jpeg','.gif','.webp']:
   withheld[name]={'originalSha256':sha(data),'bytes':len(data),'reason':'Private actual-account/catalogue/content verification image; retained locally, not published.'};continue
  redactions=[]
  old_projection=previous.get('projections',{}).get(name)
  if old_projection and sha(data)==old_projection['publishedSha256']:
   projections[name]=old_projection;members.append((name,data,path.stat().st_mode&0o777));continue
  if name=='candidates/admin-continue-undo/actual.json':
   body=json.loads(data)
   for index,comparison in enumerate(body['comparisons']):
    for variant in ['default','current']:
     for field in ['removedQueue','beforeQueue','afterRemoveQueue','afterRepeatQueue','finalQueue','finalState','finalRewatches']:
      value=comparison[variant][field]
      if not value:continue
      value_bytes=canonical(value);summary={'publicationRedacted':True,'orderedCanonicalSha256':sha(value_bytes),'rows':len(value),'bytes':len(value_bytes)}
      comparison[variant][field]=summary;redactions.append({'path':f'$.comparisons[{index}].{variant}.{field}',**summary})
   assert len(redactions)==56,'Re-review changed personal-state receipt before publication'
  elif name in ['candidates/admin-party-liveness/actual.json','candidates/admin-party-liveness/second-attempt-admin-only.json']:
   body=json.loads(data)
   for index,scenario in enumerate(body['scenarios']):
    for pair_index,pair in enumerate(scenario['pair']):
     response=pair.get('response',{});value=response.get('participants')if isinstance(response,dict)else None
     if not value:continue
     value_bytes=canonical(value);summary={'publicationRedacted':True,'orderedCanonicalSha256':sha(value_bytes),'rows':len(value),'bytes':len(value_bytes)}
     response['participants']=summary;redactions.append({'path':f'$.scenarios[{index}].pair[{pair_index}].response.participants',**summary})
  if redactions:
   original=data;body['publicationBoundary']='Public derivative: named actual personal state replaced with ordered canonical hashes/counts. Original complete receipt retained privately; checks/metrics remain original observations.';body['originalReceiptSha256']=sha(original);data=(json.dumps(body,indent=2)+'\n').encode();projections[name]={'originalSha256':sha(original),'publishedSha256':sha(data),'originalBytes':len(original),'publishedBytes':len(data),'redactions':redactions}
  members.append((name,data,path.stat().st_mode&0o777))
with archive.open('wb')as raw,gzip.GzipFile(filename='',mode='wb',fileobj=raw,mtime=0,compresslevel=6)as zipped,tarfile.open(fileobj=zipped,mode='w')as tar:
 for name,data,mode in members:
  info=tarfile.TarInfo(name);info.size=len(data);info.mtime=0;info.mode=mode;info.uid=info.gid=0;info.uname=info.gname='';tar.addfile(info,io.BytesIO(data))
manifest={'schemaVersion':1,'scope':'Lossless archived protocol/source/numerical evidence except explicit public derivatives and withheld private verification images. Original private payloads/images remain local and must not be committed.','archive':archive.name,'archiveSha256':sha(archive.read_bytes()),'archiveBytes':archive.stat().st_size,'members':len(members),'unpackedSourceBytes':source_bytes,'projections':projections,'withheld':withheld,'extract':'tar -xzf docs/audits/2026-10-17-app-performance/verification-artifacts.tar.gz -C docs/audits/2026-10-17-app-performance','verificationBoundary':'Public projection checks verify published bytes against this manifest; they do not assert possession or re-execution of private originals. Native result assertions stay at their recorded epochs.'}
manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'members':len(members),'archiveBytes':manifest['archiveBytes'],'privateImagesWithheld':len(withheld),'projectedReceipts':len(projections)}))
