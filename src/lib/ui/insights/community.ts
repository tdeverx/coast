import type { MediaInsights } from '$lib/media/details';
import type { InsightPanel } from './types';
export function communityPanels(details:MediaInsights):InsightPanel[] {
  const panels:InsightPanel[]=[];
  if(details.rating!==undefined) panels.push({
    title:`${details.source} rating`,description:'Community score',content:{kind:'breakdown',props:{
      label:`${details.source} score out of ten`,centre:details.rating.toFixed(1),unit:'out of 10',showLegend:false,
      items:[{label:'Score',value:details.rating},{label:'Remaining',value:10-details.rating,tone:'var(--line)'}],
    }},footerLink:{href:details.url,external:true,label:`${(details.votes??0).toLocaleString()} votes · View on ${details.source} ↗`},
  });
  if(details.ratingDistribution?.some(r=>r.count>0)) panels.push({
    title:'How viewers rate it',description:`${details.source} · scores out of 10`,content:{kind:'bar',props:{
      label:`${details.source} rating distribution`,items:details.ratingDistribution.map(r=>({label:String(r.value),detail:`${r.value} out of 10`,value:r.count})),
      summary:`${(details.votes??details.ratingDistribution.reduce((sum,r)=>sum+r.count,0)).toLocaleString()} votes`,caption:'Community ratings',axis:true,
    }},
  });
  if(details.metrics?.length) panels.push({title:'Community activity',description:`Across ${details.source}`,content:{kind:'metrics',props:{items:details.metrics}}});
  return panels;
}
