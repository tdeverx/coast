<script lang="ts">
  import RowFilter from '#lib/ui/components/RowFilter.svelte';
  import { libraryGenres, librarySegments, librarySelections, librarySortOptions, libraryTitles, type LibrarySurface } from '#lib/library.js';
  import { progressTabs } from '#lib/progress.js';
  import { activityAudienceOptions, activityTypeOptions, workFriendOptions } from '#lib/social/model.js';
  import { shelfControls } from '#lib/ui/shelves/controls.js';
  import type { MenuConditions } from '#lib/ui/controls/menu-preview.js';
  import type { ShelfControl } from '#lib/ui/shelves/types.js';
  let { filters, medium, values, context='general' }: { filters: 'library' | 'rows'; medium: LibrarySurface | 'all'; values: MenuConditions; context?:string } = $props();
  let selected = $state<Record<string, string>>({});
  const isLibrary = $derived(filters === 'library');
  const available = {all:'Available only',watch:'Available to watch',listen:'Available to listen',play:'Owned',read:'Available to read'};
  const all={value:'all',label:'All'};
  const pick = (label:string,options:ShelfControl['options'],section:ShelfControl['section']='content'):ShelfControl => ({
    type:'select',section,label,options,value:selected[label] ?? options?.[0]?.value ?? 'all',change:value=>{selected[label]=value;},
  });
  const controls=$derived.by(():ShelfControl[]=>{
    const typeOptions=medium==='watch'?[{value:'movie',label:'Movies'},{value:'show',label:'Shows'},{value:'collection',label:'Box sets'},...(!isLibrary?[{value:'episode',label:'Episodes'},{value:'season',label:'Seasons'}]:[])]
      :medium==='listen'?[{value:'album',label:'Albums'},{value:'track',label:'Tracks'},{value:'artist',label:'Artists'},{value:'playlist',label:'Playlists'}]
      :medium==='read'?[{value:'book',label:'Books'},{value:'comic',label:'Comics'},{value:'series',label:'Series'}]:[];
    const statusLabel=medium==='watch'?'Watch status':medium==='play'?'Playthrough status':'Reading status';
    const result:ShelfControl[]=[];
    if(typeOptions.length)result.push(pick(medium==='read'?'Reading type':'Media type',[{value:'all',label:'All media'},...(context==='requests'?typeOptions.filter(option=>option.value==='movie'||option.value==='show'):typeOptions)]));
    if(medium==='all')result.push(pick('Medium',[{value:'all',label:'All media'},...Object.entries(libraryTitles).map(([value,label])=>({value,label}))]));
    if(isLibrary){
      if(values.status && medium!=='all' && medium!=='listen')result.push(pick(statusLabel,librarySelections[medium]));
      if(values.genre && medium==='watch')result.push(pick('Genre',[{value:'all',label:'All genres'},...libraryGenres.map(label=>({value:label,label}))]));
      result.push(pick(values.collectionView?'Relationships':'Saved',values.collectionView?[{value:'all',label:'All relationships'},{value:'collected',label:'Collected'},{value:'watchlist',label:'Later'},{value:'favourite',label:'Favourites'},{value:'rating',label:'Rated'},{value:'list',label:'Lists'},...(medium!=='read'?[{value:'queue',label:'Queued'}]:[]),{value:'activity',label:'Activity'}]:librarySegments.filter(option=>['all','later','favourites'].includes(option.value))));
      if(values.available)result.push(values.collectionView?pick('Availability',[{value:'all',label:'All availability'},{value:'available',label:available[medium]},...(medium!=='read'?[{value:'partial',label:'Partial'},{value:'unavailable',label:'Missing'}]:[]),{value:'unknown',label:'Unknown'},{value:'ready',label:'Ready to continue'}],'access'):{...pick(available[medium],undefined,'access'),type:'availability'});
      if(values.source)result.push(pick('Sources',[{value:'all',label:'All sources'},{value:'home',label:'Preview Jellyfin'},{value:'archive',label:'Preview archive'}],'access'));
      result.push(pick('Sort by',librarySortOptions,'order'));
    }else{
      if(['episodes','seasons'].includes(context)&&medium==='watch')result.push(pick('Watch status',[all,{value:'unwatched',label:'Unwatched'},{value:'watched',label:'Watched'}]));
      if(context==='episodes'&&medium==='watch')result.push({...pick('Show specials',[all,{value:'show',label:'Show'}]),type:'select'});
      if(context==='credits')result.push(pick('Department',[all,...['Acting','Directing','Writing'].map(label=>({value:label,label}))]));
      if(context==='progress')result.push(pick('Progress',[all,...(medium==='watch'||medium==='all'?progressTabs:librarySelections[medium])]));
      if(values.available)result.push({...pick(available[medium],undefined,'access'),type:'availability'});
      if(values.collection)result.push({...pick('In my Collection',undefined,'access'),type:'collection'});
      if(context==='activity')result.push(pick('Audience',activityAudienceOptions,'activity'),pick('Activity type',activityTypeOptions(medium==='watch'?'screen':medium==='listen'?'music':medium==='read'?'reading':medium==='play'?'game':'all'),'activity'));
      if(context==='title-activity')result.push(pick('Activity',workFriendOptions(medium==='read'?'book':medium==='play'?'game':medium==='listen'?'track':'movie'),'activity'));
      if(['activity','statistics'].includes(context))result.push(pick('Time period',[{value:'all',label:'All time'},{value:'month',label:'Past month'},{value:'year',label:'Past year'}],'activity'));
      if(context==='community'&&medium==='watch')result.push(pick('Community source',[all,{value:'tmdb',label:'TMDB'},{value:'trakt',label:'Trakt'}],'activity'));
    }
    return result;
  });
  const groups=$derived(shelfControls(controls,(control,value)=>control.change(value)).groups.map(group=>group.label==='Show specials'?{...group,presentation:'checkbox' as const}:group));
  const modified=$derived(controls.some(control=>control.value!==(control.options?.[0]?.value??'all')));
</script>
<RowFilter {groups} reset={{disabled:!modified,run:()=>{selected={};}}} />
