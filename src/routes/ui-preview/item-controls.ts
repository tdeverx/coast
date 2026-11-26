import { recipe, scenarioLabel } from './reference';
import type { referenceEntries } from './catalog';
import type { PropContract } from './props';

type Entry = (typeof referenceEntries)[number];
export const standard = '@standard';
type Option = {id:string; label:string};
export type VariantGroup = Option & {options:Option[]};

// Only split a family when the examples answer different questions.
function family(entry:Entry, state:Entry['states'][number]) {
  if (state.reference === 'catalogue.cards') {
    if (['rating','match','for-you','collection-match'].includes(state.scenario)) return 'Score badge';
    if (['available','unavailable','missing-art','broken-art','long-copy'].includes(state.scenario)) return 'Card state';
    return 'Media type';
  }
  if (state.reference === entry.id) return 'Standard';
  return recipe(state.reference)?.title ?? entry.title;
}

export function variantGroups(entry:Entry, hasContract:boolean):VariantGroup[] {
  const groups = new Map<string,VariantGroup>();
  function add(group:string, option:Option) {
    if (!groups.has(group)) groups.set(group,{id:group,label:group,options:[]});
    groups.get(group)!.options.push(option);
  }
  if (hasContract && !entry.states.some(state=>state.id==='default')) add('Standard',{id:standard,label:'Standard'});
  for (const state of entry.states) {
    add(family(entry,state),{id:state.id,label:state.label.split(' · ').at(-1)!});
  }
  for (const group of groups.values()) {
    if (group.id!=='Standard' && group.options.length===1) group.label=group.options[0].label;
  }
  return [...groups.values()];
}

// Named variants with simple prop differences stay editable on the same specimen.
export function variantProps(name:string, state:string):Record<string,unknown>|undefined {
  if (state===standard || state==='default') return {};
  if (name==='Button') {
    if (state==='disabled') return {disabled:true};
    if (state==='pressed') return {pressed:true};
    if (state==='busy') return {disabled:true,text:'Saving…',label:'Saving'};
  }
  if (name==='ProgressiveBlur') {
    if (state==='neutral') return {};
    if (state==='tinted') return {tint:'linear-gradient(to right, #2437a6, #943cd0, #f84d80)'};
    if (state==='gradient-only') return {radius:0,tint:'linear-gradient(to right, #2563eb, #9d38d2, #fc7151)'};
  }
  if (name==='OperationProgress' && ['known','unknown','complete','zero'].includes(state))
    return {total:state==='unknown'?null:state==='zero'?0:100,processed:state==='zero'?0:state==='complete'?100:42};
  if (name==='Toast' && ['success','error'].includes(state))
    return state==='error'?{kind:'error',text:'A source is unavailable.',actionLabel:'Retry'}:{kind:'info'};
}

// Keep implementation details in Advanced. Prefer a short set of controls for each owner.
const quickFields: Record<string,string> = {
  Button:'emphasis size material icon text disabled pressed danger', MediaCard:'shape artworkStyle metric showCaption showPrimaryAction showArtworkMenu showFriends',
  Shelf:'layout shape artworkStyle busy hideEmpty artworkOptions', AccountFields:'signIn progressive disabled showDisplayName',
  ProgressiveBlur:'edge radius steps tint tintOpacity tintSteps', MediaHero:'context alignment size requestable',
  WorkMenu:'context hero showTrigger requestable', Toast:'kind text actionLabel busy persistent', Dialog:'title open wide alert',
  DetailOverlay:'open sectionPage preserveHero', ActivityHeader:'username status showAvatar', PlaybackTimeline:'audio disabled current',
  RowFilter:'icon selection submenus', RowStyleMenu:'mediaKind artworkOptions overrideShape', MediaPage:'context heroAlignment hero details',
  Icon:'name size filled', Avatar:'name size status border', Brand:'size compact', Rating:'value', ProgressBar:'progress',
  OperationProgress:'label processed total', Heading:'title description variant level', SettingsRow:'title description reason',
  IdentityCard:'progress wrapActions', DetailCard:'title description footerText', EmptyState:'title description icon',
  ProfileRecap:'period movies episodes', SocialControls:'size compact showOverflow', FactList:'items', MetricGrid:'items',
  ConflictList:'conflicts', QueueList:'actions', JobsSettings:'actions redesigned', NotificationToasts:'notifications rich',
  FormActions:'children', TextLink:'text dialog', Field:'label hint hideLabel', IntegrationSettings:'experimentalGaming experimentalComics',
  PartyCard:'inParty embedded', FriendRoster:'friends busy inviteDisabled', ChoiceGroup:'hideLabel defaultOption',
};
const labels:Record<string,string> = {initial4k:'Start in 4K',nonApproved:'Pending approval',showCaption:'Show caption',showArtworkMenu:'Show artwork menu',previewArtworkLoading:'Loading artwork'};
export function optionLabel(name:string) {
  return labels[name] ?? scenarioLabel(name.replace(/([a-z])([A-Z])/g,'$1 $2')).replace(/ [A-Z]/g,part=>part.toLowerCase());
}
export function visibleProps(name:string,props:PropContract[]) {
  const keys=quickFields[name]?.split(' ');
  return keys ? keys.flatMap(key=>props.filter(prop=>prop.name===key)) : props.filter(prop=>['boolean','select'].includes(prop.kind));
}
export const ranges:Record<string,[number,number,number]> = {
  progress:[0,1,.01],radius:[0,64,1],steps:[1,24,1],tintSteps:[2,24,1],tintOpacity:[0,1,.01],
  'Rating.value':[.5,5,.5],size:[12,96,1],
};

// These examples mount their owner inside a larger fixture. Pass only the
// selected overrides so the fixture keeps its own artwork, data and actions.
export function fixtureFields(reference:string, scenario:string) {
  if (reference==='catalogue.cards') {
    const fields=['shape','artworkStyle','overlay'];
    if (['rating','match','for-you','collection-match'].includes(scenario))
      fields.push('showCaption','showPrimaryAction','showArtworkMenu');
    return fields;
  }
  if (reference==='catalogue.rows' || reference==='catalogue.progress') return ['layout','artworkOptions','availability'];
  return [];
}

export function exampleSwitches(reference:string,scenario:string):{key:string;label:string;initial:boolean}[] {
  switch (reference) {
    case 'reading.launch': return [{key:'compact',label:'Compact',initial:false}];
    case 'editor.personalise': return [{key:'inOverlay',label:'Overlay layout',initial:true}];
    case 'editor.disclosure': return [{key:'note',label:'Show trailing note',initial:true}];
    case 'editor.picker': return [{key:'icons',label:'Show option icons',initial:true}];
    case 'editor.toggle': return [{key:'checked',label:'Checked',initial:true}];
    case 'account.identity': return [{key:'detail',label:'Show account role',initial:true}];
    case 'account.surface': return scenario==='group'||scenario==='invite'?[{key:'detail',label:'Show supporting text',initial:true}]:[];
    default: return [];
  }
}
