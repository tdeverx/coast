import manifest from './prop-manifest.json';
import {serviceTasks} from '$lib/providers/tasks';
import {providerSchedule} from '$lib/providers/schedule';
import {defaultNotificationFilters} from '$lib/notifications/model';
import {defaultPartySettings} from '$lib/playback/synced/model';
import {id,today,movie,show,items,facts,provider,job} from './demo/fixtures';

export type PropContract={name:string;type:string;optional:boolean;bindable:boolean;kind:'text'|'number'|'boolean'|'select'|'data'|'snippet'|'callback';nullable:boolean;choices?:Array<string|number>;defaultSource?:string;defaultValue?:unknown};
export type SlotChoice={kind:'example'|'hidden'|'text'|'actions'|'avatar'|'field'|'timeline';text:string};
export type Customisation={props:Record<string,unknown>;slots:Record<string,SlotChoice>;callbacks:Record<string,'example'|'record'|'off'>};
export const contracts=manifest as unknown as Record<string,{path:string;props:PropContract[]}>;
export const emptyCustomisation=():Customisation=>({props:{},slots:{},callbacks:{}});
export function handlerMode(name:string,prop:PropContract,custom:Customisation) {
 return custom.callbacks[prop.name]??(!prop.optional||({Button:['onclick'],FormActions:['cancel'],PlaybackTimeline:['onseek'],Pagination:['onchange'],Toast:['onaction','ondismiss']} as Record<string,string[]>)[name]?.includes(prop.name)?'example':'off');
}
export function defaultSlot(name:string,prop:PropContract):SlotChoice {
 const slots:Record<string,Record<string,SlotChoice>>={
  ActivityHeader:{trailing:{kind:'text',text:'12:34'}},
  DetailCard:{children:{kind:'text',text:'Existing detail-card content.'}},
  IdentityCard:{identity:{kind:'avatar',text:'Alice'},title:{kind:'text',text:'Alice'},details:{kind:'text',text:'Watching · Preview title'},actions:{kind:'actions',text:'Actions'}},
  PartyCard:{actions:{kind:'actions',text:'Party actions'},footer:{kind:'timeline',text:''},memberActions:{kind:'actions',text:'Member actions'}},
  Field:{children:{kind:'field',text:'Your display name'}},SettingsRow:{children:{kind:'field',text:'Enabled'}},FormActions:{children:{kind:'actions',text:'Save'}},
 };
 return slots[name]?.[prop.name]??{kind:prop.optional?'hidden':'text',text:'Preview content'};
}
const friend={id,userId:id,username:'Alice',state:'accepted',requestedBy:id,avatar:null,canCompare:true,activityStatus:'online',backgroundArtwork:movie.backdrop};
const members=[{userId:id,username:'Alice',avatar:null,joined:true,buffering:false,online:true,ready:true,unavailable:false},{userId:'preview-bob',username:'Bob',avatar:null,joined:false,buffering:false,online:false,ready:false,unavailable:false}];
const room={id,createdAt:today+'T18:00:00Z',hostId:id,mediaId:movie.id,mediaType:'video',edition:'',durationSeconds:6600,positionSeconds:1800,paused:true,bufferingPaused:false,bufferingPolicy:'together',settings:defaultPartySettings,queue:[],queueIndex:0,queueItems:[],revision:1,updatedAt:today+'T18:00:00Z',serverTime:today+'T18:00:00Z',ended:false,participants:members};

