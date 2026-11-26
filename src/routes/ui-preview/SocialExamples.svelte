<script lang="ts">
  import { useMenuPreview } from '#lib/ui/controls/menu-preview.js';
  import {useClient} from '#lib/ui/client-context.js';
  const delivery=useClient().feedback;
  const menuFixture = useMenuPreview();
  const conditions = $derived(menuFixture?.conditions ?? {});
  import { untrack } from 'svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import ActivityHeader from '#lib/ui/components/ActivityHeader.svelte';
  import PartyCard from '#lib/ui/components/PartyCard.svelte';
  import PartyMenu from '#lib/ui/components/PartyMenu.svelte';
  import PlaybackTimeline from '#lib/ui/components/PlaybackTimeline.svelte';
  import FriendRoster from '#lib/ui/components/FriendRoster.svelte';
  import EmptyState from '#lib/ui/components/EmptyState.svelte';
  import Toast from '#lib/ui/components/Toast.svelte';
  import { usePlayback } from '#lib/playback/context.svelte.js';
  import type { FriendEntry } from '#lib/social/model.js';
  import { defaultPartySettings, type RoomState } from '#lib/playback/synced/model.js';
  import type { PlaybackQualityInfo } from '#lib/playback/quality.js';
  import { id, movie, previewSubtitleTracks, today } from './demo/fixtures';

  let { name, scenario = 'default' }: { name: string; scenario: string } = $props();
  let open = $state(false);
  let position = $state(945);
  const {player, party} = usePlayback();
  const videoQuality: PlaybackQualityInfo = {
    selection: {}, mode: 'transcode', height: 2160, bitrate: 36_000_000, bitrateLimit: 20_000_000, allowTranscode: true,
    videoCodecs: ['h264', 'hevc'], audioCodecs: ['aac', 'ac3'],
    audioTracks: [
      { index: 1, label: 'English · 5.1', channels: 6, default: true },
      { index: 2, label: 'French · Stereo', channels: 2 },
    ],
  };
  const names = ['Alice', 'Sam', 'Taylor', 'Morgan', 'Jamie', 'Robin', 'Alex', 'Casey'];
  const reading = { format: 'cbz', page: 12, total: 32 } as const;
  const participants = names.map((username, index) => ({
    userId: index === 0 ? id : `preview-member-${index}`,
    username, avatar: null, joined: true, buffering: false,
    online: true, ready: true, unavailable: false,
  }));
  const invited = $derived(scenario === 'invite');
  const idle = $derived(scenario === 'idle');
  const readingMode = $derived(scenario.startsWith('reading'));
  const audioMode = $derived(conditions.partyAudio ?? (scenario === 'music' || scenario.startsWith('audio') || scenario === 'queue'));
  const follower = $derived(scenario === 'follower');
  const room = $derived<RoomState>({
    id: 'preview-party', createdAt: new Date(Date.now()-20*60_000).toISOString(), hostId: id,
    mediaId: idle ? null : movie.id,
    mediaType: readingMode ? 'reading' : audioMode ? 'audio' : 'video',
    reading: readingMode ? reading : null, readingFormat: readingMode ? 'cbz' : null,
    edition: '', durationSeconds: 2700, positionSeconds: position,
    paused: scenario === 'paused' || scenario === 'active-party', bufferingPaused: scenario === 'buffering',
    bufferingPolicy: 'together', queue: audioMode ? ['preview-track-one','preview-track-two'] : [], queueItems: audioMode ? [{id:'preview-track-one',title:'Preview track one',availability:'available'},{id:'preview-track-two',title:'Preview track two',availability:'unavailable'}] : [], queueIndex: 0,
    revision: 1, updatedAt: `${today}T18:15:45Z`, serverTime: `${today}T18:15:45Z`, ended: false,
    settings: { ...defaultPartySettings, readyCheck: conditions.readyCheck ?? scenario === 'buffering', playback:conditions.selectedControllers?'selected':conditions.controlPlayback?'everyone':'host',controllers:conditions.selectedControllers?['preview-member-1']:[],queue:conditions.editQueue?'everyone':'host',acceptInvites:conditions.acceptInvites ?? true },
    participants: (scenario === 'many' ? participants : participants.slice(0, 3)).map((member, index) => ({
      ...member, joined: !(scenario === 'pending' && index === 2),
      buffering: scenario === 'buffering' && index === 1,
      unavailable: scenario === 'unavailable' && index === 1,
      online: !(scenario === 'disconnected' && index === 1),
    })),
  });
  const roster = $derived<FriendEntry[]>(participants.slice(0, scenario === 'long' ? 3 : 2).map((member, index) => ({
    id: `preview-friend-${index}`, userId: member.userId,
    username: scenario === 'long' && index === 0 ? 'A very long display name for a friend' : member.username,
    requestedBy: scenario === 'pending' && index === 0 ? 'preview-other' : id,
    state: scenario === 'pending' ? 'pending' : 'accepted', avatar: null,
    canCompare: conditions.compare ?? true, activityStatus: index === 0 ? 'online' : 'away',
    backgroundArtwork: scenario === 'activity' ? movie.backdrop ?? undefined : undefined,
    activity: (conditions.friendActivity ?? scenario === 'activity') ? { label: 'Watching', title: 'Preview series — S01E03', href: '#', artwork: movie.backdrop ?? undefined, progress: .35 } : undefined,
  })));
  const toastNotices = $derived((scenario === 'multiple' ? [
    {kind:'synced-invite', title:'Invited you to a party', body:'Watch party · 20:00', actor:{username:'Alice',avatar:null}, media:movie, level:'normal'},
    {kind:'administrator', title:'Scheduled maintenance', body:'Playback may pause during the server update.', level:'persistent'},
    {kind:'external-action', title:'Trakt needs attention', body:'Reconnect to resume activity sync.', level:'persistent'},
  ] as const : [{
    kind:'availability',
    title: scenario === 'long' ? 'A longer notification title that remains readable on a narrow screen' : 'Your title is ready',
    body: scenario === 'long' ? 'This synthetic notification demonstrates wrapping without using a real account, provider or viewing history.' : 'Available from your connected library.',
    level: scenario === 'normal' ? 'normal' as const : 'persistent' as const,
  }]).map((notice,index) => ({...notice,id:`preview-toast-${index}`,readAt:null,toastHiddenAt:null,createdAt:new Date().toISOString()})));

  let FriendsPanel = $state<typeof import('#lib/ui/components/FriendsPanel.svelte').default>();
  let NotificationInbox = $state<typeof import('#lib/ui/components/NotificationInbox.svelte').default>();
  let StreamsPanel = $state<typeof import('#lib/ui/components/StreamsPanel.svelte').default>();
  let NotificationToasts = $state<typeof import('#lib/ui/components/NotificationToasts.svelte').default>();
  let PersistentPlayer = $state<typeof import('#lib/ui/components/PersistentPlayer.svelte').default>();
  $effect(() => {
    const selected = name;
    scenario;
    let disposed = false;
    untrack(() => { open = false;  position = 945; });
    if (menuFixture || selected === 'FriendsPanel' && scenario === 'active-party') untrack(() => { open = true; });
    if (selected === 'FriendsPanel') void import('#lib/ui/components/FriendsPanel.svelte').then(module => { if (!disposed) FriendsPanel = module.default; }).catch(() => { if (!disposed) delivery.failure('This example could not be loaded. Reopen it to retry.'); });
    if (selected === 'NotificationInbox') void import('#lib/ui/components/NotificationInbox.svelte').then(module => { if (!disposed) NotificationInbox = module.default; }).catch(() => { if (!disposed) delivery.failure('This example could not be loaded. Reopen it to retry.'); });
    if (selected === 'StreamsPanel') void import('#lib/ui/components/StreamsPanel.svelte').then(module => { if (!disposed) StreamsPanel = module.default; }).catch(() => { if (!disposed) delivery.failure('This example could not be loaded. Reopen it to retry.'); });
    if (selected === 'NotificationToasts') void import('#lib/ui/components/NotificationToasts.svelte').then(module => { if (!disposed) NotificationToasts = module.default; }).catch(() => { if (!disposed) delivery.failure('This example could not be loaded. Reopen it to retry.'); });
    if (selected === 'PersistentPlayer' && ['controller', 'audio'].includes(scenario)) {
      untrack(()=>{
        player.session={id,mediaId:id,mediaType:scenario === 'audio' ? 'audio' : 'video',title:'Preview track',detail:'Preview artist · Preview album',artwork:movie.poster,url:'',kind:'direct',startSeconds:0,durationSeconds:240,provider:'Preview',defaultSubtitleIndex:null,subtitlePrompt:false,subtitles:conditions.subtitles ? previewSubtitleTracks : [],sources:[{id:'preview-original',label:'Original',edition:''},{id:'preview-extended',label:'Extended',edition:'Extended'}]};
        if (scenario !== 'audio') {
          player.session.quality = { ...videoQuality, selection: {} };
          player.session.initialCrop = { left: 0, right: 0, top: 0.1, bottom: 0.1 };
        }
        player.audioQueue = [{id,title:'Preview track',availability:'available'}]; player.audioIndex = 0;
        player.role='playback';player.paused=true;player.controlsVisible=true;
      });
      void import('#lib/ui/components/PersistentPlayer.svelte').then(module=>{if(!disposed)PersistentPlayer=module.default;}).catch(()=>{if(!disposed)delivery.failure('This example could not be loaded. Reopen it to retry.');});
    }
    return () => { disposed = true; if(selected==='PersistentPlayer'){player.session=null;player.role='idle';} };
  });
  $effect(() => {
    if (!party) return;
    party.room = name === 'FriendsPanel' && scenario === 'active-party' ? room : null;
    party.userId = id;
  });
  function action(label: string) { delivery.notify(`${label} · Preview only; nothing was saved.`); }
