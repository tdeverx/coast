export const notificationSegments = [{value:'all',label:'All'},{value:'social',label:'Social'},{value:'requests',label:'Requests'},{value:'system',label:'System'}] as const;
export const notificationKinds = [{value:'all',label:'All types'},{value:'friend-accepted',label:'Friends accepted'},{value:'recommendation',label:'Recommendations'},{value:'reaction',label:'Reactions'},{value:'synced-invite',label:'Session invitations'},{value:'request',label:'Request updates'},{value:'availability',label:'Newly available'},{value:'sync',label:'Sync updates'},{value:'external-action',label:'Service issues'},{value:'administrator',label:'Administrator notices'}] as const;
export type NotificationFilters={segment:'all'|'social'|'requests'|'system';kind:string;unread:boolean;category:'all'|'screen'|'game'|'music';period:'all'|'week'|'month'};
export const defaultNotificationFilters:NotificationFilters={segment:'all',kind:'all',unread:false,category:'all',period:'all'};
export type NotificationEntry={id:string;kind:string;title:string;body:string|null;createdAt:string;readAt:string|null;locked:boolean;actor:{username:string;avatar:string|null;status:import('$lib/social/status').ActivityStatus}|null;reaction?:string|null;activity?:import('$lib/ui/types').MediaView|import('$lib/ui/types').MediaCardPresentation|null;friend?:import('$lib/social/model').FriendEntry|null;media:{card:import('$lib/ui/types').MediaView|import('$lib/ui/types').MediaCardPresentation;id:string;title:string;href:string;artwork:string|null;availability:string;stale:boolean}|null;sourceLabel:string|null;destination:string|null;requestState:string|null;sessionState:string|null;actions:('accept'|'decline'|'save'|'dismiss')[];subjectId:string|null};
export type NotificationResult={items:NotificationEntry[];hasMore:boolean;next:{before:string;beforeId:string}|null;unread:number;snapshot:string};
export function notificationDestination(kind:string,destination?:string|null) {
 if(kind==='friend-request'||kind==='friend-accepted')return '/for-you?friends=true';
 if(kind==='recommendation'&&destination?.startsWith('/notifications'))return '/for-you?notifications=true&notificationKind=recommendation';
 if(destination?.startsWith('/')&&!destination.startsWith('//'))return destination;
 return kind==='external-action'?'/settings/jobs':kind==='sync'?'/settings/integrations':kind==='request'?'/requests':null;
}
