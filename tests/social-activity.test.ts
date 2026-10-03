import {expect,test} from 'bun:test';
import {activityDateLabel,activityAction} from '../src/lib/social/model';
test('relative activity times and concrete action names stay clear',()=>{
 const date='2020-01-01T00:00:00Z',now=new Date(date).getTime();
 expect(activityDateLabel(date,now+30_000)).toBe('Just now');
 expect(activityDateLabel(date,now+120_000)).toBe('2m ago');
 expect(activityDateLabel(date,now+3_600_000)).toBe('1h ago');
 expect(activityDateLabel(date,now+172_800_000)).toBe('2d ago');
 expect(activityDateLabel(date,now+6*86400_000)).toBe('6d ago');
 expect(activityDateLabel(date,now+7*86400_000)).toBe(new Date(date).toLocaleDateString(undefined,{day:'numeric',month:'short'}));
 expect(activityDateLabel(date,new Date('2021-01-01T00:00:00Z').getTime())).toContain('2020');
 expect(activityAction('game-completed')).toBe('Completed');
 expect(activityAction('collect')).toBe('Collected');
 expect(activityAction('watchlist')).toBe('Saved');
 expect(activityAction('game-in-progress')).toBe('Started');
 expect(activityAction('restore')).toBe('Resumed');
});
