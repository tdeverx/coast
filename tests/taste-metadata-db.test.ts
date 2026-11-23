import {expect,test} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {childTasteCredits,workTasteFeatures} from '../src/lib/social/work-features.server';
import type {TasteAudienceRating} from '../src/lib/social/taste-rating-model';
import {importReading} from '../src/lib/catalogue/reading.server';
import {OpenLibraryAdapter} from '../src/lib/providers/openlibrary/adapter.server';
import {ComicVineAdapter} from '../src/lib/providers/comic-vine/adapter.server';
import {mapIgdbGame} from '../src/lib/providers/igdb/adapter.server';
import {importIgdbMetadata} from '../src/lib/core/games/service.server';
import {musicItems} from '../src/lib/providers/jellyfin/music.server';
import {persistMusic} from '../src/lib/music/persistence.server';
import {TmdbAdapter} from '../src/lib/providers/tmdb/adapter.server';
import {ingestMetadata} from '../src/lib/catalogue/service.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;

run('a detail refresh replaces newest-season crew with roles verified across the series',async()=>{
 const db=getSql(),externalId='920001';
 const guest={id:11,name:'Guest director',job:'Director'};
 const recurring={id:12,name:'Director and guest writer',jobs:[{job:'Director',episode_count:3},{job:'Teleplay',episode_count:1}]};
 let episodes:number|undefined=12,requests=0;
 const adapter=new TmdbAdapter(async path=>{
  requests++;
  expect(path).toContain('aggregate_credits');
  return {id:Number(externalId),name:'Crew fixture',number_of_episodes:episodes,credits:{cast:[],crew:[guest]},
   created_by:[{id:14,name:'Creator'}],aggregate_credits:{crew:[
    {...guest,jobs:[{job:guest.job,episode_count:1}]},recurring,
    {id:13,name:'Overlapping credits',jobs:[{job:'Writer',episode_count:2},{job:'Writer',episode_count:2}]},
    {id:15,name:'Series writer',jobs:[{job:'Screenplay',episode_count:6}]},
   ]}};
 });
 const refreshed=await adapter.details('show',externalId,false);
 const legacy={id:String(guest.id),name:guest.name,role:guest.job};
 const show=await ingestMetadata({...refreshed,facts:{credits:[legacy]},tasteFeatures:{directors:[{id:'tmdb:11',name:guest.name}]}});
 try{
  await ingestMetadata(refreshed);
  const facts=(await workTasteFeatures([show.id])).get(show.id)!;
  expect(facts.directors).toEqual([{id:'tmdb:12',name:recurring.name}]);
  expect(facts.writers).toEqual([{id:'tmdb:15',name:'Series writer'}]);
  expect(refreshed.facts?.credits).toContainEqual({id:'14',name:'Creator',role:'Creator'});
  episodes=undefined;
  expect((await adapter.details('show',externalId,false)).tasteFeatures?.directors).toBeUndefined();
  episodes=1;
  expect((await adapter.details('show',externalId,false)).tasteFeatures?.directors).toEqual([{id:'tmdb:11',name:guest.name}]);
  expect(requests).toBe(3);
 }finally{await db`delete from media where id=${show.id}`;}
});

run('screen taste uses certification from the requested region and omits unknown ratings',async()=>{
 const db=getSql(),[movie,show,unknown]=Array.from({length:3},()=>crypto.randomUUID());
 try{
  await db`insert into media(id,kind,title) values(${movie},'movie','Movie'),(${show},'show','Show'),(${unknown},'movie','Unknown')`;
  await db`insert into metadata_snapshots(media_id,provider,region,certificate) values
    (${movie},'tmdb','GB',' 15 '),(${movie},'tmdb','US','R'),(${show},'tmdb','GB','12'),
    (${unknown},'tmdb','GB','Not Rated'),(${unknown},'tmdb','US','PG')`;
  const uk=await workTasteFeatures([movie,show,unknown],undefined,undefined,'GB');
  expect(uk.get(movie)?.ageRatings).toEqual([{id:'GB:15',name:'15'}]);
  expect(uk.get(show)?.ageRatings).toEqual([{id:'GB:12',name:'12'}]);
  expect(uk.get(unknown)?.ageRatings).toBeUndefined();
  const us=await workTasteFeatures([movie,show],undefined,undefined,'US');
  expect(us.get(movie)?.ageRatings).toEqual([{id:'US:R',name:'R'}]);
  expect(us.get(show)?.ageRatings).toBeUndefined();
  await db`insert into metadata_overrides(media_id,certificate) values(${movie},'Unrated')`;
  expect((await workTasteFeatures([movie],undefined,undefined,'GB')).get(movie)?.ageRatings).toBeUndefined();
 }finally{await db`delete from media where id in (${movie},${show},${unknown})`;}
});

