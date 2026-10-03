import * as v from 'valibot';
export const audiences = ['friends','public','private'] as const;
export const socialSections = ['details','collection','activity','progress','favourites','ratings','presence','reactions','insights'] as const;
export const socialCategories = ['screen','music','game'] as const;
export type Audience = typeof audiences[number];
export type SocialSection = typeof socialSections[number];
export type SocialSettings = {
  audience?: Audience;
  sections?: Partial<Record<SocialSection,Audience>>;
  categories?: Partial<Record<typeof socialCategories[number],Audience>>;
  notifications?: Partial<Record<'friend-request'|'friend-accepted'|'recommendation'|'reaction'|'synced-invite',boolean>>;
};
export const socialSettingsSchema = v.object({
  audience:v.optional(v.picklist(audiences),'friends'),
  sections:v.optional(v.object({
    details:v.optional(v.picklist(audiences)),collection:v.optional(v.picklist(audiences)),
    activity:v.optional(v.picklist(audiences)),progress:v.optional(v.picklist(audiences)),
    favourites:v.optional(v.picklist(audiences)),ratings:v.optional(v.picklist(audiences)),
    presence:v.optional(v.picklist(audiences)),reactions:v.optional(v.picklist(audiences)),
    insights:v.optional(v.picklist(audiences)),
  }),{}),
  categories:v.optional(v.object({screen:v.optional(v.picklist(audiences)),music:v.optional(v.picklist(audiences)),game:v.optional(v.picklist(audiences))}),{}),
  notifications:v.optional(v.object({'friend-request':v.optional(v.boolean()),'friend-accepted':v.optional(v.boolean()),recommendation:v.optional(v.boolean()),reaction:v.optional(v.boolean()),'synced-invite':v.optional(v.boolean())}),{}),
});
export const emojis = ['❤️','😂','😮','😢','🔥'] as const;
export type NotificationData = {actorId:string; subjectId:string; destination:string; actions?: ('accept'|'decline'|'save'|'dismiss')[]; workId?:string};

export function activityAction(kind:string) {
 return ({watch:'Watched',listen:'Listened',rating:'Rated',favourite:'Favourited',collect:'Collected',collected:'Collected',watchlist:'Saved',play:'Played',played:'Played',session:'Played','game-completed':'Completed','game-in-progress':'Started','game-paused':'Paused','game-dropped':'Stopped',drop:'Stopped',restore:'Resumed',progress:'Progressed',reaction:'Reacted',checkin:'Checked-in'} as Record<string,string>)[kind] ?? kind.replaceAll('-', ' ').replace(/^./, c=>c.toUpperCase());
}
export function activityDateLabel(date:string,now:number) {
 const seconds=Math.max(0,Math.floor((now-new Date(date).getTime())/1000));
 if(seconds>=7*86400){
  const occurred=new Date(date);
  return occurred.toLocaleDateString(undefined,{day:'numeric',month:'short',...(occurred.getFullYear()!==new Date(now).getFullYear()?{year:'numeric'}:{})});
 }
 if(seconds<60)return 'Just now';
 const [value,unit]=seconds<3600?[Math.floor(seconds/60),'m']:seconds<86400?[Math.floor(seconds/3600),'h']:[Math.floor(seconds/86400),'d'];
 return `${value}${unit} ago`;
}
export type FriendEntry = {
 id:string;state:'pending'|'accepted';requestedBy:string;userId:string;username:string;
 avatar:string|null;canCompare:boolean;activityStatus:import('./status').ActivityStatus;
 activity?:{title:string;href:string;label:string;artwork?:string;progress?:number|null};
 backgroundWorkId?:string|null;backgroundArtwork?:string;
};
