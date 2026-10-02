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
