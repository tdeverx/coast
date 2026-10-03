import { test, expect } from 'bun:test';
import { activityStatus, IDLE_MS, OFFLINE_MS } from '../src/lib/social/status';
test('automatic presence ages independently from connected idle heartbeats',()=>{
 const now=1_000_000;
 expect(activityStatus('automatic',now,now,now)).toBe('online');
 expect(activityStatus('automatic',now,now-IDLE_MS,now)).toBe('away');
 expect(activityStatus('automatic',now-OFFLINE_MS,now,now)).toBe('offline');
 expect(activityStatus('automatic',null,null,now)).toBe('offline');
});
test('manual choices cannot keep disconnected users online and invisible always hides presence',()=>{
 const now=1_000_000;
 expect(activityStatus('away',now,now,now)).toBe('away');
 expect(activityStatus('busy',now,now-IDLE_MS,now)).toBe('busy');
 expect(activityStatus('invisible',now,now,now)).toBe('offline');
 expect(activityStatus('busy',now-OFFLINE_MS,now,now)).toBe('offline');
});
