import {expect,test} from 'bun:test';
import {getSql} from '../src/lib/server/db';
import {workTasteFeatures} from '../src/lib/social/work-features.server';
import type {TasteAudienceRating} from '../src/lib/social/taste-rating-model';
import {importReading} from '../src/lib/catalogue/reading.server';

const run=process.env.COAST_DB_TEST==='1'?test:test.skip;

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
