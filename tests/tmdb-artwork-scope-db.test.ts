import {afterAll,beforeAll,expect,test} from 'bun:test';
import {eq} from 'drizzle-orm';
import {getDb} from '../src/lib/server/db';
import * as s from '../src/lib/server/db/schema';
import {fallbackArtwork} from '../src/lib/providers/tmdb/fallback.server';

const enabled=process.env.COAST_DB_TEST==='1',run=enabled?test:test.skip;
const id=crypto.randomUUID();
beforeAll(async()=>{
  if(!enabled)return;const db=getDb();
  await db.insert(s.works).values({id,category:'screen',kind:'movie'});
  await db.insert(s.media).values({id,kind:'movie',title:'Artwork scope fixture'});
  await db.insert(s.metadataSnapshots).values([
    {mediaId:id,provider:'tmdb',language:'en-US',region:'GB',updatedAt:new Date('2026-01-01'),
      raw:{artwork:{primary:'https://image.tmdb.org/t/p/w342/english.jpg'},artworkUpdatedAt:new Date().toISOString()}},
    {mediaId:id,provider:'tmdb',language:'de-DE',region:'DE',updatedAt:new Date('2026-02-01'),
      raw:{artwork:{primary:'https://image.tmdb.org/t/p/w342/german.jpg'},artworkUpdatedAt:new Date().toISOString()}},
  ]);
});
afterAll(async()=>{if(enabled)await getDb().delete(s.works).where(eq(s.works.id,id));});
run('default artwork fallback reads its own language and region even when another locale is newer',async()=>{
  const response=await fallbackArtwork(id,'primary');
  expect(response.status).toBe(302);expect(response.headers.get('location')).toContain('english.jpg');
  const [german]=await getDb().select().from(s.metadataSnapshots).where(eq(s.metadataSnapshots.language,'de-DE'));
  expect((german.raw.artwork as {primary:string}).primary).toContain('german.jpg');
});