</script>

{#key `${name}:${scenario}`}
  {#if name === 'FriendsPanel'}
    {#if !menuFixture}<Button onclick={() => open = true}>Open friends example</Button>{/if}

    {#if FriendsPanel}<FriendsPanel bind:open initialView={scenario === 'requests' ? 'pending' : ['parties','active-party'].includes(scenario) ? 'party' : 'accepted'} />{/if}
  {:else if name === 'NotificationInbox'}
    {#if !menuFixture}<Button onclick={() => open = true}>Open notification example</Button>{/if}
    {#if NotificationInbox}<NotificationInbox bind:open initialFilters={{ segment: 'all', kind: 'all', unread: scenario === 'unread', category: 'all', period: 'all' }} />{/if}
  {:else if name === 'StreamsPanel'}
    {#if !menuFixture}<Button onclick={() => open = true}>Open streams example</Button>{/if}
    {#if StreamsPanel}<StreamsPanel bind:open initialView={scenario === 'history' ? 'history' : ['links', 'older-link'].includes(scenario) ? 'links' : 'now'} />{/if}
  {:else if name === 'NotificationToasts'}
    {#if NotificationToasts}<NotificationToasts notifications={toastNotices} rich />{/if}
  {:else if name === 'FriendRoster'}
    <div class="panel-example">
      {#if scenario === 'empty'}<EmptyState title="Add your first friend" description="Exchange usernames in Requests to connect." icon="user" />
      {:else}<FriendRoster friends={roster} userId={id} busy={scenario === 'busy'} act={(_path, body) => action(String((body as {action?:string}).action ?? 'Updated'))} oninvite={conditions.partyInvite === false ? undefined : () => action('Invited')} />{/if}
    </div>
  {:else if name === 'PartyMenu'}
    <PartyMenu demoRoom={room} demoUserId={scenario.endsWith('member') ? participants[1].userId : id} />
  {:else if name === 'PartyCard'}
    <div class="panel-example party-example">
      {#snippet timeline()}<PlaybackTimeline mediaId={movie.id} href="#" audio={audioMode} title={readingMode ? 'Preview comic' : audioMode ? 'Preview track' : 'Preview series'} detail={readingMode ? 'Reading together' : audioMode ? 'Preview artist · Preview album' : 'S01E03 · Preview episode'} artwork={movie.poster} current={position} duration={2700} readingActive={readingMode} reading={readingMode ? reading : null} />{/snippet}
      {#snippet inviteHeader()}<ActivityHeader username="Alice">{#snippet trailing()}15:45{/snippet}</ActivityHeader>{/snippet}
      <PartyCard inParty={!invited} embedded={scenario === 'embedded'} header={invited ? inviteHeader : undefined} members={invited ? [] : room.participants} footer={idle ? undefined : timeline} background={idle ? undefined : movie.backdrop} label={invited ? 'Party invitation preview' : 'Joined party preview'}>
        {#snippet memberActions(member)}
          <Button item icon="user" onclick={() => action(`View ${member.username}`)}>Profile</Button>
          {#if !follower && member.userId !== id}<Button item disabled={!member.joined} onclick={() => action('Promoted')}>Promote to owner</Button><div class="menu-divider" role="separator"></div><Button item danger onclick={() => action('Removed')}>Kick</Button>{/if}
        {/snippet}
        {#snippet actions()}
          {#if !invited}<span class="small quiet" aria-label="Party duration">15:45</span>{/if}
          <Button size="icon" icon="close" label={invited ? 'Decline invite' : 'Leave party'} title={invited ? 'Decline invite' : 'Leave party'} onclick={() => action(invited ? 'Declined' : 'Left party')} />
          {#if invited || scenario === 'rejoin'}<Button class="join-action" onclick={() => action(invited ? 'Joined' : 'Rejoined')}>{invited ? 'Join' : 'Rejoin'}</Button>
          {:else}<PartyMenu demoRoom={room} demoUserId={follower ? participants[1].userId : id} />{/if}
        {/snippet}
        {#if scenario === 'unavailable'}<div class="stack"><p>This title is unavailable from your connected sources.</p><Button emphasis="subtle" onclick={() => action('Retry playback')}>Retry playback</Button></div>{/if}
      </PartyCard>
    </div>
  {:else if name === 'PlaybackTimeline'}
    <div class="panel-example"><PlaybackTimeline mediaId={scenario === 'unknown' ? undefined : movie.id} href="#" audio={audioMode} title={scenario === 'long' ? 'A long title showing the controller’s existing truncation' : readingMode ? 'Preview comic' : audioMode ? 'Preview track' : 'Preview series'} detail={audioMode ? 'Preview artist · Preview album' : 'S01E03 · Preview episode'} artwork={scenario === 'unknown' ? null : movie.poster} current={position} duration={scenario === 'unknown' ? 0 : 2700} readingActive={readingMode} reading={readingMode ? reading : null} onseek={scenario === 'seekable' ? value => position = value : undefined} /></div>
  {:else if name === 'PersistentPlayer'}
    {#if scenario === 'controller' || scenario === 'audio'}
      <div class="controller-example"><p class="small quiet">Real controller with isolated preview playback. No media source, tracking or live party is attached.</p>{#if PersistentPlayer}<PersistentPlayer />{:else}<p class="quiet" role="status">Loading controller…</p>{/if}</div>
    {:else}
    <p class="small quiet">State composition using the shared timeline and controls. No video/audio engine or real playback session is mounted.</p>
    {#if scenario === 'error'}<Toast kind="error" text="This source could not be played." onaction={() => action('Retried playback')} />
    {:else if scenario === 'postplay'}<EmptyState title="Playback finished" description="This shared item has finished." icon="check" /><Button onclick={() => action('Closed')}>Close</Button>
    {:else if scenario === 'hidden'}<p class="small quiet">Playback chrome is hidden while the player’s existing controls visibility is off.</p>
    {:else}<div class="row"><Button size="icon" icon={scenario === 'playing' ? 'pause' : 'play'} label={scenario === 'playing' ? 'Pause' : 'Play'} disabled={follower} onclick={() => action(scenario === 'playing' ? 'Paused' : 'Playing')} /><Button size="icon" icon="stop" label="Stop playback" onclick={() => action('Stopped')} /><PlaybackTimeline audio={audioMode} title={audioMode ? 'Preview track' : 'Preview series'} detail={follower ? 'Playback is controlled by the host' : 'S01E03 · Preview episode'} current={position} duration={2700} onseek={follower ? undefined : value => position = value} /></div>{/if}
    {/if}
  {/if}
{/key}

<style>
  .controller-example {min-height:320px;}
  .panel-example { width:min(560px,100%); }
  .party-example :global(.join-action), .party-example :global(.join-action:hover) { color:var(--success); }
</style>
