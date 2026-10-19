import type { CascadeTurn, PageGrab } from './model.ts';
import { turnEase } from './turn-gesture.ts';
// Reservations include sheets still loading, so fast clicks cannot create an
// unbounded queue or let a later image overtake an earlier physical sheet.
export class PageCascade {
  records: CascadeTurn[] = [];
  direction = 0;
  closing = 0;
  closingGrab: PageGrab | undefined;
  lastStart = -Infinity;
  committed = 1;
  reserved = 1;
  duration: number;
  limit: number;
  spacing: number;
  count: number;
  constructor(count: number, { duration = 720, limit = 4, spacing = 120 } = {}) {
    this.count = count;
    this.duration = duration;
    this.limit = limit;
    this.spacing = spacing;
    this.clear();
  }
  clear() {
    this.records = [];
    this.direction = 0;
    this.closing = 0;
    this.closingGrab = undefined;
    this.lastStart = -Infinity;
    this.committed = this.reserved = 1;
  }
  get busy() {
    return this.records.length > 0;
  }
  get available() {
    return this.busy && !this.closing && this.records.length < this.limit;
  }
  reserve(index: number, direction: number, grab?: PageGrab) {
    direction = Math.sign(direction);
    if (!direction || this.closing || (this.direction && direction !== this.direction))
      return;
    if (!this.busy) {
      this.committed = this.reserved = index;
      this.direction = direction;
    }
    const target = this.reserved + direction * 2;
    if (target < 1 || target >= this.count - 1) {
      this.closing = direction;
      this.closingGrab = grab ? { ...grab } : undefined;
      return { close: direction };
    }
    if (this.records.length >= this.limit)
      return;
    const record: CascadeTurn = { from: this.reserved, target, direction, grab: grab ? { ...grab } : undefined, ready: false, start: null, progress: 0 };
    this.records.push(record);
    this.reserved = target;
    return { turn: record };
  }
  advance(now: number) {
    const started: CascadeTurn[] = [], completed: CascadeTurn[] = [];
    for (const record of this.records) {
      if (record.start === null) {
        if (!record.ready || now < this.lastStart + this.spacing)
          break;
        record.start = now;
        this.lastStart = now;
        started.push(record);
      }
      record.progress = turnEase(Math.max(0, Math.min(1, (now - record.start) / this.duration)));
    }
    while (this.records[0]?.progress === 1) {
      const record = this.records.shift()!;
      this.committed = record.target;
      completed.push(record);
    }
    return { started, completed, stackIndex: this.committed + this.records.reduce((sum, record) => sum + record.direction * 2 * record.progress, 0) };
  }
}
