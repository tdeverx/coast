<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import { setArtworkSample } from '#lib/auth/ui/artwork-context.js';
  import { artworkTypes } from '#lib/artwork.js';
  import { playbackBackground } from '#lib/media/artwork.js';
  import { providePreviewPlayback } from '#lib/playback/context.svelte.js';
  import { artworkCardProgress, screenCardCaption, usesScreenCardCaption } from '#lib/ui/card-caption.js';
  import {
    cardBadgeCorners, cardBadgeFields, cardMetadataDate, cardMetadataFields, cardMetadataSizes, cardSlotValue, cardTextFields,
    type CardBadgeField, type CardBadgeSlots, type CardMetadataField,
  } from '#lib/ui/card-slots.js';
  import { providePreviewClient } from '#lib/ui/client-context.js';
  import ActivityHeader from '#lib/ui/components/ActivityHeader.svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Dialog from '#lib/ui/components/Dialog.svelte';
  import type { IconName } from '#lib/ui/components/Icon.svelte';
  import MediaCard from '#lib/ui/components/MediaCard.svelte';
  import MediaDetails from '#lib/ui/components/MediaDetails.svelte';
  import TextLink from '#lib/ui/components/TextLink.svelte';
  import { displayLabel } from '#lib/ui/labels.js';
  import { liquidGlass } from '#lib/ui/materials/glass.js';
  import type { ApiTransport } from '#lib/ui/client.js';
  import {
    cardArtworkPriorities, cardImageTypes, cardLayoutDefaults as defaults, cardLayoutKey, cardLayoutNumber as numericValue,
    cardOverlays, defaultBadgeSlots, defaultCardLayers as defaultLayers,
    emptyBadgeSlots, maxCardFields, maxCardLayers,
    type CardLayout as Layout, type CardLayouts, type CardLayoutTarget, type CardLayoutValues as PreviewValues,
    type CardHeaderField as HeaderField, type CardValueField as ValueField,
  } from '../layout';
  import {
    avatarOptions, bbfc, cardPreviewTransport, examplesFor, previewStates, sessionOptions,
    type AvatarMenu, type CardExample, type CardState, type SessionMode,
  } from './examples';
  import { variantOptions, variantStyle, variants, type CardVariant } from './variants';
  import PreviewDisclosure from './PreviewDisclosure.svelte';
  import PreviewSelect from './PreviewSelect.svelte';
  import PreviewToggle from './PreviewToggle.svelte';
  import PreviewValueInput, { type PreviewValueEditor } from './PreviewValueInput.svelte';
  import SettingsCarousel from './SettingsCarousel.svelte';
  import SettingsPanels from './SettingsPanels.svelte';

  let { backHref, onback, inOverlay = false, backLabel = 'Back', initialLayouts, save, transport }: {
    backHref?: string;
    onback?: () => void;
    inOverlay?: boolean;
    backLabel?: string;
    initialLayouts?: CardLayouts;
    save?: (target: CardLayoutTarget, layout: Layout | null) => Promise<CardLayouts>;
    transport?: ApiTransport;
  } = $props();
  const previewTransport = cardPreviewTransport(() => previewCardItem);
  providePreviewClient((input, init) => (transport ?? previewTransport)(input, init));
  providePreviewPlayback();

  const fieldIcons: Partial<Record<CardMetadataField | CardBadgeField | ValueField, IconName>> = {
    none: 'close', title: 'film', default: 'list', 'rating-or-match': 'star', rating: 'star', match: 'sparkle', friends: 'friends',
    type: 'library', subtitle: 'subtitles', year: 'calendar', 'release-date': 'calendar', certification: 'shield',
    runtime: 'clock', 'time-left': 'clock', progress: 'play', behind: 'history', show: 'party', season: 'collection',
    episode: 'film', credits: 'friends', genres: 'filter', actor: 'user', activity: 'broadcast', 'activity-date': 'calendar',
    status: 'checklist', availability: 'check', source: 'server', body: 'list', footer: 'calendar',
  };
  const badgeOptions = cardBadgeFields.map(option => ({ ...option, icon: fieldIcons[option.id] }));
  const metadataOptions = cardMetadataFields.map(option => ({ ...option, icon: fieldIcons[option.id] }));
  const headerOptions = ([{ id: 'none', label: 'None' }, ...cardTextFields] as const)
    .map(option => ({ ...option, icon: fieldIcons[option.id] }));
  const editableFields = new Set<string>([...cardTextFields.map(({ id }) => id), 'default', 'rating', 'match']);
  const textSizeOptions = cardMetadataSizes.map(option => ({ ...option, textSize: option.id }));
  const shapeOptions = [
    { id: 'auto', label: 'Automatic' }, { id: 'poster', label: 'Poster' }, { id: 'fanart', label: 'Fanart' },
    { id: 'square', label: 'Square' }, { id: 'circle', label: 'Circle' }, { id: 'banner', label: 'Banner' },
  ] as const;
  const artworkStateOptions = [
    { id: 'ready', label: 'Ready', icon: 'check' }, { id: 'loading', label: 'Loading', icon: 'clock' },
    { id: 'broken', label: 'Broken image', icon: 'image' },
  ] as const;
  const overlayOptions = [
    { id: 'auto', label: 'Automatic', icon: 'layers' },
    { id: 'none', label: 'None', icon: 'close' },
    ...cardOverlays.filter(id => id !== 'auto' && id !== 'none').map(id => ({ id, label: artworkTypes[id].label,
      logo: id === 'logo' ? '/coast-mark.png' : undefined, icon: 'image' as const })),
  ] as const;
  const priorityOptions = [
    { id: '', label: 'Automatic' },
    ...cardArtworkPriorities.filter(Boolean).map(id => ({ id, label: id.split('-').map(displayLabel).join(' → ') })),
  ] as const;
  const layoutStorageKey = 'coast.media-card-preview.layouts.v1';
  const globalLayoutKey = cardLayoutKey('all');
  const defaultLayout: Layout = { settings: defaults, badgeSlots: defaultBadgeSlots, metadataLayers: defaultLayers(), metadataValues: {} };
  let variant = $state<CardVariant>(variants[0]);
  const targetKey = $derived(cardLayoutKey(variant.id));
  let savedLayouts = $state.raw<CardLayouts>(untrack(() => save ? normalizeLayouts(initialLayouts) : {}));
  const drafts = new Map<string, Layout>();
  let saveStatus = $state<'saved' | 'failed'>();
  let saving = $state(false);
  let cardTypePicker: { close: () => void };
  let badgeSlots = $state<CardBadgeSlots>({ ...defaultBadgeSlots });
  let metadataLayers = $state(defaultLayers());
  let metadataValues = $state<PreviewValues>({});
  let nextLayerId = 2;
  let settings = $state({ ...defaults });
  const targetDefaults = $derived(inheritedLayout());
  const editedLayout = $derived(JSON.stringify({ settings, badgeSlots, metadataLayers, metadataValues }));
  const defaultLayoutSignature = $derived(JSON.stringify(targetDefaults));
  const savedLayoutSignature = $derived(JSON.stringify(savedLayout(targetKey)));
  const layoutIsDefault = $derived(editedLayout === defaultLayoutSignature);
  const layoutIsDirty = $derived(editedLayout !== savedLayoutSignature);
  const saveLabel = $derived(saving ? 'Saving…' : layoutIsDirty ? (saveStatus === 'failed' ? 'Retry' : 'Save')
    : (saveStatus === 'saved' || savedLayouts[targetKey] ? 'Saved' : 'Save'));
  untrack(() => {
    if (save) applyLayout(savedLayout(targetKey));
  });
  onMount(() => {
    if (save) return;
    try { savedLayouts = readLayouts(); } catch { return; }
    applyLayout(savedLayout(targetKey));
  });

  let previewState = $state<CardState>('catalogue');
  let artworkState = $state<typeof artworkStateOptions[number]['id']>('ready');
  const saveScope = $derived(`${variant.label} cards`);
  const targetResetLabel = $derived(`Reset ${saveScope} to default`);
  let avatarMenu = $state<AvatarMenu>('none');
  let sessionMode = $state<SessionMode>('live');
  let journalLayout = $state(false);
  let available = $state<boolean>();
  let metricDetail = $state<{ title: string; message: string }>();
  let notice = $state('');
  let watched = $state(false);
  let previewItem = $state('0');
  const settingsSections = [
    { value: 'sample', label: 'Sample' },
    { value: 'badges', label: 'Badges' },
    { value: 'metadata', label: 'Metadata' },
    { value: 'artwork', label: 'Artwork' },
    { value: 'features', label: 'Features' },
  ];
  let settingsSection = $state('sample');
  let sectionDirection = $state<-1 | 1>(1);
  let sectionCarousel: ReturnType<typeof SettingsCarousel>;

  const featureGroups = [
    { label: 'Actions', icon: 'play', controls: [
      { key: 'primaryAction', label: 'Primary action', icon: 'play' },
      { key: 'artworkMenu', label: 'Card menu', icon: 'more' },
      { key: 'secondaryAction', label: 'Secondary action', icon: 'check' },
    ] },
    { label: 'Playback progress', icon: 'clock', controls: [
      { key: 'progressBar', label: 'Progress bar', icon: 'clock' },
    ] },
    { label: 'Extra content', icon: 'list', controls: [
      { key: 'requestStatus', label: 'Request status icon', icon: 'request' },
      { key: 'body', label: 'Body text', icon: 'list' },
      { key: 'footer', label: 'Footer', icon: 'list' },
    ] },
  ] as const;

  const artworkSourceOptions = [
    { id: 'auto', label: 'Automatic' }, { id: 'none', label: 'None' },
    ...cardImageTypes.filter(id => id !== 'auto' && id !== 'none').map(id => ({ id, label: artworkTypes[id].label })),
  ] as const;
  const examples = $derived(examplesFor(variant.kind, { state: previewState, avatarMenu, sessionMode, journalLayout }));
  const example = $derived(examples[Number(previewItem)] ?? examples[0]);
  const menu = $derived(example.menu);
  const canChooseAvatarMenu = $derived(previewState === 'none' && example.item.kind === 'person');
  const previewOptions = $derived(examples.map(({ item, previewLabel }, index) => {
    const label = previewLabel ?? (previewState === 'activity' && journalLayout && examples.length > 1
      ? item.captionSubtitle ?? item.title : item.title);
    return {
      id: String(index), label,
      logo: item.logo ?? item.artwork?.logo,
      thumbnail: item.poster ?? item.artwork?.primary ?? item.backdrop,
      icon: variantStyle[item.kind].icon,
      detail: label !== item.title ? item.title : item.captionStatus?.label
        ?? ('showTitle' in item ? item.showTitle : undefined) ?? (item.year ? String(item.year) : undefined),
    };
  }));
  const backdrop = $derived(playbackBackground(example.item));
  const backgroundArtwork = $derived(backdrop === '/coast-mark.png' ? undefined : backdrop);
  setArtworkSample(artworkSample);
  const artworkOnly = $derived(example.props?.artworkOnly === true);
  const defaultAvailability = $derived(previewState === 'request' ? example.item.available ?? false : true);
  const itemAvailable = $derived(available ?? defaultAvailability);
  const sampleProgress = $derived(artworkCardProgress(example.item, example.props?.showWorkMetadata, example.props?.activityProgress));
  const showSampleDetails = $derived(previewState === 'session');
  const effectiveFeatures = $derived({
    ...settings,
    monochromeMissing: settings.monochromeMissing ?? true,
    caption: settings.caption ?? (!artworkOnly && example.props?.showCaption !== false),
    badges: settings.badges ?? !artworkOnly,
    header: settings.header ?? (!(previewState === 'activity' && journalLayout) && !!example.item.captionActor),
    progressBar: settings.progressBar ?? (!artworkOnly && sampleProgress !== null),
    primaryAction: settings.primaryAction ?? (menu === 'avatar' || (!artworkOnly && example.props?.showPrimaryAction !== false && example.item.kind !== 'person')),
    artworkMenu: settings.artworkMenu ?? (menu === 'party' || (!artworkOnly && example.props?.showArtworkMenu !== false && example.item.kind !== 'person')),
    secondaryAction: settings.secondaryAction ?? (previewState === 'activity' && !journalLayout),
    requestStatus: settings.requestStatus ?? (!artworkOnly && !!example.item.captionStatus),
    body: settings.body ?? showSampleDetails,
    footer: settings.footer ?? showSampleDetails,
  });
  const explicitProgress = $derived(numericValue(metadataValues.progress, 100));
  const activityProgress = $derived(effectiveFeatures.progressBar
    ? (explicitProgress === undefined ? sampleProgress ?? .35 : explicitProgress / 100) : example.props?.activityProgress);
  const usesDefaultHeader = $derived(!!example.item.captionActor && settings.headerLeading === 'actor' &&
    settings.headerTrailing === 'activity-date' && !metadataValues.actor && !metadataValues['activity-date']);
  const shape = $derived(settings.shape === 'auto' ? exampleShape(example) : settings.shape);
  const artworkStyle = $derived(settings.artworkStyle === 'auto' ? example.artworkStyle ?? 'auto' : settings.artworkStyle);
  const overlay = $derived(settings.overlay === 'auto' ? 'none' : settings.overlay);
  const social = { friends: [{ username: 'Maya' }, { username: 'Jules' }], total: 2 };
  const previewCardItem = $derived(cardItem(example.item));

  function cardItem(item: CardExample['item']): CardExample['item'] {
    if (itemAvailable !== item.available) {
      item = {
        ...item, available: itemAvailable,
        ...('progress' in item ? { canOpen: itemAvailable, playbackPending: false } : {}),
      };
    }
    const rating = numericValue(metadataValues.rating, 5);
    if (rating !== undefined) item = { ...item, rating };
    if (effectiveFeatures.requestStatus) {
      const status = item.captionStatus ?? { label: 'Requested', icon: 'clock', tone: 'pending' } as const;
      item = { ...item, captionStatus: { ...status, label: metadataValues.status?.trim() || status.label } };
    }
    if (!settings.artwork || artworkState === 'broken') {
      return {
        ...item, poster: settings.artwork ? 'data:image/png;base64,AA==' : null,
        backdrop: null, artwork: undefined, artworkSources: undefined,
      };
    }
    return overlay === 'none' ? item : { ...item, artwork: { ...item.artwork, [overlay]: '/coast-mark.png' } };
  }

  function exampleShape(example: CardExample) {
    return example.shape ?? variantStyle[example.item.kind].shape;
  }

  function sampleValue(field: ValueField) {
    const item = example.item;
    if (field === 'body') return example.body ?? ('progress' in item ? item.overview : undefined) ?? item.captionSubtitle ?? item.title;
    if (field === 'footer') return cardMetadataDate(example.date) || example.footer || displayLabel(item.kind);
    if (field === 'title') return item.captionTitle ?? item.title;
    if (field === 'rating') return item.rating == null ? '0–5' : String(item.rating);
    if (field === 'match') return example.match == null ? '0–100' : String(example.match);
    if (field === 'default') {
      if ('progress' in item && usesScreenCardCaption(item, example.props?.showWorkMetadata)) {
        const detail = screenCardCaption(item, true);
        return [detail.context?.text, detail.label?.text, detail.detail].filter(Boolean).join(' ');
      }
      return item.captionActivity?.action ?? item.captionSubtitle ?? displayLabel(item.kind);
    }
    return cardSlotValue(item, field, example.props?.activityProgress).map(value => value.text).join(', ');
  }

  function valueEditor(field: ValueField): PreviewValueEditor {
    return {
      value: metadataValues[field] ?? '',
      defaultValue: targetDefaults.metadataValues[field] ?? '',
      placeholder: sampleValue(field) || 'Enter a value',
      inputmode: field === 'rating' || field === 'match' || field === 'progress' ? 'decimal' : 'text',
      update: value => {
        if (value.trim()) metadataValues[field] = value;
        else delete metadataValues[field];
      },
    };
  }

  function metadataEditor(field: CardMetadataField | CardBadgeField) {
    if (field === 'rating-or-match') {
      const item = example.item;
      const rating = numericValue(metadataValues.rating, 5) ?? item.rating;
      return valueEditor(rating != null && item.kind !== 'person' && !item.captionActor ? 'rating' : 'match');
    }
    return editableFields.has(field) ? valueEditor(field as ValueField) : undefined;
  }

  function headerValue(field: HeaderField, item: CardExample['item']) {
    if (field === 'none') return;
    if (field === 'title') return { text: metadataValues.title?.trim() || item.captionTitle || item.title };
    const value = cardSlotValue(item, field, activityProgress, metadataValues)[0];
    return value ?? (field === 'actor' ? { text: 'Maya' } : undefined);
  }

  function selectPreviewItem(value: string) {
    previewItem = value;
    resetItemOverrides();
  }

  function resetItemOverrides() {
    available = undefined;
    watched = false;
    notice = '';
  }

  function inheritedLayout(layouts = savedLayouts) {
    return layouts[globalLayoutKey] ?? defaultLayout;
  }

  function savedLayout(key: keyof CardLayouts) {
    return savedLayouts[key] ?? inheritedLayout();
  }

  function readLayouts(): CardLayouts {
    const stored = localStorage.getItem(layoutStorageKey);
    if (!stored) return {};
    try {
      return normalizeLayouts(JSON.parse(stored));
    } catch { return {}; }
  }

  function normalizeLayouts(layouts: CardLayouts | undefined): CardLayouts {
    if (!layouts || typeof layouts !== 'object' || Array.isArray(layouts)) return {};
    return Object.fromEntries(Object.entries(layouts).flatMap(([key, layout]) => {
      const normalized = normalizeLayout(layout);
      return normalized ? [[key, normalized]] : [];
    }));
  }

  function normalizeLayout(layout: Layout | undefined): Layout | undefined {
    if (!layout?.settings || !layout.badgeSlots || !Array.isArray(layout.metadataLayers)) return;
    const { activityHeader, artworkState: _artworkState, ...storedSettings } = layout.settings as Layout['settings'] & {
      activityHeader?: boolean; artworkState?: string;
    };
    if (!layout.metadataValues) {
      for (const field of ['caption', 'progressBar', 'primaryAction', 'artworkMenu', 'requestStatus'] as const) {
        if (storedSettings[field] === true) storedSettings[field] = undefined;
      }
    }
    return { ...layout, metadataValues: layout.metadataValues ?? {},
      settings: { ...defaults, ...storedSettings, header: storedSettings.header ?? activityHeader } };
  }

  function snapshotLayout(): Layout {
    return $state.snapshot({ settings, badgeSlots, metadataLayers, metadataValues });
  }

  function applyLayout(layout: Layout) {
    settings = { ...layout.settings };
    badgeSlots = { ...layout.badgeSlots };
    metadataLayers = layout.metadataLayers.map(layer => ({ ...layer, fields: [...layer.fields] }));
    metadataValues = { ...layout.metadataValues };
    nextLayerId = Math.max(0, ...metadataLayers.map(layer => layer.id)) + 1;
  }

  function addLayer() {
    metadataLayers.push({ id: nextLayerId++, size: 'small', fields: ['none'] });
  }

  function resetSettings() {
    saveStatus = undefined;
    applyLayout(targetDefaults);
    cardTypePicker.close();
  }

  async function saveSettings() {
    if (saving || !layoutIsDirty) return;
    const key = targetKey;
    const target = variant.id;
    const layout = snapshotLayout();
    saving = true;
    try {
      const reset = JSON.stringify(layout) === JSON.stringify(targetDefaults);
      if (save) savedLayouts = normalizeLayouts(await save(target, reset ? null : layout));
      else {
        const layouts = readLayouts();
        if (reset) delete layouts[key];
        else layouts[key] = layout;
        localStorage.setItem(layoutStorageKey, JSON.stringify(layouts));
        savedLayouts = layouts;
      }
      if (JSON.stringify(drafts.get(key)) === JSON.stringify(layout)) drafts.delete(key);
      if (targetKey === key) saveStatus = 'saved';
    } catch {
      if (targetKey === key) saveStatus = 'failed';
    } finally {
      saving = false;
    }
  }

  function selectCardType(id: string) {
    const selected = variants.find(option => option.id === id);
    if (!selected || selected.id === variant.id) return;
    const previewLabel = previewState === 'request' || (previewState === 'session' && sessionMode === 'shared-link')
      ? example.previewLabel : undefined;
    if (layoutIsDirty) drafts.set(targetKey, snapshotLayout());
    else drafts.delete(targetKey);
    variant = selected;
    saveStatus = undefined;
    applyLayout(drafts.get(targetKey) ?? savedLayout(targetKey));
    resetItemOverrides();
    previewItem = String(Math.max(0, previewLabel ? examples.findIndex(entry => entry.previewLabel === previewLabel) : 0));
  }

  function selectSettingsSection(section: string, direction: -1 | 1) {
    if (section === settingsSection) return;
    sectionDirection = direction;
    settingsSection = section;
  }

  function selectPreviewState(selection: CardState) {
    const itemId = example.item.id;
    previewState = selection;
    resetItemOverrides();
    keepPreviewItem(itemId);
  }

  function keepPreviewItem(itemId: string) {
    previewItem = String(Math.max(0, examples.findIndex(entry => entry.item.id === itemId)));
  }

  function setJournalLayout(enabled: boolean) {
    const itemId = example.item.id;
    journalLayout = enabled;
    keepPreviewItem(itemId);
  }

  function setSessionMode(mode: SessionMode) {
    const itemId = example.item.id;
    sessionMode = mode;
    keepPreviewItem(itemId);
  }

