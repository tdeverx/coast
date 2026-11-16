import { expect, test } from 'bun:test';
import { TmdbAdapter } from '../src/lib/providers/tmdb/adapter.server';
import { TraktAdapter } from '../src/lib/providers/trakt/adapter.server';
import { IgdbAdapter } from '../src/lib/providers/igdb/adapter.server';
import { OpenLibraryAdapter } from '../src/lib/providers/openlibrary/adapter.server';
import { ComicVineAdapter } from '../src/lib/providers/comic-vine/adapter.server';
import type { Metadata } from '../src/lib/providers/contracts';
import { mergeScreenRankings } from '../src/lib/recommendations/screen-ranking';
import { providerRowCache } from '../src/lib/recommendations/provider-read.server';

const title = (provider: string, id: string, tmdb?: string, kind: Metadata['kind']='movie'): Metadata => ({
  provider,externalId:id,externalIds:tmdb?{tmdb}:undefined,kind,title:`${provider} ${id}`,
});

test('independent provider ranks converge on verified screen IDs and keep films and shows separate',()=>{
  const first={...title('tmdb','1'),posterPath:'https://image.tmdb.org/t/p/w780/poster.jpg'};
  const overlap={...title('trakt','11','1'),overview:'Trakt synopsis'};
  const other=title('trakt','31','3');
  const show=title('trakt','21','1','show');
  const merged=mergeScreenRankings([[title('tmdb','2'),first],[other,overlap,show],[title('seerr','1','1')]]);
  expect(merged.map(item=>[item.kind,item.provider,item.externalId])).toEqual([
    ['movie','tmdb','1'],['movie','tmdb','2'],['movie','trakt','31'],['show','trakt','21'],
  ]);
  expect(merged[0]).toMatchObject({posterPath:first.posterPath,overview:'Trakt synopsis',externalIds:{tmdb:'1',trakt:'11'}});
  expect(mergeScreenRankings([[title('tmdb','2'),first],[title('seerr','1','1')]]).map(item=>item.externalId)).toEqual(['2','1']);
});

test('TMDB sends closed genre and release filters, and Trakt reads public app lists',async()=>{
  const requestSignal=new AbortController().signal;
  const tmdb = new TmdbAdapter(async (path,init)=>{
    const url=new URL(path,'https://fixture');
    expect(url.pathname).toBe('/3/discover/movie');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({with_genres:'878',include_adult:'false',sort_by:'vote_average.desc','vote_count.gte':'200','primary_release_date.lte':'2026-12-01',page:'1'});
    expect(init?.signal).toBe(requestSignal);
    return {results:[{id:123,title:'Example film',release_date:'2026-01-01'}]};
  });
  expect(await tmdb.browse('movie','rated','2026-11-01','2026-12-01',878,requestSignal)).toMatchObject([{provider:'tmdb',kind:'movie',externalId:'123'}]);
  const trakt = new TraktAdapter(async (path,init)=>{
    const url = new URL(path,'https://fixture');
    expect(url.pathname).toBe('/shows/anticipated');
    expect(url.searchParams.get('genres')).toBe('science-fiction');
    expect(new Headers(init?.headers).has('Authorization')).toBe(false);
    expect(init?.signal).toBe(requestSignal);
    return [{show:{title:'New show',first_aired:'2026-12-01T12:00:00.000Z',ids:{trakt:1,tmdb:2,tvdb:3}}}];
  },'fixture-client','fixture-secret');
  expect(await trakt.browse('show','anticipated','science-fiction',requestSignal)).toMatchObject([{provider:'trakt',kind:'show',releaseDate:'2026-12-01',externalIds:{tmdb:'2',tvdb:'3'}}]);
});