const choices=[{value:'all',label:'All'},{value:'saved',label:'Saved'},{value:'watching',label:'Watching'}];
const examples:Record<string,Record<string,unknown>>={
  AccountFields:{},Avatar:{name:'Alice',size:64},AvatarPicker:{name:'Alice',avatar:null,reading:false,disabled:false,choices:[{id,provider:'jellyfin',name:'Preview Jellyfin'}]},
  ActivityHeader:{username:'Alice',avatar:null,status:'online',showAvatar:true,nonApproved:false},
  Brand:{compact:false,size:44},Button:{text:'Play',icon:'play',label:'Play',emphasis:'standard',size:'standard'},
  ChoiceGroup:{label:'Status',value:'all',options:choices},
  CollectionProjectionSettings:{connectionId:id,settings:{collectionProjection:{enabled:false,source:'collected'}},sources:[{id,name:'Preview library'}]},
  ConflictList:{conflicts:[{id,mediaId:id,title:movie.title,source:'Jellyfin',action:'watched',value:true,positionSeconds:null,durationSeconds:null,occurredAt:today,reason:'Different watch states',localValue:{value:false},remoteValue:{value:true}}]},
  ConnectionCard:{provider:{id,name:provider.name,provider:'jellyfin',configured:true,connection:{id,username:'preview',status:'connected',settings:{}}},sources:[{id,name:'Preview library'}],dynamicCollectionExports:[]},
  DetailOverlay:{open:false,editions:[{value:'theatrical',label:'Theatrical'},{value:'extended',label:'Extended Edition'}],editionName:'theatrical'},DetailCard:{title:'Detail card',description:'Supporting information'},Dialog:{open:false,title:'Preview dialog',message:'An isolated dialog'},EmptyState:{title:'Nothing here yet',description:'Items appear here when you add them.',icon:'library'},
  FactList:{items:facts},Field:{label:'Display name',hint:'Preview input'},FormActions:{},FriendRoster:{friends:[friend],userId:id,busy:false,inviteDisabled:false},FriendsPanel:{open:false,initialView:'accepted'},
  Header:{user:{username:'preview',role:'admin'},unread:2,friendRequests:1,publicBrowse:false},Heading:{title:'Stories to explore',description:'A little more to discover.',variant:'row',level:2},
  Icon:{name:'play',size:32,filled:true},IdentityCard:{label:'Identity preview',background:movie.backdrop,progress:.42,wrapActions:false},
  IntegrationSettings:{providers:[provider],experimentalGaming:true,experimentalComics:true},JobSchedule:{provider,task:serviceTasks('jellyfin')[0],jobs:[job],local:false,showSource:true},JobsSettings:{providers:[provider],actions:[job],tasteJob:null},
  MediaActivity:{mediaId:id,period:'month'},MediaCard:{item:movie,shape:'fanart',artworkStyle:'auto',overlay:'none',showCaption:true,showPrimaryAction:true},MediaDetailRows:{model:{insights:{selection:'overview',tabs:[{value:'overview',label:'Overview',panels:[{title:'About',content:{kind:'text',text:show.overview||'About this title'}}]}]}}},MediaDetails:{view:{item:movie},model:{insights:{selection:'overview',tabs:[{value:'overview',label:'Overview',panels:[{title:'About',content:{kind:'text',text:movie.overview||'About this title'}}]}]}}},
  MediaHero:{item:movie,mode:'content',context:'details',alignment:'left',requestable:false},MediaPage:{item:movie,details:true,hero:true,sections:[{key:'related',title:'Related titles',items}]},
  MetadataEditor:{open:false,mediaId:id,admin:false},MetricGrid:{items:[{label:'Watches',value:12},{label:'Hours',value:34},{label:'Status',value:'Watching',text:true}]},
  NotificationInbox:{open:false,initialKind:'all',initialFilters:defaultNotificationFilters},NotificationToasts:{notifications:[{id,title:'Your title is ready',body:'Available from your connected library.',level:'persistent',readAt:null,createdAt:today+'T18:00:00Z'}]},
  OperationProgress:{label:'Importing history',processed:42,total:100},Pagination:{page:1,pages:5,label:'Preview pages',busy:false},PartyCard:{label:'Party preview',background:movie.backdrop,members,inParty:true,embedded:false},PartyMenu:{demoRoom:room,demoUserId:id},
  PersistentPlayer:{},PlaybackTimeline:{mediaId:id,title:movie.title,detail:'2026 · Movie',artwork:movie.poster,current:1800,duration:6600,audio:false,disabled:false,readingActive:false,scrubbing:false},
  ProfileEditor:{open:false,username:'preview',profile:{displayName:'Preview profile',bio:'Stories, music and everything in between.'}},ProfileFeatureEditor:{open:false,mediaId:id,title:movie.title,note:'A favourite story'},
  ProfileRecap:{subject:'you',movies:8,episodes:14,seasons:2,previousCount:17,period:'month'},ProgressBar:{progress:.42,label:'Progress'},ProviderAutomation:{instance:{...provider,schedule:providerSchedule('jellyfin')}},
  QueueList:{actions:[job],emptyTitle:'No queued jobs',emptyDescription:'Work appears here when queued.'},TextLink:{href:`/media/${id}`,text:'Preview title'},Rating:{mediaId:id,value:4},ReactionActions:{targetId:id,targetKind:'work',disabled:false,initialReaction:null},RecommendAction:{workId:id,disabled:false},
  RequestDialog:{open:false,item:movie,initial4k:false,options:[{id,name:'Preview request server',variants:{standard:{serverId:1,requestable:true,seasons:[]},fourK:{serverId:2,requestable:true,seasons:[]}}}]},
  RowFilter:{label:'Filters',selection:false,submenus:false,icon:'filter',groups:[{label:'Selection',value:'all',options:choices}]},RowStyleMenu:{title:'Preview row',artworkOptions:true,mediaKind:'screen',overridePriority:null,overrideShape:null,overrideArtwork:null,overrideOverlay:null},
  SegmentedControl:{label:'Preview segments',options:choices,value:'all'},SettingsRow:{title:'Social',description:'Friends, recommendations and shared activities.'},
  Shelf:{title:'Your next favourites',items,shape:'poster',layout:'row',artworkOptions:true,hideEmpty:false,enrichSocial:false},SocialControls:{friends:[{username:'Alice',status:'online'},{username:'Sam',status:'away'},{username:'Taylor',status:'busy'}],total:7,showOverflow:true,size:32},
  StreamsPanel:{open:false,initialView:'now'},SyncedControls:{inline:false,embedded:false},Toast:{text:'Changes saved.',description:'Preview only',kind:'info',busy:false,actionLabel:'Undo'},
  WorkActions:{section:'social',workId:id,disabled:false,rating:4,controls:[{item:true,text:'Add to Collection',icon:'plus'}],recommendationIds:[]},WorkListActions:{workId:id,reading:false,disabled:false},WorkMenu:{item:movie,context:'discover',showTrigger:true,hero:false,menuOnly:false,requestable:false},
 };
