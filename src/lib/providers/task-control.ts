export type TaskControlAction = 'retry' | 'cancel' | 'promote';
export type TaskControlSpec = {kind:string;instanceId:string|null;action:TaskControlAction};
export type TaskControlCommand = TaskControlSpec & {
  id:string;
  revision:number;
  status:'incomplete'|'complete'|'abandoned';
  updated:number;
  skipped:number;
  total:number;
  remaining:number;
  hasMore:boolean;
  blocked:boolean;
  error:string|null;
  compacted:boolean;
};
export type TaskControlListing = {items:TaskControlCommand[];more:boolean};