run('taste maps typed screen credits by provider identity and selects the release decade independently of details',async()=>{
 const db=getSql(),movie=crypto.randomUUID();
 try{
  await db`insert into media(id,kind,title,release_date) values(${movie},'movie','Credit fixture','1985-01-01')`;
  await db`insert into metadata_snapshots(media_id,provider,release_date,genres,raw) values
   (${movie},'jellyfin','2004-01-01',array['Comedy'],'{"facts":{"audience":{"score":7,"scale":10},"credits":[{"id":"1","name":"Character called Director","role":"Director"}]}}'),
   (${movie},'tmdb','1999-01-01',array['Drama'],${{
    cast:[{id:10,name:'With a namesake'},{id:11,name:'With a namesake'},{id:10,name:'With a namesake'}],
    facts:{audience:{score:5,votes:190,scale:10},credits:[
     {id:'20',name:'Screenwriter',role:'Screenplay'},{id:'21',name:'Cinematographer',role:'Director of Photography'},
     {id:'22',name:'Composer',role:'Original Music Composer'},{id:'23',name:'Director',role:'Director'},
     {id:'24',name:'A different job',role:'Assistant Director'},
    ]},
   }}::jsonb)`;
  const policy={details:'local-preferred',release:'tmdb-only',artwork:'local-preferred'} as const;
  const audience=new Map<string,TasteAudienceRating>();
  const result=(await workTasteFeatures([movie],policy,audience)).get(movie)!;
  expect(audience.get(movie)).toEqual({score:5,votes:190,scale:10});
  expect(result.genres).toEqual([{id:'comedy',name:'Comedy'}]);
  expect(result.decades).toEqual([{id:'1990s',name:'1990s'}]);
  expect(result.cast).toEqual([{id:'tmdb:10',name:'With a namesake'},{id:'tmdb:11',name:'With a namesake'}]);
  expect(result.writers).toEqual([{id:'tmdb:20',name:'Screenwriter'}]);
  expect(result.cinematographers).toEqual([{id:'tmdb:21',name:'Cinematographer'}]);
  expect(result.composers).toEqual([{id:'tmdb:22',name:'Composer'}]);
  expect(result.directors).toEqual([{id:'tmdb:23',name:'Director'}]);
  await db`insert into work_features(work_id,provider,features) values(${movie},'tmdb','{"cast":[{"id":"tmdb:10","name":"With a namesake"}]}')`;
  expect((await workTasteFeatures([movie],policy)).get(movie)?.cast).toEqual([{id:'tmdb:10',name:'With a namesake'}]);
  expect((await workTasteFeatures([movie],'local-preferred')).get(movie)?.decades?.[0].id).toBe('2000s');
  await db`insert into metadata_overrides(media_id,release_date,genres) values(${movie},'1970-01-01','{}')`;
  const overridden=(await workTasteFeatures([movie],policy)).get(movie)!;
  expect(overridden.decades?.[0].id).toBe('1970s');
  expect(overridden.genres).toBeUndefined();
 }finally{
  await db`delete from media where id=${movie}`;
 }
});

run('artist identities match their credited works and name-only credits stay distinct across namesakes',async()=>{
 const db=getSql(),[one,two,album,legacy]=Array.from({length:4},()=>crypto.randomUUID());
 try{
  for(const [id,kind,title] of [[one,'artist','Alex'],[two,'artist','Alex'],[album,'album','Duet'],[legacy,'album','Uncredited']]){
   await db`insert into works(id,category,kind) values(${id},'music',${kind})`;
   await db`insert into music_works(id,kind,title,artist_names,year) values(${id},${kind},${title},array['Alex'],2011)`;
  }
  await db`insert into music_credits(work_id,artist_id,role) values(${album},${one},'artist'),(${album},${one},'album-artist'),(${album},${two},'artist')`;
  const result=await workTasteFeatures([one,two,album,legacy]);
  expect(result.get(one)?.artists).toEqual([{id:'artist:'+one,name:'Alex'}]);
  expect(result.get(two)?.artists).toEqual([{id:'artist:'+two,name:'Alex'}]);
  expect(result.get(album)?.artists?.map(artist=>artist.id).sort()).toEqual([one,two].sort().map(id=>'artist:'+id));
  expect(result.get(legacy)?.artists).toEqual([{id:'artist-name:alex',name:'Alex'}]);
  expect(result.get(album)?.decades?.[0].id).toBe('2010s');
  expect(result.get(one)?.decades).toBeUndefined();
 }finally{await db`delete from works where id in (${album},${legacy},${one},${two})`;}
});

