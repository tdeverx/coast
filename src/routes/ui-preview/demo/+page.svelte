<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { page } from '$app/state';
  import type { IconName } from '$lib/ui/components/Icon.svelte';
  import type { MediaCardShape } from '$lib/ui/types';
  import { serviceTasks } from '$lib/providers/tasks';
  import { liquidGlass } from '$lib/ui/materials/glass';
  import { player } from '$lib/playback/client.svelte';
  import { id,today,movie,show,episode,items,facts,chart,days,journal,provider,job,music,track,actionData,installFixtures } from './fixtures';
  import AddTitle from '$lib/ui/components/AddTitle.svelte';
  import AvailabilityToggle from '$lib/ui/components/AvailabilityToggle.svelte';
  import BarChart from '$lib/ui/components/BarChart.svelte';
  import Brand from '$lib/ui/components/Brand.svelte';
  import BreakdownChart from '$lib/ui/components/BreakdownChart.svelte';
  import Button from '$lib/ui/components/Button.svelte';
  import CollectionProjectionSettings from '$lib/ui/components/CollectionProjectionSettings.svelte';
  import ConflictList from '$lib/ui/components/ConflictList.svelte';
  import ConnectionCard from '$lib/ui/components/ConnectionCard.svelte';
  import ContextMenu from '$lib/ui/components/ContextMenu.svelte';
  import DetailCard from '$lib/ui/components/DetailCard.svelte';
  import Dialog from '$lib/ui/components/Dialog.svelte';
  import EmptyState from '$lib/ui/components/EmptyState.svelte';
  import FactList from '$lib/ui/components/FactList.svelte';
  import Header from '$lib/ui/components/Header.svelte';
  import Icon from '$lib/ui/components/Icon.svelte';
  import IntegrationSettings from '$lib/ui/components/IntegrationSettings.svelte';
  import JobSchedule from '$lib/ui/components/JobSchedule.svelte';
  import JobsSettings from '$lib/ui/components/JobsSettings.svelte';
  import MediaActions from '$lib/ui/components/MediaActions.svelte';
  import MediaActivity from '$lib/ui/components/MediaActivity.svelte';
  import MediaCard from '$lib/ui/components/MediaCard.svelte';
  import MediaDetailRows from '$lib/ui/components/MediaDetailRows.svelte';
  import MediaHero from '$lib/ui/components/MediaHero.svelte';
  import MediaRequestMenu from '$lib/ui/components/MediaRequestMenu.svelte';
  import MenuAction from '$lib/ui/components/MenuAction.svelte';
  import MetadataEditor from '$lib/ui/components/MetadataEditor.svelte';
  import MetricGrid from '$lib/ui/components/MetricGrid.svelte';
  import NotificationToasts from '$lib/ui/components/NotificationToasts.svelte';
  import Pagination from '$lib/ui/components/Pagination.svelte';
  import PlaybackTimeline from '$lib/ui/components/PlaybackTimeline.svelte';
  import PresentationActions from '$lib/ui/components/PresentationActions.svelte';
  import ProfileEditor from '$lib/ui/components/ProfileEditor.svelte';
  import ProfileFeatureEditor from '$lib/ui/components/ProfileFeatureEditor.svelte';
  import ProfileRecap from '$lib/ui/components/ProfileRecap.svelte';
  import ProgressChart from '$lib/ui/components/ProgressChart.svelte';
  import ProviderAutomation from '$lib/ui/components/ProviderAutomation.svelte';
  import QueueList from '$lib/ui/components/QueueList.svelte';
  import Rating from '$lib/ui/components/Rating.svelte';
  import RequestDialog from '$lib/ui/components/RequestDialog.svelte';
  import RowFilter from '$lib/ui/components/RowFilter.svelte';
  import { browseHeading } from '$lib/ui/headings';
  import { mediaTypeOptions } from '$lib/ui/filter-options';
  import { mediaOverviewPanels } from '$lib/ui/insights/media';
  import { profileActivityPanels, profileBreakdownPanels } from '$lib/ui/insights/profile';
  import { overviewPanels } from '$lib/ui/insights/overview';
  import Heading from '$lib/ui/components/Heading.svelte';
  import RowStyleMenu from '$lib/ui/components/RowStyleMenu.svelte';
  import SegmentedControl from '$lib/ui/components/SegmentedControl.svelte';
  import SequenceControl from '$lib/ui/components/SequenceControl.svelte';
  import RelationshipActions from '$lib/ui/components/RelationshipActions.svelte';
  import ListMembershipActions from '$lib/ui/components/ListMembershipActions.svelte';
  import RowFeedback from '$lib/ui/components/RowFeedback.svelte';
  import MediaPage from '$lib/ui/components/MediaPage.svelte';
  import { createMusicPage } from '$lib/ui/pages/music.svelte';
  import type { ComponentProps } from 'svelte';
  import Shelf from '$lib/ui/components/Shelf.svelte';
  import type { ShelfConfig } from '$lib/ui/shelves';
  const name=$derived(page.url.searchParams.get('component')??'Button');
  let ready=$state(false),open=$state(true),available=$state(false),number=$state(1),choice=$state('all'),position=$state(1800);
  let styleMenu = $state<RowStyleMenu>();
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
    const restore=installFixtures();
    if(name==='PersistentPlayer'){
      player.session={id,mediaId:id,mediaType:'audio',title:'Preview track',detail:'Preview artist · Preview album',artwork:'/coast-mark.png',url:'',kind:'direct',startSeconds:0,durationSeconds:240,provider:'Preview',defaultSubtitleIndex:null,subtitlePrompt:false,subtitles:[],sources:[]};
      player.role='playback';player.paused=true;
    }
    ready=true;
    if (name === 'RowStyleMenu') void tick().then(() => requestAnimationFrame(openStyleMenu));
    return ()=>{player.session=null;player.role='idle';restore();};
  });
</script>

<svelte:head><title>{name} · UI preview</title></svelte:head>
<div class="demo" class:header-demo={name==='Header'}>
  {#if ready}
    {#if name==='Glass'}
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
      <p class="notice">The existing persistent controller is shown below in its idle audio state. No media or tracking is sent.</p>
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
  /* Only the isolated iframe: retain the normal application chrome in the inventory. */
  :global([data-coast-glass] > header), :global([data-coast-glass] > .hero-player), :global([data-coast-glass] > .toasts) { display:none; }
  :global(.page-shell) { padding:0 !important; min-height:100svh; }
  .demo { padding:24px; }
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
