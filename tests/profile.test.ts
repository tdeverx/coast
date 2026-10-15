import { periodStart } from '../src/lib/profile/period';
import { journalGroups, type JournalEntry } from '../src/lib/profile/journal';
import { test, expect } from 'bun:test';
import { activityBuckets } from '../src/lib/profile/activity';

test('activity fills quiet days and excludes records outside the selected UTC window', () => {
  const buckets = activityBuckets(
    [
      { date: '2026-08-28', movies: 99, episodes: 0 },
      { date: '2026-08-29', movies: 1, episodes: 2 },
      { date: '2026-09-27', movies: 3, episodes: 4 },
      { date: '2026-09-28', movies: 99, episodes: 0 },
    ],
    '2026-09-27',
    '30'
  );
  expect(buckets).toHaveLength(30);
  expect(buckets[0]).toEqual({ date: '2026-08-29', end: '2026-08-29', movies: 1, episodes: 2 });
  expect(buckets[1].movies).toBe(0);
  expect(buckets.reduce((sum, day) => sum + day.movies, 0)).toBe(4);
});
test('longer periods preserve totals in bounded weekly and calendar-month buckets', () => {
  const days = [{ date: '2026-09-27', movies: 2, episodes: 3 }];
  for (const [period, length] of [
    ['90', 13],
    ['year', 13],
  ] as const) {
    const buckets = activityBuckets(days, '2026-09-27', period);
    expect(buckets).toHaveLength(length);
    expect(buckets.at(-1)?.end).toBe('2026-09-27');
    expect(buckets.reduce((sum, day) => sum + day.movies + day.episodes, 0)).toBe(5);
  }
});

test('annual buckets follow calendar months', () => {
  const buckets = activityBuckets([], '2026-09-27', 'year');
  expect(buckets[1].date).toBe('2025-10-01');
  expect(buckets[1].end).toBe('2025-10-31');
});

test('period bounds and all-time buckets keep old history', () => {
  expect(periodStart('month', new Date('2026-09-27T12:00:00Z'))).toBe('2026-08-29');
  expect(periodStart('all')).toBeUndefined();
  const buckets = activityBuckets(
    [{ date: '2000-01-01', movies: 1, episodes: 0 }],
    '2026-09-27',
    'all'
  );
  expect(buckets).toHaveLength(27);
  expect(buckets[0].movies).toBe(1);
});
test('journal groups only consecutive episodes within the same UTC day', () => {
  const entry = (id: string, showId: string, day: string, kind = 'episode') =>
    ({ eventId: id, id, showId, kind, watchedAt: `2026-09-${day}T12:00:00Z` }) as JournalEntry;
  const groups = journalGroups([
    entry('1', 'show', '27'),
    entry('2', 'show', '27'),
    entry('3', 'other', '27'),
    entry('4', 'show', '27'),
    entry('5', 'show', '26'),
  ]);
  expect(groups.map((d) => d.runs.map((r) => r.length))).toEqual([[2, 1, 1], [1]]);
});

test('all-time annual aggregation preserves exact daily-oracle boundaries, duplicates and sparse totals', () => {
  const today='2026-10-15';
  for(const start of ['2024-10-16','2024-10-15','2024-10-14','2020-02-29','1976-10-15','1926-10-15']){
    const days=[{date:start,movies:1,episodes:2},{date:'2024-02-29',movies:3,episodes:4},{date:'2026-10-15',movies:5,episodes:6},{date:'2026-10-15',movies:7,episodes:8},{date:'2026-10-16',movies:99,episodes:99},{date:'2025-02-30',movies:99,episodes:99}];
    const first=[...days].sort((a,b)=>a.date.localeCompare(b.date))[0].date;
    const count=Math.ceil((Date.parse(today)-Date.parse(first))/86400000)+1;
    const byDate=new Map(days.map(day=>[day.date,day]));
    const expected:ReturnType<typeof activityBuckets>=[];
    for(let time=Date.parse(first);time<=Date.parse(today);time+=86400000){
      const date=new Date(time).toISOString().slice(0,10);
      const previous=expected.at(-1);
      if(!previous||previous.date.slice(0,count>730?4:7)!==date.slice(0,count>730?4:7))expected.push({date,end:date,movies:0,episodes:0});
      const bucket=expected.at(-1)!;bucket.end=date;
      const value=byDate.get(date);bucket.movies+=value?.movies??0;bucket.episodes+=value?.episodes??0;
    }
    expect(activityBuckets(days,today,'all')).toEqual(expected);
  }
  for(const start of ['2024-10-16','2024-10-15','2024-10-14']){
    const result=activityBuckets([{date:start,movies:1,episodes:0}],today,'all');
    expect(result[0].date).toBe(start);expect(result.at(-1)?.end).toBe(today);
    expect(result).toHaveLength(start==='2024-10-16'?25:3);
  }
});

test('sparse all-time activity visits calendar years rather than every quiet day',()=>{
  const original=Date.prototype.toISOString;
  let conversions=0;
  Date.prototype.toISOString=function(){conversions++;return original.call(this);};
  try{
    const days=[{date:'1926-10-15',movies:1,episodes:2},{date:'2026-10-15',movies:3,episodes:4}];
    const buckets=activityBuckets(days,'2026-10-15','all');
    expect(buckets).toHaveLength(101);
    expect(conversions).toBeLessThanOrEqual(buckets.length*2+days.length);
    expect(buckets.reduce((sum,bucket)=>sum+bucket.movies+bucket.episodes,0)).toBe(10);
  }finally{Date.prototype.toISOString=original;}
});
