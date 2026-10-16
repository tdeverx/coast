import { expect, test } from 'bun:test';
import { mediaOverviewPanels, mediaActivityPanels } from '../src/lib/ui/insights/media';
import { profileBreakdownPanels } from '../src/lib/ui/insights/profile';
import { communityPanels } from '../src/lib/ui/insights/community';
import { barModel, targetModel } from '../src/lib/ui/charts/insights';
import type { MediaView } from '../src/lib/ui/types';
const media = (patch: Partial<MediaView> = {}): MediaView => ({
  id: 'show', kind:'show', title:'A show', available:false,progress:0,duration:0,watched:false,
  playCount:0,watchlist:false,favourite:false,collected:false,dropped:false,rating:null,...patch,
});
test('member state determines completion, availability and season links without counting partial plays as watches',()=>{
  const panels=mediaOverviewPanels(media({totalEpisodes:20,completedEpisodes:20}),[
    media({id:'one',kind:'episode',watched:true,available:true,runtimeMinutes:30}),
    media({id:'two',kind:'episode',progress:20,available:true,runtimeMinutes:30}),
    media({id:'three',kind:'episode',runtimeMinutes:30}),
  ],[media({id:'season',kind:'season',completedEpisodes:1,totalEpisodes:3})]);
  const content=panels[0].content;
  expect(content.kind).toBe('chart');
  if(content.kind!=='chart')throw Error('Expected completion chart');
  expect(content.model.rows.map(item=>item.value)).toEqual([1,1,1]);
  const metrics=panels[1].content;
  if(metrics.kind!=='metrics')throw Error('Expected metrics');
  expect(metrics.props.items.find(item=>item.label==='In your library')?.value).toBe('2 / 3');
  const seasons=panels[2].content;
  if(seasons.kind!=='chart')throw Error('Expected seasons');
  expect(seasons.model.rows[0]).toMatchObject({value:1,capacity:3,href:'/media/season'});
});
test('undated history stays in totals and disclosure without manufacturing chart dates',()=>{
  const panels=mediaActivityPanels({days:[{date:'2026-09-30',movies:2,episodes:1}],today:'2026-09-30',watches:8,unique:4,undated:5,first:null,last:null},'month');
  const chart=panels[0].content;
  if(chart.kind!=='chart')throw Error('Expected activity chart');
  expect(chart.model.rows.reduce((sum,item)=>sum+(item.value??0),0)).toBe(3);
  expect(panels[0].footerText).toContain('5 undated watches');
  const metrics=panels[1].content;
  if(metrics.kind!=='metrics')throw Error('Expected history totals');
  expect(metrics.props.items.find(item=>item.label==='Recorded watches')?.value).toBe(8);
  expect(metrics.props.items.find(item=>item.label==='First watch')?.value).toBe('—');
});
test('profile filtering keeps half-star ratings and escaped genres; absent provider scores stay absent',()=>{
  const panels=profileBreakdownPanels([{name:'Sci-Fi & Fantasy',count:3,filter:'Sci-Fi & Fantasy'}],[{value:4,count:1},{value:5,count:3}],'year','/profile/example');
  const genres=panels[0].content;
  if(genres.kind!=='chart')throw Error('Expected genres');
  expect(genres.model.rows[0].href).toBe('/profile/example?view=history&period=year&genre=Sci-Fi%20%26%20Fantasy');
  const ratings=panels[1].content;
  if(ratings.kind!=='chart')throw Error('Expected ratings');
  expect(ratings.model.rows.map(item=>item.label)).toEqual(['0.5','1','1.5','2','2.5','3','3.5','4','4.5','5']);
  expect(ratings.model.subtitle).toContain('4.8 / 5');
  expect(ratings.model.rows.at(-1)?.href).toContain('rating=5');
  expect(communityPanels({source:'Trakt',url:'https://trakt.tv',page:1,pages:1,reviews:[],facts:[],crew:[]})).toEqual([]);
});

test('target charts preserve unknown totals, known zero and per-row capacities',()=>{
  const chart=targetModel({label:'Progress',items:[{label:'Unknown',value:3},{label:'Zero',value:0,total:0},{label:'Known',value:4,total:10,href:'/media/example'}]});
  expect(chart.styleId).toBe('11A');
  expect(chart.rows.map(row=>row.capacity)).toEqual([undefined,0,10]);
  expect(chart.rows[2].href).toBe('/media/example');
});
test('chronological bars preserve zero buckets and their native drill-through links',()=>{
  const chart=barModel({label:'Activity',axis:true,items:[{label:'First',value:0,href:'/history?from=1'},{label:'Next',value:2}]});
  expect(chart.styleId).toBe('2B');
  expect(chart.rows.map(row=>row.value)).toEqual([0,2]);
  expect(chart.series[0].values).toEqual([0,2]);
  expect(chart.rows[0].href).toBe('/history?from=1');
});

test('playback chart distinguishes the centre label from the unit of its real values',()=>{
  const content=mediaOverviewPanels(media({kind:'movie',duration:600,progress:120}))[0].content;
  if(content.kind!=='chart')throw Error('Expected playback chart');
  expect(content.model.unit).toBe('minutes');
  expect(content.model.raw.centerLabel).toBe('played');
  expect(content.model.rows.map(row=>row.value)).toEqual([2,8]);
});
