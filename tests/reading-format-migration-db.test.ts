import {expect,test} from 'bun:test';
import {getSql} from '../src/lib/server/db';
const run=process.env.COAST_DB_TEST==='1'?test:test.skip;
run('reading format upgrade replaces the constraint automatically named by migration 0048',async()=>{
 const original=await Bun.file('drizzle/0048_reading_sessions.sql').text();
 const addColumn=original.match(/ALTER TABLE synced_rooms ADD COLUMN reading_format[^;]+;/)![0];
 const upgrade=await Bun.file('drizzle/0061_reading_archive_formats.sql').text();
 await getSql().begin(async tx=>{
  await tx`create temporary table reading_sessions(format text check(format in ('pdf','epub','cbz'))) on commit drop`;
  await tx`create temporary table synced_rooms(id int) on commit drop`;
  await tx.unsafe(addColumn);
  const constraints=await tx`select conname from pg_constraint where conrelid='pg_temp.synced_rooms'::regclass`;
  expect(constraints.map((row:{conname:string})=>row.conname)).toContain('synced_rooms_reading_format_check');
  for(const statement of upgrade.split('--> statement-breakpoint').filter(statement=>statement.trim()))await tx.unsafe(statement);
  for(const format of ['pdf','epub','cbz','cbr','cb7','cbt']){
   await tx`insert into reading_sessions(format) values(${format})`;
   await tx`insert into synced_rooms(reading_format) values(${format})`;
  }
  expect((await tx`select format from reading_sessions`).map((row:{format:string})=>row.format).sort()).toEqual(['cb7','cbr','cbt','cbz','epub','pdf']);
  expect((await tx`select reading_format from synced_rooms`).map((row:{reading_format:string})=>row.reading_format).sort()).toEqual(['cb7','cbr','cbt','cbz','epub','pdf']);
 });
});