/** Synthetic inputs for real components. Clone only the selected fixture. */
export function specimenDefaults(name:string):Record<string,unknown> {
 if(!Object.hasOwn(examples,name))throw new Error(`Missing component fixture: ${name}`);
 return structuredClone(examples[name]);
}

export function dataSample(name:string,prop:PropContract):unknown {
 const sample=specimenDefaults(name)[prop.name];if(sample!==undefined)return sample;
 if(prop.name==='item'||prop.name==='next')return movie;
 if(prop.name==='items'||prop.name==='parents'||prop.name==='members')return items;
 if(prop.name==='social')return {friends:[{username:'Alice',status:'online'}],total:1};
 if(prop.name==='reading')return {format:'cbz',page:12,total:32};
 if(prop.name==='footerLink'||prop.name==='back')return {href:'#',label:'View all'};
 if(prop.name==='collection')return {items,selection:'preview'};
 if(prop.name==='source')return {type:'library',surface:'watch',collection:false};
 if(prop.name==='journal')return {runs:[],selection:false};
 if(prop.name==='content')return {kind:'text',text:'Supporting information',muted:false};
 if(prop.name==='selection')return {label:'Selection',value:'all',options:[{value:'all',label:'All'},{value:'saved',label:'Saved'}]};
 if(prop.name==='gameState')return {item:movie,playthroughs:[],selected:null};
 if(prop.name==='readingState')return null;
 if(prop.name==='timing')return name==='JobsSettings'?[]:null;
 if(prop.type.includes('[]')||prop.type==='T[]')return [];
 return {};
}

/** Reject the wrong container before it can reach the component; the boundary handles domain constraints. */
export function parseData(text:string,prop:PropContract) {
 const value=JSON.parse(text);
 if(value===null){if(!prop.nullable)throw new Error('This prop does not accept null.');return value;}
 const array=/\[\]$/.test(prop.type.trim())||prop.type==='T[]';
 if(array?!Array.isArray(value):typeof value!=='object'||Array.isArray(value))throw new Error(array?'Enter a JSON array.':'Enter a JSON object.');
 return value;
}
export function propLabel(name:string) {return name.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,letter=>letter.toUpperCase());}
