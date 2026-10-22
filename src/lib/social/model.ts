import * as v from 'valibot';
export const audiences = ['friends','public','private'] as const;
export const activityAudiences = ['all','friends','you'] as const;
export type ActivityAudience = typeof activityAudiences[number];
export const activityAudienceOptions = [{value:'all',label:'All'},{value:'friends',label:'Friends'},{value:'you',label:'Me'}];
export const activityTypes=['all','consumed','progress','saved','favourites','ratings','collected','dropped'] as const;
export const activityTypeEvents:Record<Exclude<typeof activityTypes[number],'all'>,string[]>={
 consumed:['watch','listen','play','played','session','game-completed','reading-completed'],
 progress:['progress','game-in-progress','game-paused','reading-reading','reading-paused','restore'],
 saved:['watchlist','game-planned','reading-planned'],favourites:['favourite'],ratings:['rating'],collected:['collect','collected'],dropped:['drop','game-dropped','reading-dropped'],
};
export function activityTypeOptions(category:string){
 const labels={all:'All',consumed:category==='screen'?'Watched':category==='game'?'Played':category==='reading'?'Read':category==='music'?'Listened':'Consumed',progress:'In progress',saved:'Saved for later',favourites:'Favourited',ratings:'Rated',collected:'Collected',dropped:'Dropped'};
 return activityTypes.filter(value=>category!=='music'||value!=='progress'&&value!=='dropped').map(value=>({value,label:labels[value]}));
}
export const activityFiltersSchema = v.object({
 audience:v.optional(v.picklist(activityAudiences),'all'),
 mediaKind:v.optional(v.picklist(['all','movie','show','album','track','game','book','comic']),'all'),
 period:v.optional(v.picklist(['all','month','year']),'all'),
 activityType:v.optional(v.picklist(activityTypes),'all'),
});
export type ActivityFilters = v.InferOutput<typeof activityFiltersSchema>;
export const socialSections = ['details','collection','activity','progress','favourites','ratings','presence','reactions','insights'] as const;
export const socialCategories = ['screen','music','game','book','comic'] as const;
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
  categories:v.optional(v.object({screen:v.optional(v.picklist(audiences)),music:v.optional(v.picklist(audiences)),game:v.optional(v.picklist(audiences)),book:v.optional(v.picklist(audiences)),comic:v.optional(v.picklist(audiences))}),{}),
  notifications:v.optional(v.object({'friend-request':v.optional(v.boolean()),'friend-accepted':v.optional(v.boolean()),recommendation:v.optional(v.boolean()),reaction:v.optional(v.boolean()),'synced-invite':v.optional(v.boolean())}),{}),
});
export const emojis = ['❤️','😂','😮','😢','🔥'] as const;
export type NotificationData = {actorId:string; subjectId:string; destination:string; actions?: ('accept'|'decline'|'save'|'dismiss')[]; workId?:string};

export function activityAction(kind:string) {
 return ({'reading-planned':'Saved','reading-reading':'Reading','reading-completed':'Read','reading-paused':'Paused','reading-dropped':'Stopped',watch:'Watched',listen:'Listened',rating:'Rated',favourite:'Favourited',collect:'Collected',collected:'Collected',watchlist:'Saved',play:'Played',played:'Played',session:'Played','game-completed':'Completed','game-in-progress':'Started','game-paused':'Paused','game-dropped':'Stopped',drop:'Stopped',restore:'Resumed',progress:'Progressed',reaction:'Reacted',checkin:'Checked-in'} as Record<string,string>)[kind] ?? kind.replaceAll('-', ' ').replace(/^./, c=>c.toUpperCase());
}
export function unknownActivityDate(kind:string){
 return kind==='collect'||kind==='collected'?'Acquisition date unavailable':kind==='listen'?'Listen date unavailable':kind==='watch'?'Watch date unavailable':['play','played','session'].includes(kind)?'Play date unavailable':'Activity date unavailable';
}
let activityDateFormats: {locale: string | undefined; short: Intl.DateTimeFormat; year: Intl.DateTimeFormat} | undefined;
export function activityDateLabel(date:string,now:number,locale?:string) {
 const seconds=Math.max(0,Math.floor((now-new Date(date).getTime())/1000));
 if(seconds>=7*86400){
  const occurred=new Date(date);
  if (!activityDateFormats || activityDateFormats.locale !== locale) {
    activityDateFormats = {
      locale,
      short: new Intl.DateTimeFormat(locale, {day:'numeric',month:'short'}),
      year: new Intl.DateTimeFormat(locale, {day:'numeric',month:'short',year:'numeric'}),
    };
  }
  return (occurred.getFullYear()!==new Date(now).getFullYear()?activityDateFormats.year:activityDateFormats.short).format(occurred);
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

export const workFriendFilters=['all','consumed','progress','watchlist','lists','favourites'] as const;
export type WorkFriendFilter=typeof workFriendFilters[number];
/** The same relationship controls use labels appropriate to the work being viewed. */
export function workFriendOptions(kind?:string){
 const labels=kind==='book'||kind==='comic'?['Read','Reading','To read']:kind==='game'?['Played','Playing','Backlog']:['album','track','artist'].includes(kind??'')?['Listened','Listening','Saved for later']:['Watched','Watching','Watchlist'];
 return workFriendFilters.map((value,index)=>({value,label:['All',...labels,'Lists','Favourites'][index]}));
}
