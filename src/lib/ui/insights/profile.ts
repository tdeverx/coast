import type { ActivityDay } from '$lib/profile/activity';
import { periodLabel, type ProfilePeriod } from '$lib/profile/period';
import { activityChart } from '../charts/activity';
import type { InsightPanel } from './types';
export function profileActivityPanels(days: ActivityDay[], today: string, period: ProfilePeriod, profileUrl = '/profile'): InsightPanel[] {
  const totals = days.reduce((sum,day)=>({movies:sum.movies+day.movies,episodes:sum.episodes+day.episodes}),{movies:0,episodes:0});
  return [
    {title:'Watching activity',content:{kind:'bar',props:activityChart(days,today,period,
      (from,to)=>`${profileUrl}?view=history&period=${period}&from=${from}&to=${to}`)},
      footerText:'Select a bar to view its watches. Dates use UTC.'},
    {title:'Watching mix',description:'Recorded watches, including rewatches',content:{kind:'breakdown',props:{label:'Watching mix',unit:'watches',items:[
      {label:'Movies',value:totals.movies,href:`${profileUrl}?view=history&period=${period}&type=movie`},
      {label:'Episodes',value:totals.episodes,href:`${profileUrl}?view=history&period=${period}&type=episode`},
    ]}},footerText:'Based on dated history in this period. Imported history without a date is excluded.'},
  ];
}
export function profileBreakdownPanels(genres:{name:string;count:number;filter:string}[], ratings:{value:number;count:number}[], period:ProfilePeriod,profileUrl='/profile'):InsightPanel[] {
  const ratingCount=ratings.reduce((sum,r)=>sum+r.count,0);
  const average=ratingCount?ratings.reduce((sum,r)=>sum+r.value*r.count,0)/ratingCount:0;
  return [
    {title:'Most-watched genres',description:periodLabel(period),content:{kind:'breakdown',props:{label:'Watched genres',unit:'genre credits',
      items:genres.map(g=>({label:g.name,value:g.count,href:`${profileUrl}?view=history&period=${period}&genre=${encodeURIComponent(g.filter)}`}))}},
      footerText:'Titles can count in more than one genre. Select a genre to explore its titles.'},
    {title:'Your ratings',description:periodLabel(period),content:{kind:'bar',props:{label:'Your rating distribution',
      items:Array.from({length:10},(_,i)=>{const value=(i+1)/2;return {label:String(value),detail:`${value} stars`,value:ratings.find(r=>r.value===value)?.count??0,
        href:`${profileUrl}?view=ratings&period=${period}&rating=${value}`};}),
      summary:ratingCount?`${average.toFixed(1)} / 5`:'No ratings yet',caption:`${ratingCount} rated titles`,axis:true,empty:'Rate a title to start your rating chart.'}}},
  ];
}
