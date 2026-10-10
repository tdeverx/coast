import {expect,test} from 'bun:test';
import {rankRows,genreReason} from '../src/lib/recommendations/row-ranking';
import {genreRowTitle} from '../src/lib/recommendations/row-titles';
import {TraktAdapter} from '../src/lib/providers/trakt/adapter.server';
test('row priority favours established tastes, stays stable per visit, and retains exploration',()=>{
 const rows=[{key:'interest',category:'screen',weight:12},{key:'explore',category:'game',weight:.35}];
 let first=0;for(let n=0;n<100;n++)if(rankRows(rows,String(n))[0].key==='interest')first++;
 expect(first).toBeGreaterThan(90);expect(rankRows(rows,'visit')).toEqual(rankRows(rows,'visit'));expect(rankRows(rows,'visit')).toHaveLength(2);
 expect(genreReason(0,0)).toBe('saved');expect(genreReason(1,0)).toBe('watched');expect(genreReason(2,0)).toBe('liked');expect(genreReason(0,1)).toBe('liked');
 expect(genreRowTitle('screen','Animation','movie','saved')).not.toContain('love');
 expect(genreRowTitle('screen','Animation','show','explore')).toBe('A new direction in shows: animation');
});
test('Trakt recommendations use the authenticated bounded read endpoint',async()=>{
 const adapter=new TraktAdapter(async(path,init)=>{expect(path).toBe('/recommendations/movies?limit=40');expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer token');return [{title:'Suggestion',year:2025,ids:{trakt:2,tmdb:3}}];},'client','secret','token');
 expect((await adapter.recommendations('movie'))[0].ids.tmdb).toBe(3);
});
