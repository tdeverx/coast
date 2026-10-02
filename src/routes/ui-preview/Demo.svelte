<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { page } from '$app/state';
  import type { IconName } from '$lib/ui/components/Icon.svelte';
  import type { MediaCardShape } from '$lib/ui/types';
  import { serviceTasks } from '$lib/providers/tasks';
  import { liquidGlass } from '$lib/ui/materials/glass';
  import { providePreviewPlayback } from '$lib/playback/context.svelte';
  const { player } = providePreviewPlayback();
  import { id,today,movie,show,episode,items,facts,chart,days,journal,provider,job,music,track,actionData } from './demo/fixtures';
  let AddTitle = $state<typeof import('$lib/ui/components/AddTitle.svelte').default>(null!);
  let AvailabilityToggle = $state<typeof import('$lib/ui/components/AvailabilityToggle.svelte').default>(null!);
  let BarChart = $state<typeof import('$lib/ui/components/BarChart.svelte').default>(null!);
  let Brand = $state<typeof import('$lib/ui/components/Brand.svelte').default>(null!);
  let BreakdownChart = $state<typeof import('$lib/ui/components/BreakdownChart.svelte').default>(null!);
  let Button = $state<typeof import('$lib/ui/components/Button.svelte').default>(null!);
  let CollectionProjectionSettings = $state<typeof import('$lib/ui/components/CollectionProjectionSettings.svelte').default>(null!);
  let ConflictList = $state<typeof import('$lib/ui/components/ConflictList.svelte').default>(null!);
  let ConnectionCard = $state<typeof import('$lib/ui/components/ConnectionCard.svelte').default>(null!);
  let ContextMenu = $state<typeof import('$lib/ui/components/ContextMenu.svelte').default>(null!);
  let DetailCard = $state<typeof import('$lib/ui/components/DetailCard.svelte').default>(null!);
  let Dialog = $state<typeof import('$lib/ui/components/Dialog.svelte').default>(null!);
  let EmptyState = $state<typeof import('$lib/ui/components/EmptyState.svelte').default>(null!);
  let FactList = $state<typeof import('$lib/ui/components/FactList.svelte').default>(null!);
  let Header = $state<typeof import('$lib/ui/components/Header.svelte').default>(null!);
  let Icon = $state<typeof import('$lib/ui/components/Icon.svelte').default>(null!);
  let IntegrationSettings = $state<typeof import('$lib/ui/components/IntegrationSettings.svelte').default>(null!);
  let JobSchedule = $state<typeof import('$lib/ui/components/JobSchedule.svelte').default>(null!);
  let JobsSettings = $state<typeof import('$lib/ui/components/JobsSettings.svelte').default>(null!);
  let MediaActions = $state<typeof import('$lib/ui/components/MediaActions.svelte').default>(null!);
  let MediaActivity = $state<typeof import('$lib/ui/components/MediaActivity.svelte').default>(null!);
  let MediaCard = $state<typeof import('$lib/ui/components/MediaCard.svelte').default>(null!);
  let MediaDetailRows = $state<typeof import('$lib/ui/components/MediaDetailRows.svelte').default>(null!);
  let MediaHero = $state<typeof import('$lib/ui/components/MediaHero.svelte').default>(null!);
  let MediaRequestMenu = $state<typeof import('$lib/ui/components/MediaRequestMenu.svelte').default>(null!);
  let MenuAction = $state<typeof import('$lib/ui/components/MenuAction.svelte').default>(null!);
  let MetadataEditor = $state<typeof import('$lib/ui/components/MetadataEditor.svelte').default>(null!);
  let MetricGrid = $state<typeof import('$lib/ui/components/MetricGrid.svelte').default>(null!);
  let NotificationToasts = $state<typeof import('$lib/ui/components/NotificationToasts.svelte').default>(null!);
  let Pagination = $state<typeof import('$lib/ui/components/Pagination.svelte').default>(null!);
  let PersistentPlayer = $state<typeof import('$lib/ui/components/PersistentPlayer.svelte').default>(null!);
  let PlaybackTimeline = $state<typeof import('$lib/ui/components/PlaybackTimeline.svelte').default>(null!);
  let PresentationActions = $state<typeof import('$lib/ui/components/PresentationActions.svelte').default>(null!);
  let ProfileEditor = $state<typeof import('$lib/ui/components/ProfileEditor.svelte').default>(null!);
  let ProfileFeatureEditor = $state<typeof import('$lib/ui/components/ProfileFeatureEditor.svelte').default>(null!);
  let ProfileRecap = $state<typeof import('$lib/ui/components/ProfileRecap.svelte').default>(null!);
  let ProgressChart = $state<typeof import('$lib/ui/components/ProgressChart.svelte').default>(null!);
  let ProviderAutomation = $state<typeof import('$lib/ui/components/ProviderAutomation.svelte').default>(null!);
  let QueueList = $state<typeof import('$lib/ui/components/QueueList.svelte').default>(null!);
  let Rating = $state<typeof import('$lib/ui/components/Rating.svelte').default>(null!);
  let RequestDialog = $state<typeof import('$lib/ui/components/RequestDialog.svelte').default>(null!);
  let RowFilter = $state<typeof import('$lib/ui/components/RowFilter.svelte').default>(null!);
  import { browseHeading } from '$lib/ui/headings';
  import { mediaTypeOptions } from '$lib/ui/filter-options';
  import { mediaOverviewPanels } from '$lib/ui/insights/media';
  import { profileActivityPanels, profileBreakdownPanels } from '$lib/ui/insights/profile';
  import { overviewPanels } from '$lib/ui/insights/overview';
  let Heading = $state<typeof import('$lib/ui/components/Heading.svelte').default>(null!);
  let RowStyleMenu = $state<typeof import('$lib/ui/components/RowStyleMenu.svelte').default>(null!);
  let SegmentedControl = $state<typeof import('$lib/ui/components/SegmentedControl.svelte').default>(null!);
  let SequenceControl = $state<typeof import('$lib/ui/components/SequenceControl.svelte').default>(null!);
  let RelationshipActions = $state<typeof import('$lib/ui/components/RelationshipActions.svelte').default>(null!);
  let ListMembershipActions = $state<typeof import('$lib/ui/components/ListMembershipActions.svelte').default>(null!);
  let RowFeedback = $state<typeof import('$lib/ui/components/RowFeedback.svelte').default>(null!);
  let MediaPage = $state<typeof import('$lib/ui/components/MediaPage.svelte').default>(null!);
  import { createMusicPage } from '$lib/ui/pages/music.svelte';
  import type { ComponentProps } from 'svelte';
  let RecommendAction = $state<typeof import('$lib/ui/components/RecommendAction.svelte').default>(null!);
  let ReactionActions = $state<typeof import('$lib/ui/components/ReactionActions.svelte').default>(null!);
  let SocialControls = $state<typeof import('$lib/ui/components/SocialControls.svelte').default>(null!);
  let SyncedControls = $state<typeof import('$lib/ui/components/SyncedControls.svelte').default>(null!);
  let syncedControls = $state<ReturnType<typeof SyncedControls>>();
  let Shelf = $state<typeof import('$lib/ui/components/Shelf.svelte').default>(null!);
  import type { ShelfConfig } from '$lib/ui/shelves';
  let { name, initialOpen = false }: { name: string; initialOpen?: boolean } = $props();
  let failure=$state(''),ready=$state(false),open=$state(untrack(() => initialOpen)),available=$state(false),number=$state(1),choice=$state('all'),position=$state(1800);
  let styleMenu = $state<ReturnType<typeof RowStyleMenu>>();
  let shelfExample = $state('cards');
  let pageExample = $state('screen');
  const musicPage = createMusicPage(() => ({ item: { ...music, workId: id }, connectionId: id, children: { items: [track], total: 1, nextOffset: null }, failure: '', page: 1, pages: 1 }), () => page.url);
  const pagePresentation = $derived<ComponentProps<typeof MediaPage>>(pageExample === 'music' ? musicPage.page : pageExample === 'collection'
    ? { collection: { items, selection: 'preview' }, context: 'home', sections: [{ key: 'titles', title: 'Your collection', items }] }
    : { details: true, item: movie, sections: [{ key: 'insights', title: 'Overview', panels: mediaOverviewPanels(movie) }, { key: 'related', title: 'Related titles', items }] });
  const shelfExamples: { value: string; label: string; description: string; source?: ShelfConfig }[] = [
    { value: 'cards', label: 'Cards', description: 'One row with local type and availability filters.' },
    { value: 'library', label: 'Library / Collection', description: 'The same shelf with a library source and server-backed filters.', source: { type: 'library', surface: 'watch', collection: true } },
    { value: 'progress', label: 'Progress', description: 'The same shelf with a progress source.', source: { type: 'progress' } },
    { value: 'list', label: 'Ordered list', description: 'The same shelf with list membership and ordering actions.', source: { type: 'list', title: 'Ordered list', view: id } },
    { value: 'credits', label: 'Person credits', description: 'The same shelf with credit filters and role details.', source: { type: 'credits', title: 'Person credits', personId: 1 } },
    { value: 'search', label: 'Search', description: 'The same shelf with search results.', source: { type: 'search', surface: 'watch', query: 'preview', items } },
    { value: 'journal', label: 'Grouped history', description: 'One shelf per activity group, using the same renderer.', source: { type: 'journal', items: journal, today } },
  ];
  const example = $derived(shelfExamples.find(option => option.value === shelfExample)!);
  function openStyleMenu() { styleMenu?.openAt({ x: 24, y: 84 }); }
  const options=[{value:'all',label:'All'},{value:'watching',label:'Watching'},{value:'completed',label:'Completed'}];
  const materials=[{variant:'clear',label:'Clear glass'},{variant:'clearBlur',label:'Blurred clear glass'},{variant:'glassLight',label:'Glass light'},{variant:'glassDark',label:'Glass dark'},{variant:'blurLight',label:'Blur light'},{variant:'blurDark',label:'Blur dark'}] as const;
  onMount(()=>{
    if(name==='PersistentPlayer' && !player.session){
      player.session={id,mediaId:id,mediaType:'audio',title:'Preview track',detail:'Preview artist · Preview album',artwork:'/coast-mark.png',url:'',kind:'direct',startSeconds:0,durationSeconds:240,provider:'Preview',defaultSubtitleIndex:null,subtitlePrompt:false,subtitles:[],sources:[]};
      player.role='playback';player.paused=true;
    }



  });

  const loaders = import.meta.glob<{default: any}>('/src/lib/ui/components/*.svelte');
  const recipes: Record<string,string[]> = {"RecommendAction": ["Button", "ContextMenu", "RecommendAction"], "ReactionActions": ["Button", "ReactionActions"], "SocialControls": ["Button", "SocialControls"], "SyncedControls": ["Button", "SyncedControls"], "Glass": ["Button"], "AddTitle": ["AddTitle", "Button"], "AvailabilityToggle": ["AvailabilityToggle", "Button"], "BarChart": ["BarChart", "Button"], "Brand": ["Brand", "Button"], "BreakdownChart": ["BreakdownChart", "Button"], "Button": ["Button"], "CollectionProjectionSettings": ["Button", "CollectionProjectionSettings"], "ConflictList": ["Button", "ConflictList"], "ConnectionCard": ["Button", "ConnectionCard"], "ContextMenu": ["Button", "ContextMenu", "MenuAction"], "DetailCard": ["Button", "DetailCard", "Shelf"], "Dialog": ["Button", "Dialog"], "EmptyState": ["Button", "EmptyState"], "FactList": ["Button", "FactList"], "Heading": ["AvailabilityToggle", "Button", "Heading", "Pagination"], "Header": ["Button", "Header"], "Icon": ["Button", "Icon"], "IntegrationSettings": ["Button", "IntegrationSettings"], "JobSchedule": ["Button", "JobSchedule"], "JobsSettings": ["Button", "JobsSettings"], "MediaActions": ["Button", "MediaActions"], "MediaActivity": ["Button", "MediaActivity"], "MediaCard": ["Button", "MediaCard"], "MediaDetailRows": ["Button", "MediaDetailRows"], "MediaPage": ["Button", "MediaPage", "RowFilter"], "MediaHero": ["Button", "MediaHero"], "MediaRequestMenu": ["Button", "ContextMenu", "MediaRequestMenu"], "MenuAction": ["Button", "MenuAction"], "MetadataEditor": ["Button", "MetadataEditor"], "MetricGrid": ["Button", "MetricGrid"], "NotificationToasts": ["Button", "NotificationToasts"], "Pagination": ["Button", "Pagination"], "PersistentPlayer": ["Button", "PersistentPlayer"], "PlaybackTimeline": ["Button", "PlaybackTimeline"], "PresentationActions": ["Button", "PresentationActions"], "ProfileEditor": ["Button", "ProfileEditor"], "ProfileFeatureEditor": ["Button", "ProfileFeatureEditor"], "ProfileRecap": ["Button", "ProfileRecap"], "ProgressChart": ["Button", "ProgressChart"], "ProviderAutomation": ["Button", "ProviderAutomation"], "QueueList": ["Button", "QueueList"], "Rating": ["Button", "Rating"], "RequestDialog": ["Button", "RequestDialog"], "RowFilter": ["Button", "RowFilter"], "RowStyleMenu": ["Button", "RowStyleMenu"], "SegmentedControl": ["Button", "SegmentedControl"], "SequenceControl": ["Button", "SequenceControl"], "RelationshipActions": ["Button", "ContextMenu", "RelationshipActions"], "ListMembershipActions": ["Button", "ContextMenu", "ListMembershipActions"], "RowFeedback": ["Button", "RowFeedback"], "Shelf": ["Button", "RowFilter", "Shelf"]};
  $effect(() => {
    const selected = name;
    ready = false;
    failure = '';
    let cancelled = false;
    void Promise.all((recipes[selected] ?? []).map(async component => {
      const module = await loaders[`/src/lib/ui/components/${component}.svelte`]();
      if (cancelled) return;
      switch(component) {
        case 'AddTitle': AddTitle = module.default; break;
        case 'AvailabilityToggle': AvailabilityToggle = module.default; break;
        case 'BarChart': BarChart = module.default; break;
        case 'Brand': Brand = module.default; break;
        case 'BreakdownChart': BreakdownChart = module.default; break;
        case 'Button': Button = module.default; break;
        case 'CollectionProjectionSettings': CollectionProjectionSettings = module.default; break;
        case 'ConflictList': ConflictList = module.default; break;
        case 'ConnectionCard': ConnectionCard = module.default; break;
        case 'ContextMenu': ContextMenu = module.default; break;
        case 'DetailCard': DetailCard = module.default; break;
        case 'Dialog': Dialog = module.default; break;
        case 'EmptyState': EmptyState = module.default; break;
        case 'FactList': FactList = module.default; break;
        case 'Header': Header = module.default; break;
        case 'Icon': Icon = module.default; break;
        case 'IntegrationSettings': IntegrationSettings = module.default; break;
        case 'JobSchedule': JobSchedule = module.default; break;
        case 'JobsSettings': JobsSettings = module.default; break;
        case 'MediaActions': MediaActions = module.default; break;
        case 'MediaActivity': MediaActivity = module.default; break;
        case 'MediaCard': MediaCard = module.default; break;
        case 'MediaDetailRows': MediaDetailRows = module.default; break;
        case 'MediaHero': MediaHero = module.default; break;
        case 'MediaRequestMenu': MediaRequestMenu = module.default; break;
        case 'MenuAction': MenuAction = module.default; break;
        case 'MetadataEditor': MetadataEditor = module.default; break;
        case 'MetricGrid': MetricGrid = module.default; break;
        case 'NotificationToasts': NotificationToasts = module.default; break;
        case 'Pagination': Pagination = module.default; break;
        case 'PersistentPlayer': PersistentPlayer = module.default; break;
        case 'PlaybackTimeline': PlaybackTimeline = module.default; break;
        case 'PresentationActions': PresentationActions = module.default; break;
        case 'ProfileEditor': ProfileEditor = module.default; break;
        case 'ProfileFeatureEditor': ProfileFeatureEditor = module.default; break;
        case 'ProfileRecap': ProfileRecap = module.default; break;
        case 'ProgressChart': ProgressChart = module.default; break;
        case 'ProviderAutomation': ProviderAutomation = module.default; break;
        case 'QueueList': QueueList = module.default; break;
        case 'Rating': Rating = module.default; break;
        case 'RequestDialog': RequestDialog = module.default; break;
        case 'RowFilter': RowFilter = module.default; break;
        case 'Heading': Heading = module.default; break;
        case 'RowStyleMenu': RowStyleMenu = module.default; break;
        case 'SegmentedControl': SegmentedControl = module.default; break;
        case 'SequenceControl': SequenceControl = module.default; break;
        case 'RelationshipActions': RelationshipActions = module.default; break;
        case 'ListMembershipActions': ListMembershipActions = module.default; break;
        case 'RowFeedback': RowFeedback = module.default; break;
        case 'MediaPage': MediaPage = module.default; break;
        case 'RecommendAction': RecommendAction = module.default; break;
        case 'ReactionActions': ReactionActions = module.default; break;
        case 'SocialControls': SocialControls = module.default; break;
        case 'SyncedControls': SyncedControls = module.default; break;
        case 'Shelf': Shelf = module.default; break;
      }
    })).then(() => { if(!cancelled) ready = true; }).catch(error => { if(!cancelled) failure = error instanceof Error ? error.message : 'Preview could not load.'; });
    return () => { cancelled = true; };
  });
  $effect(() => {
    if (ready && name === 'RowStyleMenu' && initialOpen) void tick().then(openStyleMenu);
  });
