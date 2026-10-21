import {expect,test} from 'bun:test';
import * as v from 'valibot';
import {progressExperimentSchema,progressExperimentTabs} from '../src/lib/progress-experiment';
import {mixedCardStyle,cardAspectRatio} from '../src/lib/ui/mixed-card';
import {planEpisodeContinuations} from '../src/lib/server/queries/continuations';
import {sectionTarget} from '../src/lib/ui/section-target';

test('mixed Progress uses semantic shapes and keeps explicit artwork choices',()=>{
  const style={shape:'poster' as const,artworkStyle:'auto' as const,overlay:'none' as const};
  const defaults={shape:null,artworkStyle:null};
  expect(mixedCardStyle('episode',style,defaults)).toMatchObject({shape:'fanart',artworkStyle:'thumb'});
  for(const kind of ['movie','show','season','game','book','comic'])expect(mixedCardStyle(kind,style,defaults).shape).toBe('poster');
  for(const kind of ['album','track'])expect(mixedCardStyle(kind,style,defaults).shape).toBe('square');
  expect(mixedCardStyle('episode',style,{shape:'square',artworkStyle:'primary'})).toMatchObject({shape:'square',artworkStyle:'primary'});
  expect(cardAspectRatio('poster')*1.5).toBe(1);
  expect(cardAspectRatio('fanart')*9/16).toBe(1);
});
test('Next can target the first episode of exactly the next untouched season',()=>{
  const entries=[1,2,3].flatMap(season=>[1,2].map(number=>({id:`s${season}e${number}`,groupId:'show',seasonId:`s${season}`,seasonNumber:season,watched:season===1,progress:0,duration:100,dropped:false,available:true})));
  expect(planEpisodeContinuations(entries,false,true)).toEqual({nextIds:[],newSeasonIds:['s2e1']});
  const started=entries.map(item=>({...item,watched:item.watched||item.id==='s2e1'}));
  expect(planEpisodeContinuations(started,false,true)).toEqual({nextIds:['s2e2'],newSeasonIds:[]});
});
test('mixed destinations preserve segment/filter selections and reject invalid filters',()=>{
  const url=new URL('https://coast.test/for-you');
  expect(sectionTarget('/progress-experiment?view=favourites&kind=book&scope=available',url)).toMatchObject({source:{type:'progress-experiment',filters:{view:'favourites',kind:'book',scope:'available'}}});
  expect(sectionTarget('/progress-experiment?view=later',url)).toBeNull();
  expect(sectionTarget('/progress-experiment?view=finished&kind=comic&username=another-user',url)).toMatchObject({source:{type:'progress-experiment',username:'another-user',filters:{view:'finished',kind:'comic'}}});
  expect(v.safeParse(progressExperimentSchema,{view:'dropped'}).success).toBe(true);
  expect(v.safeParse(progressExperimentSchema,{view:'watchlist',page:0}).success).toBe(false);
  expect(progressExperimentTabs.find(tab=>tab.value==='watchlist')?.label).toBe('Later');
  for(const kind of ['album','track'])expect(v.safeParse(progressExperimentSchema,{kind}).success).toBe(false);
});