</script>

{#snippet backdropArtwork()}
  {#if backgroundArtwork}
    <div class="backdrop-art auth-artwork-backdrop"><img src={backgroundArtwork} alt="" referrerpolicy="no-referrer" /></div>
  {/if}
{/snippet}

{#snippet artworkSample()}
  <div class="auth-artwork-sample" aria-hidden="true">
    {#if backgroundArtwork}<img class="sample-art" src={backgroundArtwork} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" />{/if}
  </div>
{/snippet}

{#snippet arrowControl(options: { icon: 'arrowLeft' | 'arrow'; label: string; href?: string; onclick?: () => void })}
  <AuthSurface anchor>
    <Button {...options} size="segment" title={options.label} />
  </AuthSurface>
{/snippet}

{#snippet glassSeparator()}
  <div class="glass-separator" aria-hidden="true">
    <AuthSurface anchor>
      <div class="glass separator-pill" use:liquidGlass={{ variant: 'clear' }}></div>
    </AuthSurface>
  </div>
{/snippet}

<MediaDetails view={{ hero: false, page: false, class: 'media-card-editor-detail' }} artwork={[backdrop]}>
<div class="content page card-preview" class:in-overlay={inOverlay}>
  <div class="preview-backdrop" aria-hidden="true">{@render backdropArtwork()}</div>
  <header class="editor-header" aria-label="Card editor">
    <div class="editor-back">
      {@render arrowControl({ href: backHref, onclick: onback, icon: 'arrowLeft', label: backLabel })}
    </div>
    <div class="editor-target">
      <PreviewSelect label="Card type" options={variantOptions} value={variant.id} onchange={selectCardType} bind:this={cardTypePicker} />
      <div class="target-reset">
        {#if !layoutIsDefault}
          <Button size="icon" emphasis="subtle" icon="retry" danger
            label={targetResetLabel} title={targetResetLabel} onclick={resetSettings} />
        {/if}
      </div>
    </div>
    <div class="editor-save">
      <AuthSurface anchor>
        <Button size="segment" disabled={saving || !layoutIsDirty}
          text={saveLabel} title={`Save ${saveScope} layout`} onclick={saveSettings} />
      </AuthSurface>
      <span class="sr-only" role="status">{saveStatus === 'failed' ? 'The layout could not be saved. Try again.'
        : saveStatus === 'saved' ? 'Layout saved.' : ''}</span>
    </div>
  </header>

  <div class="editor">
    <section class="preview-stage" aria-label="Sample card">
      <div class="preview-card" data-shape={shape}
        onclickcapture={event => {
          const link = event.target instanceof Element ? event.target.closest('a') : null;
          if (link && !link.href.startsWith(bbfc)) event.preventDefault();
        }}>
        {#key `${variant.id}:${previewState}:${menu ?? ''}:${example.key ?? example.item.id}`}
          {@const item = previewCardItem}
          {@const needsPreviewMenus = item.kind === 'person' || ('href' in item && (item.href === null || item.kind === 'collection'))}
          <MediaCard
            {...example.props}
            {item}
            artworkOnly={false}
            {shape}
            {artworkStyle}
            monochromeMissing={effectiveFeatures.monochromeMissing}
            artworkPriority={settings.artworkPriority || undefined}
            {overlay}
            previewArtworkLoading={settings.artwork && artworkState === 'loading'}
            badgeSlots={effectiveFeatures.badges ? badgeSlots : emptyBadgeSlots}
            {metadataLayers}
            {metadataValues}
            showCaption={effectiveFeatures.caption}
            showCaptionStatus={effectiveFeatures.requestStatus}
            showActivityContext={effectiveFeatures.secondaryAction}
            showActivityHeader={effectiveFeatures.header && usesDefaultHeader}
            header={effectiveFeatures.header && !usesDefaultHeader ? cardHeader : undefined}
            showPrimaryAction={effectiveFeatures.primaryAction}
            showArtworkMenu={effectiveFeatures.artworkMenu}
            showProgressBar={effectiveFeatures.progressBar}
            {activityProgress}
            previewTasteScore={numericValue(metadataValues.match, 100) ?? example.match}
            social={effectiveFeatures.badges ? social : undefined}
            primaryMenu={effectiveFeatures.primaryAction && (menu === 'avatar' || needsPreviewMenus) ? cardMenu : undefined}
            primaryMenuLabel={menu === 'avatar' ? 'Edit avatar' : undefined}
            primaryMenuIcon={menu === 'avatar' ? 'image' : undefined}
            cornerMenu={menu || needsPreviewMenus ? cardMenu : undefined}
            captionAction={effectiveFeatures.secondaryAction && (example.watchedAction || !item.captionActivity) ? completionAction : undefined}
            body={effectiveFeatures.body ? cardBody : undefined}
            footer={effectiveFeatures.footer ? cardFooter : undefined}
            activityTrailing={example.trailingDate ? activityTime : undefined}
            onPreviewMetric={(kind, value) => {
              const title = kind === 'rating' ? 'Rating' : 'Taste match';
              const detail = kind === 'rating' ? `${value} out of 5` : `${value}% match`;
              metricDetail = { title, message: `${item.title} · ${detail}` };
            }}
          />
          {#snippet completionAction()}
            <Button size="icon" icon="check" pressed={watched}
              label={example.watchedAction ? (watched ? 'Mark unwatched' : 'Mark watched') : (watched ? 'Mark incomplete' : 'Mark complete')}
              onclick={() => watched = !watched} />
          {/snippet}
          {#snippet cardHeader()}
            {@const leading = headerValue(settings.headerLeading, item)}
            {@const trailing = headerValue(settings.headerTrailing, item)}
            {#if settings.headerLeading === 'actor' && leading}
              <ActivityHeader username={leading.text} avatar={item.captionActor?.avatar} status={item.captionActor?.status}
                profileHref={leading.href ?? null}>
                {#snippet trailing()}{#if settings.headerTrailing === 'activity-date' && example.trailingDate && !metadataValues['activity-date']}
                  {@render activityTime()}
                {:else}{@render headerText(headerValue(settings.headerTrailing, item))}{/if}{/snippet}
              </ActivityHeader>
            {:else if leading || trailing}
              <div class="metadata-header">
                {#if leading}<span class="metadata-header-label">{@render headerText(leading)}</span>{/if}
                {#if trailing}<span class="metadata-header-note">{@render headerText(trailing)}</span>{/if}
              </div>
            {/if}
          {/snippet}
          {#snippet headerText(value: { text: string; href?: string } | undefined)}
            {#if value?.href}<TextLink {...value} />{:else}{value?.text}{/if}
          {/snippet}
          {#snippet cardBody()}<p>{metadataValues.body || sampleValue('body')}</p>{/snippet}
          {#snippet cardFooter()}
            {#if metadataValues.footer}{metadataValues.footer}
            {:else if example.date}<span>{example.footer ? example.footer + ' ' : ''}<time datetime={example.date}>{cardMetadataDate(example.date)}</time></span>
            {:else}{sampleValue('footer')}{/if}
          {/snippet}
          {#snippet activityTime()}<time datetime={example.trailingDate}>{cardMetadataDate(example.trailingDate)}</time>{/snippet}
          {#snippet cardMenu()}
            {#if menu === 'avatar'}
              <Button item icon="image" onclick={() => notice = 'Choose avatar selected'}>Choose avatar</Button>
            {:else if menu === 'party'}
              <Button item icon="user" onclick={() => notice = 'View participant selected'}>View participant</Button>
            {:else if menu === 'shared-link'}
              <Button item icon="link" onclick={() => notice = 'Copy link selected'}>Copy link</Button>
              <Button item icon="close" danger onclick={() => notice = 'Revoke link selected'}>Revoke link…</Button>
            {:else if menu === 'stream'}
              <Button item icon="close" danger onclick={() => notice = 'Stop shared playback selected'}>Stop shared playback…</Button>
            {:else}
              <Button item icon="arrow" onclick={() => notice = 'Open details selected'}>Open details</Button>
            {/if}
          {/snippet}
        {/key}
      </div>
      {#if notice}<p class="preview-notice" role="status">{notice}</p>{/if}
    </section>

    <section class="settings" aria-label="Preview settings">
      <div class="settings-viewport">
        <SettingsPanels section={settingsSection} direction={sectionDirection}>
          {#snippet children(panel)}
            <!-- svelte-ignore a11y_no_noninteractive_tabindex (The options pane needs keyboard scrolling.) -->
            <div class="settings-scroll" role="region" aria-label={`${settingsSections.find(section => section.value === panel)?.label ?? 'Card'} options`} tabindex="0">
              <div class="settings-body">
                {#if panel === 'sample'}
                  <div class="sample-controls">
                    <PreviewSelect label="Preview state" options={previewStates} value={previewState} onchange={selectPreviewState} />
                    {#if previewOptions.length > 1}
                      <PreviewSelect label="Preview item" options={previewOptions} value={previewItem} onchange={selectPreviewItem} />
                    {/if}
                  </div>
                  {@render glassSeparator()}
                  <fieldset class="slot-settings">
                    <legend>Preview conditions</legend>
                    <AuthSurface>
                      <PreviewToggle label="Available" icon="play" checked={itemAvailable} onchange={value => available = value} />
                      {#if previewState === 'activity'}
                        <PreviewToggle label="Journal layout" icon="history" checked={journalLayout} onchange={setJournalLayout} />
                      {/if}
                    </AuthSurface>
                    <PreviewSelect label="Image state" options={artworkStateOptions} bind:value={artworkState} />
                    {#if previewState === 'session'}
                      <PreviewSelect label="Session type" options={sessionOptions} value={sessionMode} onchange={setSessionMode} />
                    {/if}
                    {#if canChooseAvatarMenu}
                      <PreviewSelect label="Avatar menu" options={avatarOptions} bind:value={avatarMenu} />
                    {/if}
                  </fieldset>
                {:else if panel === 'badges'}
                  <fieldset class="slot-settings">
                    <legend>Corner badges</legend>
                    <AuthSurface sideActions>
                      <PreviewToggle label="Show badges" icon="layers" checked={effectiveFeatures.badges} onchange={value => settings.badges = value}
                        onreset={settings.badges !== targetDefaults.settings.badges ? () => settings.badges = targetDefaults.settings.badges : undefined} />
                    </AuthSurface>
                    {#each cardBadgeCorners as corner (corner.id)}
                      <PreviewSelect label={corner.label} options={badgeOptions} bind:value={badgeSlots[corner.id]} defaultValue={targetDefaults.badgeSlots[corner.id]}
                        valueEditor={metadataEditor(badgeSlots[corner.id])} />
                    {/each}
                  </fieldset>
                {:else if panel === 'metadata'}
                  <PreviewDisclosure label="Header" icon="list" note={effectiveFeatures.header ? 'On' : 'Off'}>
                    <AuthSurface sideActions>
                      <PreviewToggle label="Show header" icon="list" checked={effectiveFeatures.header} onchange={value => settings.header = value}
                        onreset={settings.header !== targetDefaults.settings.header ? () => settings.header = targetDefaults.settings.header : undefined} />
                    </AuthSurface>
                    <PreviewSelect label="Left field" options={headerOptions} bind:value={settings.headerLeading} defaultValue={targetDefaults.settings.headerLeading}
                      valueEditor={metadataEditor(settings.headerLeading)} />
                    <PreviewSelect label="Right field" options={headerOptions} bind:value={settings.headerTrailing} defaultValue={targetDefaults.settings.headerTrailing}
                      valueEditor={metadataEditor(settings.headerTrailing)} />
                  </PreviewDisclosure>
                  {@render glassSeparator()}
                  <fieldset class="slot-settings">
                    <legend>Caption layers</legend>
                    <AuthSurface sideActions>
                      <PreviewToggle label="Show title and metadata" icon="list" checked={effectiveFeatures.caption} onchange={value => settings.caption = value}
                        onreset={settings.caption !== targetDefaults.settings.caption ? () => settings.caption = targetDefaults.settings.caption : undefined} />
                    </AuthSurface>
                    {#each metadataLayers as layer, index (layer.id)}
                      {@const defaultLayer = targetDefaults.metadataLayers.find(entry => entry.id === layer.id)}
                      {@const fields = layer.fields.filter(field => field !== 'none').map(field => metadataOptions.find(option => option.id === field)?.label)}
                      <PreviewDisclosure label={`Layer ${index + 1}`} icon="layers" note={fields.join(', ') || 'No fields'}>
                        <PreviewSelect label="Text size" options={textSizeOptions} bind:value={layer.size} defaultValue={defaultLayer?.size ?? 'small'} />
                        {#each layer.fields as _, fieldIndex}
                          <div class="layer-field" class:removable={layer.fields.length > 1}>
                            <PreviewSelect label={`Field ${fieldIndex + 1}`} options={metadataOptions} bind:value={layer.fields[fieldIndex]}
                              defaultValue={defaultLayer?.fields[fieldIndex] ?? 'none'}
                              valueEditor={metadataEditor(layer.fields[fieldIndex])} />
                            {#if layer.fields.length > 1}
                              <Button size="icon" icon="close" label={`Remove field ${fieldIndex + 1}`}
                                onclick={() => layer.fields.splice(fieldIndex, 1)} />
                            {/if}
                          </div>
                        {/each}
                        <div class="layer-actions">
                          <AuthSurface anchor>
                            <Button size="segment" icon="plus" disabled={layer.fields.length >= maxCardFields} onclick={() => layer.fields.push('none')}>Add field</Button>
                          </AuthSurface>
                          <Button size="segment" emphasis="subtle" icon="close" label={`Remove layer ${index + 1}`}
                            onclick={() => metadataLayers = metadataLayers.filter(entry => entry.id !== layer.id)}>Remove layer</Button>
                        </div>
                      </PreviewDisclosure>
                    {/each}
                    <div class="add-layer">
                      <AuthSurface anchor>
                        <Button size="segment" icon="plus" disabled={metadataLayers.length >= maxCardLayers} onclick={addLayer}>Add layer</Button>
                      </AuthSurface>
                    </div>
                  </fieldset>
                {:else if panel === 'artwork'}
                  <PreviewDisclosure label="Artwork display" icon="image">
                    <AuthSurface sideActions>
                      <PreviewToggle label="Show artwork" icon="image" checked={settings.artwork} onchange={value => settings.artwork = value}
                        onreset={settings.artwork !== targetDefaults.settings.artwork ? () => settings.artwork = targetDefaults.settings.artwork : undefined} />
                      <PreviewToggle label="Black and white without streams" icon="broadcast" checked={effectiveFeatures.monochromeMissing} onchange={value => settings.monochromeMissing = value}
                        onreset={settings.monochromeMissing !== targetDefaults.settings.monochromeMissing ? () => settings.monochromeMissing = targetDefaults.settings.monochromeMissing : undefined} />
                    </AuthSurface>
                    <PreviewSelect label="Card shape" options={shapeOptions} bind:value={settings.shape} defaultValue={targetDefaults.settings.shape} />
                    <PreviewSelect label="Image type" options={artworkSourceOptions} bind:value={settings.artworkStyle} defaultValue={targetDefaults.settings.artworkStyle} />
                  </PreviewDisclosure>
                  {@render glassSeparator()}
                  <PreviewDisclosure label="Overlays and fallbacks" icon="layers">
                    <PreviewSelect label="Overlay" options={overlayOptions} bind:value={settings.overlay} defaultValue={targetDefaults.settings.overlay} />
                    <PreviewSelect label="Fallback order" options={priorityOptions} bind:value={settings.artworkPriority}
                      defaultValue={targetDefaults.settings.artworkPriority} />
                  </PreviewDisclosure>
                {:else if panel === 'features'}
                  {#each featureGroups as group, index (group.label)}
                    {#if index > 0}{@render glassSeparator()}{/if}
                    <PreviewDisclosure label={group.label} icon={group.icon}>
                      <AuthSurface sideActions>
                        {#each group.controls as feature (feature.key)}
                          {@const defaultValue = targetDefaults.settings[feature.key]}
                          <PreviewToggle label={feature.label} icon={feature.icon} checked={effectiveFeatures[feature.key]}
                            onchange={value => settings[feature.key] = value}
                            onreset={settings[feature.key] !== defaultValue ? () => settings = { ...settings, [feature.key]: defaultValue } : undefined} />
                          {#if feature.key === 'progressBar' || feature.key === 'body' || feature.key === 'footer'}
                            <PreviewValueInput label={feature.key === 'progressBar' ? 'Playback progress percentage' : `${feature.label} value`} resettable
                              {...valueEditor(feature.key === 'progressBar' ? 'progress' : feature.key)} />
                          {/if}
                        {/each}
                      </AuthSurface>
                    </PreviewDisclosure>
                  {/each}
                {/if}
              </div>
            </div>
          {/snippet}
        </SettingsPanels>
      </div>
      <div class="settings-segments">
        {@render arrowControl({
          icon: 'arrowLeft', label: 'Previous section', onclick: () => sectionCarousel.step(-1),
        })}
        <div class="section-rail">
          <AuthSurface anchor>
            <SettingsCarousel bind:this={sectionCarousel} value={settingsSection}
              options={settingsSections} onchange={selectSettingsSection} />
          </AuthSurface>
        </div>
        {@render arrowControl({
          icon: 'arrow', label: 'Next section', onclick: () => sectionCarousel.step(1),
        })}
      </div>
    </section>
  </div>
</div>
</MediaDetails>

<Dialog open={!!metricDetail} title={metricDetail?.title ?? ''} message={metricDetail?.message}
  onclose={() => { metricDetail = undefined; }} />

<style>
  :global(.details.media-card-editor-detail) { padding:0; max-inline-size:none; }
  .card-preview {
    --editor-top-inset:max(16px, env(safe-area-inset-top, 0px));
    --editor-auth-width:var(--auth-width);
    --editor-auth-gap:var(--auth-gap);
    --editor-action-gap:var(--auth-action-gap);
    --editor-side-action-offset:max(0px, calc(var(--editor-auth-gap) - (var(--control-height) - var(--icon-inline)) / 2));
    --editor-artwork-blur:6px;
    --editor-artwork-bleed:32px;
    --editor-menu-radius:var(--glass-surface-radius);
    --editor-menu-row-gap:round(nearest, 2px, var(--menu-device-pixel, 1px));
    --editor-menu-frame:calc(var(--editor-menu-row-gap) + round(nearest, 1px, var(--menu-device-pixel, 1px)));
    --editor-row-height:max(var(--control-height), calc(var(--leading-menu) + 2 * round(nearest, 10px, var(--menu-device-pixel, 1px))));
    --editor-row-highlight:var(--control-hover-fill);
    --editor-row-ink:var(--menu-row-ink);
    --editor-row-text-gap:var(--row-text-gap);
    position:relative;
    isolation:isolate;
    display:grid;
    grid-template-rows:auto minmax(0, 1fr);
    gap:var(--editor-auth-gap);
    block-size:100svh;
    min-block-size:360px;
    max-inline-size:1160px;
    padding-block:var(--editor-top-inset) max(14px, env(safe-area-inset-bottom, 0px));
  }
  .card-preview.in-overlay {block-size:var(--detail-viewport-height, 100svh);min-block-size:0;}
  .in-overlay .preview-backdrop {position:absolute;clip-path:inset(0);}
  .in-overlay .backdrop-art {position:fixed;}
  .preview-backdrop {
    position:fixed;
    inset:0;
    z-index:-1;
    overflow:clip;
    pointer-events:none;
  }
  .backdrop-art {
    position:absolute;
    inset:0;
  }
  .backdrop-art img, .sample-art {
    position:absolute;
    inset:calc(-1 * var(--editor-artwork-bleed));
    inline-size:calc(100% + 2 * var(--editor-artwork-bleed));
    block-size:calc(100% + 2 * var(--editor-artwork-bleed));
    object-fit:cover;
    filter:blur(var(--editor-artwork-blur));
  }
  .sample-art { position:fixed; }
  .editor-header {
    position:relative;
    z-index:2;
    display:grid;
    grid-template-columns:minmax(72px, 1fr) minmax(0, var(--editor-auth-width)) minmax(72px, 1fr);
    align-items:center;
    gap:var(--editor-action-gap);
  }
  .editor-back { justify-self:start; }
  .editor-save { justify-self:end; }
  .editor-target { position:relative; min-inline-size:0; }
  .target-reset {
    position:absolute;
    inline-size:var(--control-height);
    inset-inline-start:calc(100% + var(--editor-side-action-offset));
    inset-block-start:50%;
    translate:0 -50%;
  }
  @media (max-width:600px) {
    .editor-header { grid-template-columns:minmax(68px, 1fr) minmax(0, var(--editor-auth-width)) minmax(68px, 1fr); }
    .editor-target { display:grid; grid-template-columns:minmax(0, 1fr) auto; align-items:center; gap:var(--editor-side-action-offset); }
    .editor-target:not(:has(.target-reset > button)) { grid-template-columns:minmax(0, 1fr); }
    .target-reset { position:static; translate:none; }
    .target-reset:not(:has(> button)) { display:none; }
  }
  @media (max-width:400px) {
    .editor-target :global(.option-icon) { display:none; }
    .editor-target :global(.menu-row) { gap:var(--segment-inset); padding-inline:var(--segment-inset); }
    .editor-target :global(.current) {
      display:grid;
      grid-template-columns:minmax(0, 1fr) auto;
      grid-template-rows:repeat(2, minmax(0, 1fr));
      row-gap:0;
      padding-block:var(--segment-inset);
    }
    .editor-target :global(.current .field-label),
    .editor-target :global(.current .field-value) { max-inline-size:none; line-height:var(--leading-tight); white-space:nowrap; }
    .editor-target :global(.current .chevron) { grid-area:1 / 2 / 3; }
  }
  .editor {
    display:grid;
    grid-template-columns:repeat(2, minmax(0, 1fr));
    grid-template-rows:minmax(0, 1fr);
    min-block-size:0;
    gap:var(--editor-auth-gap);
  }
  .preview-stage {
    display:grid;
    justify-items:center;
    align-content:safe center;
    min-block-size:0;
    padding-block:8px;
    overflow:auto;
    container-type:size;
  }
  .preview-card {
    --preview-shelf-width:clamp(155px, 14vw, 210px);
    --preview-landscape-width:clamp(255px, 27vw, 380px);
    --preview-art-height:clamp(120px, calc(100cqh - 88px), 420px);
    inline-size:min(100%, var(--preview-shelf-width), calc(var(--preview-art-height) * 2 / 3));
  }
  .preview-card[data-shape='square'] { inline-size:min(100%, calc(var(--preview-landscape-width) * 9 / 16), var(--preview-art-height)); }
  .preview-card[data-shape='circle'] { inline-size:min(100%, var(--preview-shelf-width), var(--preview-art-height)); }
  .preview-card[data-shape='fanart'] { inline-size:min(100%, var(--preview-landscape-width), calc(var(--preview-art-height) * 16 / 9)); }
  .preview-card[data-shape='banner'] { inline-size:min(100%, clamp(310px, 34vw, 480px)); }
  .preview-notice { margin-block-start:4px; font-size:var(--text-sm); text-align:center; }
  .metadata-header { display:flex; align-items:center; gap:var(--media-metadata-gap); min-block-size:24px; font-size:var(--text-md); }
  .metadata-header > span { min-inline-size:0; overflow-wrap:anywhere; }
  .metadata-header-label { color:var(--ink); font-weight:var(--weight-semibold); }
  .metadata-header-note { margin-inline-start:auto; color:var(--quiet); font-size:var(--text-sm); }
  .settings {
    --editor-options-inset:var(--segment-inset);
    --editor-arrow-width:calc(var(--icon-inline) + 2 * (var(--segment-padding-inline) + var(--segment-inset)));
    --editor-arrow-space:calc(2 * (var(--editor-arrow-width) + var(--editor-action-gap)));
    --editor-arrow-bleed:calc(var(--gutter) - var(--editor-options-inset));
    --editor-segments-width:min(calc(100% + 2 * var(--editor-arrow-bleed)),
      calc(var(--editor-auth-width) + var(--editor-arrow-space)));
    display:grid;
    grid-template-columns:minmax(0, 1fr);
    grid-template-rows:minmax(0, 1fr);
    min-block-size:0;
    min-inline-size:0;
    justify-items:center;
  }
  .settings-viewport { grid-area:1 / 1; display:grid; inline-size:100%; min-block-size:0; }
  .settings-segments {
    grid-area:1 / 1;
    inline-size:var(--editor-segments-width);
    z-index:1;
    display:grid;
    grid-template-columns:var(--editor-arrow-width) minmax(0, 1fr) var(--editor-arrow-width);
    align-self:end;
    align-items:center;
    gap:var(--editor-action-gap);
    min-inline-size:0;
    padding-inline:var(--editor-options-inset);
    pointer-events:none;
  }
  .settings-segments > :global(*) { pointer-events:auto; }
  .section-rail { --auth-anchor-width:100%; display:grid; grid-template-columns:minmax(0, 1fr); min-inline-size:0; }
  .settings-scroll {
    display:grid;
    grid-template-columns:minmax(0, 1fr);
    justify-items:center;
    align-content:safe center;
    min-block-size:0;
    padding-block-end:calc(var(--segment-height) + var(--editor-auth-gap));
    overflow:hidden auto;
    overscroll-behavior-y:contain;
    scrollbar-width:thin;
  }
  .settings-body {
    display:grid;
    inline-size:calc(var(--editor-segments-width) - var(--editor-arrow-space));
    gap:var(--editor-auth-gap);
    padding:var(--segment-inset) var(--editor-options-inset) var(--editor-action-gap);
  }
  @media (max-width:767px) {
    .editor { grid-template-columns:minmax(0, 1fr); grid-template-rows:repeat(2, minmax(0, 1fr)); }
    .preview-stage { align-content:start; }
    .preview-card { --preview-art-height:clamp(80px, calc(100cqh - 58px), 300px); }
    .settings-viewport { inline-size:calc(100% + 2 * var(--gutter)); }
    .settings-body {
      /* Keep the rows centered and reserve room for reset controls outside the glass. */
      inline-size:min(var(--editor-auth-width), calc(100% - 2 * (var(--control-height) + var(--segment-inset))));
    }
  }
  @media (max-width:500px) { .preview-card { --preview-shelf-width:145px; } }
  .sample-controls { display:grid; gap:var(--editor-auth-gap); min-inline-size:0; }
  .slot-settings { display:grid; gap:var(--editor-auth-gap); width:100%; min-inline-size:0; margin:0; padding:0; border:0; }
  .slot-settings legend { padding:0 0 var(--editor-action-gap); color:var(--editor-row-ink); font-size:var(--text-sm); font-weight:var(--weight-semibold); line-height:var(--leading-menu); }
  .add-layer { justify-self:start; }
  .layer-actions { display:flex; flex-wrap:wrap; justify-content:space-between; gap:var(--editor-action-gap); }
  .layer-field { display:flex; align-items:start; gap:var(--editor-action-gap); }
  .layer-field.removable { --select-reset-extra:calc(var(--control-height) + var(--editor-action-gap)); }
  .layer-field > :global(.select-field) { flex:1; }
  .layer-field > :global(.icon-button) { block-size:var(--editor-row-height); margin-block-start:var(--editor-menu-frame); }
  .layer-field > :global(.icon-button > svg) { inline-size:var(--icon-inline); block-size:var(--icon-inline); }
  .glass-separator { display:flex; justify-content:center; }
  .separator-pill { inline-size:32px; block-size:var(--editor-action-gap); border-radius:var(--editor-menu-radius); }
</style>