run('a reading subject stored under multiple labels contributes once and keeps unrelated genres',async()=>{
 const db=getSql(),book=crypto.randomUUID(),game=crypto.randomUUID();
 try{
  await db`insert into works(id,category,kind) values(${book},'book','book')`;
  await db`insert into reading_works(id,provider,external_id,kind,title,subjects,source_url,published_year)
   values(${book},'openlibrary',${book},'book','Reading metadata',array['First contact'],'https://fixture.invalid/book',1963)`;
  await db`insert into work_features(work_id,provider,features) values(${book},'openlibrary',${{
   genres:[{id:'first contact',name:'First contact'},{id:'adventure',name:'Adventure'}],
   tags:[{id:'first contact',name:'First contact'}],
  }}::jsonb)`;
  await db`insert into games(id,title,release_date) values(${game},'Game metadata','1983-01-01')`;
  const result=await workTasteFeatures([book,game]);
  expect(result.get(book)?.tags?.map(value=>value.name)).toEqual(['First contact']);
  expect(result.get(book)?.genres?.map(value=>value.name)).toEqual(['Adventure']);
  expect(result.get(book)?.decades?.[0].id).toBe('1960s');
  expect(result.get(game)?.decades?.[0].id).toBe('1980s');
 }finally{
  await db`delete from works where id=${book}`;await db`delete from games where id=${game}`;
 }
});

run('a fresh reading import saves each subject only under tags',async()=>{
 const db=getSql();
 await db`insert into system_settings(key,value) values('coast','{"experimentalBooks":true}') on conflict(key) do update set value=excluded.value`;
 const book=await importReading({provider:'openlibrary',externalId:'OL944114017W',kind:'book',title:'Subject fixture',
  sourceUrl:'https://openlibrary.org/works/OL944114017W',authors:[],subjects:['First contact']});
 try{
  const [saved]=await db`select features from work_features where work_id=${book.id} and provider='openlibrary'`;
  const tags=[{id:'first contact',name:'First contact'}];
  expect(saved.features.tags).toEqual(tags);
  expect(saved.features.genres).toBeUndefined();
  expect((await workTasteFeatures([book.id])).get(book.id)).toEqual({tags});
 }finally{await db`delete from works where id=${book.id}`;}
});

run('medium-specific provider metadata survives validation, persistence and the shared Taste read',async()=>{
 const db=getSql(),instance=crypto.randomUUID(),items:string[]=[];
 await db`insert into system_settings(key,value) values('coast','{"experimentalBooks":true,"experimentalComics":true,"experimentalGaming":true,"experimentalMusic":true}')
  on conflict(key) do update set value=excluded.value`;
 try{
  const openLibrary=new OpenLibraryAdapter(async path=>path.startsWith('/works/')?
   {key:'/works/OL944114018W',title:'Fixture Book',subjects:['Exploration'],subject_places:['Antarctica']}:
   {docs:[{key:'/works/OL944114018W',title:'Fixture Book',author_name:['An Author'],language:['eng'],publisher:['Example Press']}],numFound:1});
  const book=await importReading(await openLibrary.details('OL944114018W'));items.push(book.id);
  const comicVine=new ComicVineAdapter('fixture',async path=>{
   expect(new URL(path,'https://fixture.invalid').searchParams.get('field_list')).toContain('concept_credits');
   return {status_code:1,results:{id:944114018,site_detail_url:'https://comicvine.gamespot.com/fixture/4000-944114018/',
    name:'Fixture Comic',volume:{id:21,name:'Fixture Series',publisher:{name:'Comic Press'}},
    concept_credits:[{name:'Space travel'}],character_credits:[{name:'Star Captain'}],
    person_credits:[{name:'Comic Writer',role:'Writer'},{name:'Comic Artist',role:'Penciller'}]}};
  });
  const comic=await importReading(await comicVine.details('4000-944114018'));items.push(comic.id);
  const game=await importIgdbMetadata(mapIgdbGame({id:944114018,name:'Fixture Game',
   collections:[{id:41,name:'Fixture Games'},{id:42,name:'Game Franchise'}],franchises:[{id:21,name:'Game Franchise'}],
   language_supports:[{language:{name:'English'}},{language:{name:'English'}}]}));items.push(game.id);
  await db`insert into provider_instances(id,provider,name,base_url) values(${instance},'jellyfin','Music fixture','https://fixture.invalid')`;
  const trackId='c'.repeat(32),composerId='d'.repeat(32);
  const [remote]=await musicItems(async()=>({TotalRecordCount:1,Items:[{Id:trackId,Name:'Fixture Track',Type:'Audio',
   Tags:['Dream pop'],Studios:[{Name:'Fixture Studio'}],People:[{Id:composerId,Name:'Fixture Composer',Type:'Composer'}]}]}),'account',[trackId]);
  const track=await persistMusic(instance,remote);items.push(track.workId!);
  await persistMusic(instance,{...remote,tasteFeatures:undefined});
  const features=await workTasteFeatures(items);
  const names=(id:string,dimension:keyof NonNullable<ReturnType<typeof features.get>>)=>features.get(id)?.[dimension]?.map(({name})=>name);
  expect(names(book.id,'tags')).toEqual(['Exploration','Antarctica']);
  expect(names(book.id,'publishers')).toEqual(['Example Press']);
  expect(names(book.id,'languages')).toEqual(['English']);
  expect(names(comic.id,'themes')).toEqual(['Space travel']);
  expect(names(comic.id,'tags')).toEqual(['Star Captain']);
  expect(names(comic.id,'illustrators')).toEqual(['Comic Artist']);
  expect(names(comic.id,'publishers')).toEqual(['Comic Press']);
  expect(names(game.id,'franchises')).toEqual(['Game Franchise','Fixture Games']);
  expect(names(game.id,'languages')).toEqual(['English']);
  expect(names(game.id,'cast')).toBeUndefined();
  expect(names(track.workId!,'tags')).toEqual(['Dream pop']);
  expect(names(track.workId!,'studios')).toEqual(['Fixture Studio']);
  expect(names(track.workId!,'composers')).toEqual(['Fixture Composer']);
 }finally{
  await db`delete from provider_instances where id=${instance}`;
  await db`delete from works where id=any(${db.array(items,'UUID')}::uuid[])`;
 }
});

