import { expect, test } from 'bun:test';
import { mediaOverviewPanels, mediaActivityPanels } from '../src/lib/ui/insights/media';
import { profileBreakdownPanels } from '../src/lib/ui/insights/profile';
import { communityPanels } from '../src/lib/ui/insights/community';
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
  expect(content.kind).toBe('breakdown');
  if(content.kind!=='breakdown')throw Error('Expected completion chart');
  expect(content.props.items.map(item=>item.value)).toEqual([1,1,1]);
  const metrics=panels[1].content;
  if(metrics.kind!=='metrics')throw Error('Expected metrics');
  expect(metrics.props.items.find(item=>item.label==='In your library')?.value).toBe('2 / 3');
  const seasons=panels[2].content;
  if(seasons.kind!=='progress')throw Error('Expected seasons');
  expect(seasons.props.items[0]).toMatchObject({value:1,total:3,href:'/media/season'});
});
test('undated history stays in totals and disclosure without manufacturing chart dates',()=>{
  const panels=mediaActivityPanels({days:[{date:'2026-09-30',movies:2,episodes:1}],today:'2026-09-30',watches:8,unique:4,undated:5,first:null,last:null},'month');
  const chart=panels[0].content;
  if(chart.kind!=='bar')throw Error('Expected activity chart');
  expect(chart.props.items.reduce((sum,item)=>sum+item.value,0)).toBe(3);
  expect(panels[0].footerText).toContain('5 undated watches');
  const metrics=panels[1].content;
  if(metrics.kind!=='metrics')throw Error('Expected history totals');
  expect(metrics.props.items.find(item=>item.label==='Recorded watches')?.value).toBe(8);
  expect(metrics.props.items.find(item=>item.label==='First watch')?.value).toBe('—');
});
test('profile filtering keeps half-star ratings and escaped genres; absent provider scores stay absent',()=>{
  const panels=profileBreakdownPanels([{name:'Sci-Fi & Fantasy',count:3,filter:'Sci-Fi & Fantasy'}],[{value:4,count:1},{value:5,count:3}],'year','/profile/example');
  const genres=panels[0].content;
  if(genres.kind!=='breakdown')throw Error('Expected genres');
  expect(genres.props.items[0].href).toBe('/profile/example?view=history&period=year&genre=Sci-Fi%20%26%20Fantasy');
  const ratings=panels[1].content;
  if(ratings.kind!=='bar')throw Error('Expected ratings');
  expect(ratings.props.items.map(item=>item.label)).toEqual(['0.5','1','1.5','2','2.5','3','3.5','4','4.5','5']);
  expect(ratings.props.summary).toBe('4.8 / 5');
  expect(ratings.props.items.at(-1)?.href).toContain('rating=5');
  expect(communityPanels({source:'Trakt',url:'https://trakt.tv',page:1,pages:1,reviews:[],facts:[],crew:[]})).toEqual([]);
});
