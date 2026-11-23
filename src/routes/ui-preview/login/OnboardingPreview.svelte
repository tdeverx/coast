<script lang="ts">
  import { untrack, type Snippet } from 'svelte';
  import AccessFields from '#lib/providers/trakt/AccessFields.svelte';
  import PairingCode from '#lib/providers/trakt/PairingCode.svelte';
  import { beginTraktActivation } from '#lib/providers/trakt/activation.js';
  import { initialTraktSync, trackingFeatures } from '#lib/providers/trakt/access.js';
  import Button from '#lib/ui/components/Button.svelte';
  import JellyfinFields from '#lib/auth/ui/JellyfinFields.svelte';
  import Icon from '#lib/ui/components/Icon.svelte';
  import SegmentedControl from '#lib/ui/components/SegmentedControl.svelte';
  import ServiceDisclosure from '#lib/auth/ui/ServiceDisclosure.svelte';
  import ServiceHeader from '#lib/auth/ui/ServiceHeader.svelte';
  import ImportRow from '#lib/auth/ui/ImportRow.svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import ProfileFields from '#lib/auth/ui/ProfileFields.svelte';
  import SegmentPanels from '#lib/auth/ui/SegmentPanels.svelte';

  let { account, invited, sample, group, nextImport = $bindable(), onfinish }: {
    account: { name: string; jellyfinChoice: boolean; jellyfinAvailable: boolean; libraryOnly: boolean; requiredProvider: 'jellyfin' | 'trakt' | 'either' | 'none'; managed: boolean; showJellyfin: boolean; customJellyfinUrl: boolean; showTrakt: boolean };
    invited: boolean; sample: Snippet; group: Snippet<[Snippet]>; onfinish: () => void;
    nextImport: 'success' | 'failure' | 'reconnect';
  } = $props();

  let step = $state<'services' | 'profile' | 'imports'>(untrack(() => account.libraryOnly ? 'profile' : 'services'));
  let reachedProfile = $state(untrack(() => account.libraryOnly));
  let jellyfin = $state(untrack(() => account.managed));
  let jellyfinExpanded = $state(false);
  let serverUrl = $state('');
  let jellyfinName = $state('');
  const validServer = $derived(URL.canParse(serverUrl) && /^https?:\/\//i.test(serverUrl));
  const canConnectJellyfin = $derived((!account.customJellyfinUrl || validServer) && jellyfinName.trim().length > 0);
  const activationUrl = 'https://trakt.tv/activate';
  let previewCode = $state('COAST123');
  let traktStatus = $state<'idle' | 'pending' | 'connected'>('idle');
  let traktExpanded = $state(false);
  const trakt = $derived(traktStatus === 'connected');
  function activateTrakt() {
    const activate = beginTraktActivation(previewCode);
    void activate({ userCode: previewCode, verificationUrl: activationUrl });
  }
  function startTraktPairing() {
    if (traktStatus === 'pending') previewCode = crypto.randomUUID().slice(0, 8).toUpperCase();
    activateTrakt();
    traktStatus = 'pending';
  }
  function approveTrakt(code: string) {
    if (traktStatus !== 'pending' || code !== previewCode) return;
    traktStatus = 'connected';
    traktExpanded = true;
  }
  let sync = $state(initialTraktSync());
  let displayName = $state(''), bio = $state('');
  const provider = $derived(account.requiredProvider);
  const canContinue = $derived(provider === 'none' || (provider !== 'trakt' && jellyfin) || (provider !== 'jellyfin' && trakt));
  function requirement(service: 'jellyfin' | 'trakt') {
    if (provider === service) return 'Required';
    if (provider !== 'either' || canContinue) return 'Optional';
    return account.showJellyfin && account.showTrakt ? 'One required' : 'Required';
  }
  const steps = $derived([
    { value: 'services', label: 'Services', disabled: account.libraryOnly || step === 'imports' },
    { value: 'profile', label: 'Profile', disabled: step === 'imports' || !reachedProfile || !canContinue },
    { value: 'imports', label: 'Imports', disabled: step !== 'imports' },
  ]);
  // Trakt has no item total. Its preview finishes after a delay.
  const imports = $derived([
    ...(jellyfin ? [{ label: 'Jellyfin library', icon: 'jellyfin', total: 84 } as const] : []),
    ...(trakt && trackingFeatures.some(key => sync.import[key]) ? [{ label: 'Trakt activity', icon: 'trakt', total: null } as const] : []),
    ...(trakt && sync.import.lists ? [{ label: 'Trakt lists', icon: 'trakt', total: null } as const] : []),
  ]);
  let processed = $state<Record<string, number>>({});
  let complete = $state<Record<string, boolean>>({});
  let issue = $state<'failure' | 'reconnect'>();
  let reconnecting = $state(false);
  const activeImport = $derived(imports.find(item => !complete[item.label]));
  const finished = $derived(!activeImport);
  $effect(() => {
    const item = activeImport;
    if (step !== 'imports' || !item || issue) return;
    const count = processed[item.label] ?? 0;
    const timer = window.setTimeout(() => {
      if (nextImport !== 'success') {
        issue = nextImport;
        nextImport = 'success';
      } else if (item.total === null || count + 4 >= item.total) {
        complete[item.label] = true;
      } else {
        processed[item.label] = count + 4;
      }
    }, item.total === null ? 1800 : 140);
    return () => window.clearTimeout(timer);
  });

  function reconnectImport() {
    if (activeImport?.icon === 'trakt') {
      previewCode = crypto.randomUUID().slice(0, 8).toUpperCase();
      activateTrakt();
    } else if (!jellyfinName && account.managed) {
      jellyfinName = account.name;
    }
    reconnecting = true;
  }

  function resumeImport() {
    reconnecting = false;
    issue = undefined;
  }

  function focusHeading(node: HTMLElement) { node.focus({ preventScroll: true }); }

  function connectJellyfin(name: string) {
    jellyfinName = name;
    jellyfin = true;
    jellyfinExpanded = false;
  }

  function advance() {
    if (step === 'services') {
      reachedProfile = true;
      step = 'profile';
    } else if (step === 'profile') step = 'imports';
    else onfinish();
  }
</script>

{#snippet serviceAction(label: string, icon: 'minusCircle' | 'retry', action: () => void)}
  <div class="auth-side-action centered">
    <Button size="icon" emphasis={icon === 'minusCircle' ? 'subtle' : 'standard'} {icon} danger={icon === 'minusCircle'} {label} title={label} onclick={action} />
  </div>
{/snippet}

{#snippet jellyfinServer()}
  <JellyfinFields mode="server" bind:serverUrl/>
{/snippet}
{#snippet createJellyfinAccount()}
  <button type="button" class="menu-row" onclick={() => connectJellyfin(account.name)}>
    <Icon name="user" /><span class="row-copy">Create one for me</span>
  </button>
{/snippet}
{#snippet jellyfinCredentials()}
  <JellyfinFields mode="credentials" bind:jellyfinName/>
{/snippet}
{#snippet jellyfinForm(label: string, submit: () => void)}
  <form class="jellyfin-form" aria-label={label} onsubmit={event => {
    event.preventDefault();
    if (canConnectJellyfin) submit();
  }}>
    {#if account.customJellyfinUrl}{@render group(jellyfinServer)}{/if}
    <div class="jellyfin-account">
      {@render group(jellyfinCredentials)}
      <div class="auth-side-action">
        {@render sample()}
        <Button size="segment" material="clear" type="submit" icon="link" iconSize={16}
          {label} title={label} disabled={!canConnectJellyfin} />
      </div>
    </div>
  </form>
{/snippet}
{#snippet profileFields()}<ProfileFields bind:displayName bind:bio />{/snippet}

{#snippet importRows()}
  {#each imports as item (item.label)}
    {@const count = processed[item.label] ?? 0}
    <ImportRow label={item.label} provider={item.icon} total={count ? item.total : null} processed={count}
      state={complete[item.label] ? 'succeeded' : item !== activeImport ? 'pending' : issue === 'failure' ? 'failed' : issue ?? 'running'}>
      {#snippet recovery()}
        {#if issue === 'failure'}
        <Button emphasis="subtle" label={`Retry ${item.label}`} onclick={resumeImport}>Retry</Button>
      {:else if issue === 'reconnect'}
        {#if reconnecting && item.icon === 'trakt'}
          <PairingCode code={previewCode} oncopied={code => { if (code === previewCode) resumeImport(); }} />
        {:else if reconnecting}
          <span class="menu-row-note">Reconnecting…</span>
        {:else}
          <Button emphasis="subtle" label={`Reconnect ${item.label}`} onclick={reconnectImport}>Reconnect</Button>
        {/if}
        {/if}
      {/snippet}
    </ImportRow>
  {:else}
    <div class="menu-row import-row"><Icon name="checkCircle" size={16} /><span>No imports selected</span></div>
  {/each}
{/snippet}

<section class="auth-stack" class:invite-accent={invited} class:auth-with-side-actions={account.showJellyfin || account.showTrakt || reconnecting} aria-labelledby={'onboarding-' + step}>
  <SegmentPanels index={steps.findIndex(option => option.value === step)}>
    {#snippet children(panel)}
    {@const stage = steps[panel].value}
    <div class="stage">
      <h1 id={'onboarding-' + stage} class="sr-only" tabindex="-1" use:focusHeading>{stage === 'imports' ? 'Initial imports' : stage === 'profile' ? 'Your profile' : 'Connect your services'}</h1>
      {#if stage === 'services'}
        {#if account.showJellyfin}
          <section class="service-section" aria-labelledby="onboarding-jellyfin">
            <div class="jellyfin-account jellyfin-heading-frame">
              <ServiceHeader provider="jellyfin" id="onboarding-jellyfin" note={jellyfin ? 'Connected' : requirement('jellyfin')}
                username={jellyfin ? jellyfinName : ''} expanded={jellyfin ? undefined : jellyfinExpanded} controls="jellyfin-details"
                onactivate={jellyfin ? undefined : () => jellyfinExpanded = !jellyfinExpanded}/>
              {#if jellyfin}
                {@render serviceAction('Disconnect Jellyfin', 'minusCircle', () => { jellyfin = false; jellyfinExpanded = true; })}
              {/if}
            </div>
            {#snippet jellyfinContent()}
              {#if !jellyfin && account.jellyfinChoice}
                {@render group(createJellyfinAccount)}
              {/if}
              {#if !jellyfin && (account.jellyfinAvailable || account.customJellyfinUrl)}
                {@render jellyfinForm('Connect Jellyfin', () => connectJellyfin(jellyfinName.trim()))}
              {/if}
            {/snippet}
            <ServiceDisclosure id="jellyfin-details" expanded={jellyfinExpanded} children={jellyfinContent}/>
          </section>
        {/if}
        {#if account.showTrakt}
          <section class="service-section" aria-labelledby="onboarding-trakt">
            <div class="trakt-heading-frame">
              {#if traktStatus === 'pending'}
                <ServiceHeader provider="trakt" id="onboarding-trakt" note="" activateLabel="Waiting for approval" {activationUrl}>
                  {#snippet trailing()}<PairingCode code={previewCode} oncopied={approveTrakt}/>{/snippet}
                </ServiceHeader>
              {:else}
                <ServiceHeader provider="trakt" id="onboarding-trakt" activateLabel={trakt?'Trakt':'Connect Trakt'} note={trakt?'Connected':requirement('trakt')}
                  expanded={trakt?traktExpanded:undefined} controls={trakt?'trakt-details':undefined}
                  onactivate={()=>{if(trakt)traktExpanded=!traktExpanded;else startTraktPairing();}}/>
              {/if}
              {#if traktStatus === 'pending'}
                {@render serviceAction('Retry Trakt connection', 'retry', startTraktPairing)}
              {:else if trakt}
                {@render serviceAction('Disconnect Trakt', 'minusCircle', () => { traktExpanded = false; traktStatus = 'idle'; })}
              {/if}
            </div>
            <ServiceDisclosure id="trakt-details" expanded={trakt && traktExpanded}>
              {#if trakt}<AccessFields bind:sync {group}/>{/if}
            </ServiceDisclosure>
          </section>
        {/if}
      {:else if stage === 'profile'}
        {@render group(profileFields)}
      {:else}
        {@render group(importRows)}
        {#if reconnecting && activeImport?.icon === 'jellyfin'}
          {@render jellyfinForm('Reconnect Jellyfin', resumeImport)}
        {/if}
        <span class="sr-only" role="status">{activeImport ? issue ? `${activeImport.label} needs ${issue === 'failure' ? 'a retry' : 'reconnection'}` : `Importing ${activeImport.label}` : imports.length ? 'Imports complete' : 'No imports selected'}</span>
      {/if}
    </div>
    {/snippet}
  </SegmentPanels>
  <nav class="onboarding-nav" aria-label="Onboarding navigation">
    <AuthSurface anchor><Button size="segment" icon="arrowLeft" label={step === 'profile' && !account.libraryOnly ? 'Back to services' : 'Back to login'}
      onclick={step === 'profile' && !account.libraryOnly ? () => { step = 'services'; } : onfinish}/></AuthSurface>
    <AuthSurface anchor><SegmentedControl label="Onboarding progress" options={steps} value={step} material="clear"
      onchange={value => { if (value === 'services' || value === 'profile') step = value; }}/></AuthSurface>
    <AuthSurface anchor><Button size="segment" icon="arrow" label={step === 'imports' ? 'Return to login' : 'Continue'}
      disabled={(step === 'services' && !canContinue) || (step === 'imports' && !finished)} onclick={advance}/></AuthSurface>
  </nav>
</section>

<style>
  .stage { display: grid; gap: var(--auth-gap); }
  .jellyfin-form { display: grid; gap: var(--auth-gap); }
  .jellyfin-account { position: relative; }
  .service-section { display: grid; }
  .trakt-heading-frame { position: relative; }
  h1:focus { outline: none; }
  .row-copy { flex: 1; min-width: 0; text-align: start; overflow-wrap: anywhere; }
</style>