run('a rated episode contributes guest credits once per canonical show',async()=>{
 const db=getSql(),[show,one,two]=Array.from({length:3},()=>crypto.randomUUID());
 const cast=[{id:'tmdb:1',name:'Regular'},{id:'tmdb:2',name:'Guest'}];
 try{
  await db`insert into media(id,kind,title) values(${show},'show','Guests'),(${one},'episode','Part one'),(${two},'episode','Part two')`;
  await db`insert into work_features(work_id,provider,features) values
    (${one},'tmdb',${{cast}}::jsonb),(${two},'tmdb',${{cast}}::jsonb)`;
  const work={id:show,kind:'show',childRatings:[{id:one,rating:4},{id:two,rating:5}]};
  const facts=await childTasteCredits([work],new Map([[show,{cast:[cast[0]]}]]));
  expect(facts.get(show)).toEqual([{rating:4.5,features:{cast:[cast[1]]}}]);
 }finally{await db`delete from media where id=any(${db.array([show,one,two],'UUID')})`;}
});

run('reading edition preferences use the verified file and leave ambiguous translations unknown',async()=>{
 const db=getSql(),[book,viewer,instance]=Array.from({length:3},()=>crypto.randomUUID());
 const facts={openLibrary:{languages:['eng','jpn'],publishers:['Local Press','Tokyo Press'],editionSample:[
  {id:'OL1M',title:'Translation',languages:['eng'],publishers:['Local Press']},
  {id:'OL2M',title:'Original',languages:['jpn'],publishers:['Tokyo Press']},
 ]}};
 try{
  await db`insert into users(id,username) values(${viewer},${'edition-'+viewer})`;
  await db`insert into works(id,category,kind) values(${book},'book','book')`;
  await db`insert into reading_works(id,provider,external_id,kind,title,source_url,catalogue_facts)
   values(${book},'openlibrary',${book},'book','Many editions','https://fixture.invalid',${facts}::jsonb)`;
  await db`insert into work_features(work_id,provider,features) values(${book},'openlibrary',${{publishers:[{id:'tokyo press',name:'Tokyo Press'},{id:'local press',name:'Local Press'}]}}::jsonb)`;
  const ambiguous=(await workTasteFeatures([book])).get(book);
  expect(ambiguous?.languages).toBeUndefined();
  expect(ambiguous?.publishers).toBeUndefined();
  await db`insert into provider_instances(id,provider,name,base_url) values(${instance},'jellyfin','Reading fixture','https://fixture.invalid')`;
  const [connection]=await db`insert into provider_connections(user_id,instance_id,status) values(${viewer},${instance},'connected') returning id,account_generation`;
  await db`insert into work_editions(work_id,instance_id,external_id,format,metadata) values
   (${book},${instance},'file','pdf','{"version":"verified-file","openLibraryEditionId":"OL2M"}')`;
  await db`insert into reading_sessions(user_id,work_id,connection_id,account_generation,external_id,format,edition,location,expires_at)
   values(${viewer},${book},${connection.id},${connection.account_generation},'file','pdf','verified-file','{"format":"pdf","page":3,"total":30}',now())`;
  const selected=(await workTasteFeatures([book],undefined,undefined,undefined,viewer)).get(book);
  expect(selected?.languages).toEqual([{id:'japanese',name:'Japanese'}]);
  expect(selected?.publishers).toEqual([{id:'tokyo press',name:'Tokyo Press'}]);
 }finally{
  await db`delete from users where id=${viewer}`;
  await db`delete from provider_instances where id=${instance}`;
  await db`delete from works where id=${book}`;
 }
});