</script>


<div class="demo" onclickcapture={event => { const link = (event.target as Element).closest('a'); if(link && !link.hasAttribute('data-preview-navigation'))event.preventDefault(); }} class:header-demo={name==='Header'}>
  {#if failure}<p role="alert">{failure}</p>{/if}
  {#if ready}
    {#if ['AddTitle','Dialog','MetadataEditor','ProfileEditor','ProfileFeatureEditor','RequestDialog'].includes(name)}
      <Button variant="secondary" onclick={() => open = true}>Open example</Button>
    {/if}
    {#if name==='RecommendAction'}<ContextMenu label="Media actions"><RecommendAction workId={id} /></ContextMenu>
    {:else if name==='ReactionActions'}<ReactionActions targetId={id} />
    {:else if name==='SocialControls'}<SocialControls friends={[{username:'Alice'},{username:'Sam'},{username:'Taylor'}]} total={7} />
    {:else if name==='SyncedControls'}
      <p class="small">Experimental. Start playback to open the session controls.</p>
      <Button variant="secondary" disabled={!player.session} onclick={() => syncedControls?.show()}>Open session controls</Button>
      <SyncedControls bind:this={syncedControls} />
    {:else if name==='Glass'}
      <div class="glass-samples">{#each materials as material}<div class="glass glass-sample" class:light={material.variant==='glassLight'||material.variant==='blurLight'} use:liquidGlass={{variant:material.variant}}><strong>{material.label}</strong><span>Existing glass material</span></div>{/each}</div>
    {:else if name==='AddTitle'}
      <AddTitle bind:open />
    {:else if name==='AvailabilityToggle'}
      <AvailabilityToggle value={available} onchange={(value)=>available=value} />
    {:else if name==='BarChart'}
      <BarChart items={chart} label="Demo activity" summary="25 watches" caption="Demo data" axis />
    {:else if name==='Brand'}
      <Brand /><Brand compact size={44} />
    {:else if name==='BreakdownChart'}
      <BreakdownChart items={chart} label="Demo breakdown" centre="25" unit="watches" />
    {:else if name==='Button'}
      <div class="row"><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Danger</Button><Button variant="hero" icon="play">Glass</Button></div>
    {:else if name==='CollectionProjectionSettings'}
      <CollectionProjectionSettings connectionId={id} settings={{collectionProjection:{enabled:false,source:"collected"}}} sources={[{id,name:"Preview server"}]} />
    {:else if name==='ConflictList'}
      <ConflictList conflicts={[{id,mediaId:id,title:movie.title,source:"Jellyfin",action:"watched",value:true,positionSeconds:null,durationSeconds:null,occurredAt:today,reason:"Demo conflicting watch state",localValue:{value:false},remoteValue:{value:true}}]} />
    {:else if name==='ConnectionCard'}
      <ConnectionCard provider={{id,name:provider.name,provider:"jellyfin",configured:true,connection:{id,username:"preview",status:"connected",settings:{}}}} />
    {:else if name==='ContextMenu'}
      <ContextMenu label="Open context menu"><MenuAction icon="heart">Favourite</MenuAction><MenuAction icon="bookmark" checked>Watchlist</MenuAction><MenuAction icon="close" danger>Remove</MenuAction></ContextMenu>
    {:else if name==='DetailCard'}
      <DetailCard title="Detail card" description="Optional description"><p>Existing detail card body.</p>{#snippet footer()}Supporting footer{/snippet}</DetailCard>
      <Shelf title="Media insights" size="panel" panels={mediaOverviewPanels(movie)} />
      <Shelf title="Profile insights" size="panel" panels={[...profileActivityPanels(days,today,'month'),...profileBreakdownPanels([{name:'Drama',count:8,filter:'Drama'}],[{value:4,count:6}],'month')]} />
      <Shelf title="Metadata overview" size="panel" artworkOptions={false} panels={overviewPanels('Demo overview.',facts)} />
    {:else if name==='Dialog'}
      <Dialog bind:open title="Preview dialog"><p>Existing dialog with scrolling and focus management.</p><Button onclick={()=>open=false}>Close</Button></Dialog>
    {:else if name==='EmptyState'}
      <EmptyState title="Nothing here yet" description="Items will appear here when you add them." />
    {:else if name==='FactList'}
      <FactList items={facts} />
    {:else if name==='Heading'}
      <Heading variant="page" title="Page heading" description="Optional description for this page." />
      <Heading title="Row heading" href="#">{#snippet filters()}<AvailabilityToggle onchange={()=>{}} />{/snippet}{#snippet navigation()}<Pagination page={number} pages={5} onchange={(value)=>number=value} label="Row pages" />{/snippet}</Heading>
      <Heading variant="title" title="Title only" href="#" />
      <Heading {...browseHeading('watch',true)} />
    {:else if name==='Header'}
      <Header user={{username:"preview",role:"admin"}} unread={2} />
    {:else if name==='Icon'}
      <div class="row">{#each ["play","pause","heart","star","bookmark","filter","user","library","search","more","left","right","settings","volume"] as name}<div class="icon-sample"><Icon name={name as IconName} /><small>{name}</small></div>{/each}</div>
    {:else if name==='IntegrationSettings'}
      <IntegrationSettings providers={[provider]} experimentalFeatures />
    {:else if name==='JobSchedule'}
      <JobSchedule {provider} task={serviceTasks("jellyfin")[0]} jobs={[job]} />
    {:else if name==='JobsSettings'}
      <JobsSettings providers={[provider]} actions={[job]} />
    {:else if name==='MediaActions'}
      <MediaActions item={movie} showMenuTrigger />
    {:else if name==='MediaActivity'}
      <MediaActivity mediaId={id} period="month" />
    {:else if name==='MediaCard'}
      <div class="card-examples">{#each ["poster","square","fanart","banner"] as shape}<div><MediaCard item={movie} shape={shape as MediaCardShape} /><small>{shape}</small></div>{/each}</div>
    {:else if name==='MediaDetailRows'}
      <MediaDetailRows item={show} members={[episode]} />
    {:else if name==='MediaPage'}
      <RowFilter label="Page example" value={pageExample} options={[{value:'screen',label:'Film / TV'},{value:'music',label:'Music'},{value:'collection',label:'Collection'}]} onchange={value => { pageExample = value; }} />
      {#key pageExample}<MediaPage {...pagePresentation} />{/key}
    {:else if name==='MediaHero'}
      <MediaHero item={movie} />
    {:else if name==='MediaRequestMenu'}
      <ContextMenu label="Request menu"><MediaRequestMenu item={movie} data={{...actionData,requests:[{id,state:"pending",seasons:[],destination:"Preview",is4k:false,canCancel:true,canApprove:false,canDecline:false}]}} busy={false} loading={false} error="" onrequest={()=>{}} onmanage={()=>{}} /></ContextMenu>
    {:else if name==='MenuAction'}
      <div class="menu-sample"><MenuAction icon="heart">Favourite</MenuAction><MenuAction icon="check" checked>Selected</MenuAction><MenuAction icon="close" danger>Remove</MenuAction><MenuAction disabled disabledReason="Unavailable in preview">Disabled</MenuAction></div>
    {:else if name==='MetadataEditor'}
      <MetadataEditor bind:open mediaId={id} admin />
    {:else if name==='MetricGrid'}
      <MetricGrid items={[{label:"Watches",value:12},{label:"Hours",value:34},{label:"Status",value:"Watching",text:true}]} />
    {:else if name==='NotificationToasts'}
      <NotificationToasts notifications={[{id,title:"Preview notification",body:"Demo notification; nothing has changed.",level:"persistent",readAt:null,createdAt:today}]} />
    {:else if name==='Pagination'}
      <Pagination page={number} pages={5} onchange={(value)=>number=value} label="Preview pages" />
    {:else if name==='PersistentPlayer'}
      <fieldset disabled><PersistentPlayer /></fieldset>
      {#if initialOpen}<p class="notice">The existing persistent controller is shown below in its idle audio state. No media or tracking is sent.</p>
      {:else}<p class="notice">This example uses an isolated preview playback session. Open its standalone example to test it.</p><a class="button secondary" href="/ui-preview/demo?component=PersistentPlayer" target="_blank" rel="noreferrer" data-preview-navigation>Open controller example</a>{/if}
    {:else if name==='PlaybackTimeline'}
      <PlaybackTimeline mediaId={id} title={movie.title} detail="2026 · Movie" current={position} duration={6600} onseek={(value)=>position=value} />
    {:else if name==='PresentationActions'}
      <PresentationActions item={{id,kind:"game",title:"Preview game",href:"#"}} />
    {:else if name==='ProfileEditor'}
      <ProfileEditor bind:open profile={{displayName:"Preview profile",bio:"A demo profile."}} username="preview" />
    {:else if name==='ProfileFeatureEditor'}
      <ProfileFeatureEditor bind:open mediaId={id} title={movie.title} note="A preview featured-title note." />
    {:else if name==='ProfileRecap'}
      <ProfileRecap movies={8} episodes={14} seasons={2} previousCount={17} period="month" />
    {:else if name==='ProgressChart'}
      <ProgressChart label="Preview progress" items={[{label:"Series one",value:3,total:8},{label:"Series two",value:5,total:10}]} />
    {:else if name==='ProviderAutomation'}
      <ProviderAutomation instance={provider} />
    {:else if name==='QueueList'}
      <QueueList actions={[job]} />
    {:else if name==='Rating'}
      <Rating mediaId={id} value={8} menu />
    {:else if name==='RequestDialog'}
      <RequestDialog bind:open item={movie} options={[]} />
    {:else if name==='RowFilter'}
      <RowFilter label="Media type" value="all" options={mediaTypeOptions(true)} /><RowFilter label="Preview filter" value={choice} options={options} onchange={(value)=>choice=value} />
    {:else if name==='RowStyleMenu'}
      <p class="small">Opened from a shelf heading by right-click, long-press or Shift+F10.</p>
      <Button variant="secondary" onclick={openStyleMenu}>Open style menu</Button>
      <RowStyleMenu bind:this={styleMenu} title="Preview row" />
    {:else if name==='SegmentedControl'}
      <SegmentedControl label="Preview segments" bind:value={choice} {options} />
    {:else if name==='SequenceControl'}
      <SequenceControl source={{kind:"playlist",id}} />
    {:else if name==='RelationshipActions'}
      <ContextMenu label="Relationships"><RelationshipActions items={[{kind:'collected',value:false,label:'Add to Collection',icon:'plus'},{kind:'favourite',value:true,label:'Remove from Favourites',icon:'heart'}]} onchange={()=>{}} /></ContextMenu>
    {:else if name==='ListMembershipActions'}
      <ContextMenu label="List membership"><ListMembershipActions lists={[{id,name:'Saved titles',playlist:false},{id:'playlist',name:'Queue',playlist:true}]} member={()=>true} onchange={()=>{}} /></ContextMenu>
    {:else if name==='RowFeedback'}
      <RowFeedback message="Loading titles…" /><RowFeedback error="A source is unavailable." retry={()=>{}} />
    {:else if name==='Shelf'}
      <RowFilter label="Shelf example" value={shelfExample} options={shelfExamples} onchange={value => { shelfExample = value; }} />
      <p class="small">{example.description}</p>
      {#key shelfExample}<Shelf title="Preview shelf" {items} source={example.source} filterBy={example.source ? 'none' : 'type'} />{/key}
    {/if}
  {/if}
</div>

<style>
  /* Fixed chrome stays within inline examples; dialogs open only on request. */
  .demo { padding:24px; position:relative; contain:layout paint; min-height:360px; }
  .header-demo { padding:0; }
  .demo :global(.row) { flex-wrap:wrap; }
  .demo :global(.content) { padding:24px; }
  .demo :global(.hero) { min-height:520px; }
  .card-examples { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:20px; }
  .icon-sample { display:grid; justify-items:center; gap:8px; padding:10px; }
  .menu-sample { max-width:320px; }
  .glass-samples { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:24px; padding:24px; background:linear-gradient(135deg,var(--surface-hover),var(--accent),var(--surface)); }
  .glass-sample { position:relative; min-height:100px; border-radius:18px; display:flex; flex-direction:column; justify-content:center; gap:8px; padding:20px; }
  .glass-sample.light { color:var(--canvas); }
  @media(max-width:600px) { .glass-samples { grid-template-columns:repeat(2,minmax(0,1fr)); gap:16px; padding:16px; } }
</style>
