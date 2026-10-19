// Fault delivery is authored; source censuses must be native, credential-free actual DB projections.
import * as v from 'valibot';
import {error} from '@sveltejs/kit';
import {AppError} from '../../src/lib/server/security/errors';
import {musicBrowseSchema} from '../../src/lib/providers/jellyfin/music.server';
import {musicCard} from '../../src/lib/music/presentation';
import {mapConcurrent} from '../../src/lib/server/utils/async';
import {pageNumberSchema,requestedPageInterval} from '../../src/lib/server/queries/pagination';
import {pageInterval} from '../../src/lib/page-window';
type Source={provider:string;enabled:boolean;name:string;connection:{id:string;accountGeneration:string;status:string}|null};
const assert=(value:unknown,code:string)=>{if(!value)throw Error(code);};

/** No fabricated remote response is returned: every provider attempt is an authored rejection. */
export async function actualMusicRangeFailureControls(userId:string,views:Source[][],requireCurrent:(id:string)=>Promise<unknown>,beforeSource:string) {
  assert(views.length>=2,'two_actual_subject_source_views_required');
  const selected=views[0].filter(p=>p.provider==='jellyfin'&&p.enabled&&p.connection?.status==='connected');
  assert(selected.length>0,'actual_connected_music_source_required');
  const current=await Bun.file(new URL('../../src/lib/server/queries/music.ts',import.meta.url)).text();
  async function run(source:string,withdrawPolicy:boolean,finalView:number) {
    let censuses=0,providers=0,fences=0,status:number|undefined;
    const environment={v,error,musicBrowseSchema,musicCard,mapConcurrent,pageNumberSchema,requestedPageInterval,pageInterval,AppError,
      listProviders:async()=>views[censuses++===0?0:finalView],
      musicLibrary:async()=>{providers++;throw Error('authored_provider_transport_failure');},
      requireFeature:async(id:string)=>{fences++;await requireCurrent(id);if(withdrawPolicy)throw new AppError(403,'Authored policy withdrawal.','feature_disabled');},
      logDiagnostic:async()=>{},classifyFailure:()=>({kind:'authored_transport_failure'})};
    const start=source.indexOf('export async function musicBrowseData(');assert(start>=0,'exact_music_owner_source_required');
    const code=new Bun.Transpiler({loader:'ts'}).transformSync(source.slice(start).replace(/^export /,''));
    const read=new Function(...Object.keys(environment),code+';return musicBrowseData;')(...Object.values(environment));
    try{await read(userId,new URL('http://coast/music?kind=album&page=1&firstPage=1'));}
    catch(cause){status=(cause as AppError).status;}
    return {status,censuses,providers,fences};
  }
  const before=await run(beforeSource,true,0);
  assert(before.status===502&&before.fences===0,'historical_range_error_skips_final_policy_fence');
  const transient=await run(current,false,0),policy=await run(current,true,0),source=await run(current,false,1);
  assert(transient.status===502&&transient.fences===1&&transient.censuses===2,'transient_failure_checks_current_policy_and_source_before_retry_error');
  assert(policy.status===403&&policy.fences===1&&policy.censuses===1,'withdrawn_policy_precedes_generic_provider_failure');
  assert(source.status===403&&source.fences===1&&source.censuses===2,'withdrawn_actual_source_view_precedes_generic_provider_failure');
  for(const result of [before,transient,policy,source])assert(result.providers===selected.length,'no_extra_remote_page_admission_after_failure');
  return {before,current:{transient,policy,source},actualConnectedSources:selected.length,
    boundary:'Actual credential-free source projections from two existing subjects; delivery switches and transport/policy failures are authored controls. No fake provider response, fabricated row, DB policy mutation, decryption or live account-withdrawal race. Final source-view replacement is a controlled delivery of another actual subject view, not an observed same-account transition.'};
}