test('IGDB, Open Library and Comic Vine use bounded catalogue queries and provider card metadata',async()=>{
  const signal=new AbortController().signal;
  const igdb = new IgdbAdapter({clientId:'fixture',clientSecret:'fixture'},async(path,init)=>{
    expect(path).toBe('/v4/games');
    expect(init?.signal).toBe(signal);
    expect(init?.body).toContain('genres.name = "Puzzle"');
    expect(init?.body).toContain('sort total_rating desc; limit 60;');
    return [{id:74,name:'Puzzle Game'}];
  },async()=>({access_token:'test-token',expires_in:3600,token_type:'bearer'}));
  expect(await igdb.browse('rated',0,2000000000,'Puzzle',signal)).toMatchObject([{externalId:'74',title:'Puzzle Game'}]);
  const books = new OpenLibraryAdapter(async(path,init)=>{
    const params=new URL(path,'https://fixture').searchParams;
    expect(params.get('q')).toBe('subject:"science fiction"');
    expect(params.get('limit')).toBe('20');
    expect(init?.signal).toBe(signal);
    return {docs:[{key:'/works/OL87W',title:'Novel',subject:['Science fiction']}]};
  });
  expect(await books.browseSubject('science fiction',signal)).toMatchObject([{kind:'book',externalId:'OL87W'}]);
  const comics = new ComicVineAdapter('fixture',async(path,init)=>{
    const params=new URL(path,'https://fixture').searchParams;
    expect(params.get('filter')).toBe('store_date:2026-11-17|2026-12-31');
    expect(params.get('limit')).toBe('10');
    expect(init?.signal).toBe(signal);
    return {status_code:1,number_of_total_results:2,results:[
      {id:41,name:'Forthcoming issue',store_date:'2026-12-01',site_detail_url:'https://comicvine.gamespot.com/title/4000-41/'},
      {id:42,name:'Unscheduled issue',site_detail_url:'https://comicvine.gamespot.com/title/4000-42/'},
    ]};
  });
  expect(await comics.upcoming('2026-11-17','2026-12-31',signal)).toMatchObject([{externalId:'4000-41'}]);
});

test('concurrent provider reads share upstream work and stop it when the last reader leaves',async()=>{
  const read=providerRowCache<string>();
  let calls=0, upstream!:AbortSignal, finish!:(value:string)=>void;
  const loader = (signal: AbortSignal) => {
    calls++;upstream=signal;
    return new Promise<string>((resolve,reject)=>{finish=resolve;signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  };
  const a=new AbortController(), b=new AbortController();
  const first=read('genre',a.signal,loader), second=read('genre',b.signal,loader);
  await Promise.resolve();
  a.abort();await expect(first).rejects.toThrow();
  expect(upstream.aborted).toBe(false);expect(calls).toBe(1);
  finish('retained');expect(await second).toBe('retained');
  expect(await read('genre',b.signal,loader)).toBe('retained');expect(calls).toBe(1);
  const c=new AbortController();
  const detached=read('upcoming',c.signal,loader);await Promise.resolve();
  c.abort();await expect(detached).rejects.toThrow();expect(upstream.aborted).toBe(true);
  const retry=read('upcoming',b.signal,loader);await Promise.resolve();finish('new');
  expect(await retry).toBe('new');expect(calls).toBe(3);
});

test('leaving IGDB discovery during OAuth cancels the token request before it starts a listing',async()=>{
  const transportStarted=Promise.withResolvers<AbortSignal>();
  let tokenRequests=0,listRequests=0;
  const adapter=new IgdbAdapter({clientId:'fixture',clientSecret:'fixture'},async()=>{listRequests++;return [];},async(_path,init)=>{
    if(++tokenRequests>1)return {access_token:'fixture',expires_in:3600,token_type:'bearer'};
    const upstream=init?.signal;
    if(!upstream)throw new Error('OAuth transport did not receive a signal');
    return new Promise((_,reject)=>{
      upstream.addEventListener('abort',()=>reject(upstream.reason),{once:true});
      transportStarted.resolve(upstream);
    });
  });
  const controller=new AbortController();
  const pending=adapter.discover('trending',controller.signal);
  const upstream=await Promise.race([transportStarted.promise,pending.then(()=>{throw new Error('Discovery completed before OAuth');})]);
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(upstream.aborted).toBe(true);expect(listRequests).toBe(0);
  expect(await adapter.discover('trending')).toEqual([]);
  expect(tokenRequests).toBe(2);expect(listRequests).toBe(1);
});
