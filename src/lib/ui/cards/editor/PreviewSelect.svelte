<script lang="ts" generics="Value extends string">
  import { tick } from 'svelte';
  import Button from '#lib/ui/components/Button.svelte';
  import Icon, { type IconName } from '#lib/ui/components/Icon.svelte';
  import AuthSurface from '#lib/auth/ui/AuthSurface.svelte';
  import PreviewValueInput, { type PreviewValueEditor } from './PreviewValueInput.svelte';

  type Option = {
    id: Value;
    label: string;
    group?: string;
    icon?: IconName;
    logo?: string | null;
    thumbnail?: string | null;
    detail?: string;
    textSize?: 'small' | 'medium' | 'large';
  };
  let { label, options, value = $bindable(), defaultValue, onchange, valueEditor, presentation = 'pinned' }: {
    label: string;
    options: readonly Option[];
    value: Value;
    defaultValue?: Value;
    onchange?: (value: Value) => void;
    valueEditor?: PreviewValueEditor;
    presentation?: 'centered' | 'pinned';
  } = $props();
  const id = $props.id();
  let open = $state(false);
  let revealed = $state(false);
  let root: HTMLDivElement;
  let anchor: HTMLDivElement;
  let trigger: HTMLButtonElement;
  let menu: HTMLDivElement;
  let choices = $state<HTMLDivElement>();
  let aboveSize = $state(0);
  let belowSize = $state(0);
  let space = $state({ above: 0, below: 0, row: 0, height: 0, top: 0, left: 0, width: 0 });
  const pinned = $derived(presentation === 'pinned');
  const visibleBelow = $derived(pinned ? Math.min(space.below, belowSize) : belowSize);
  const selectedIndex = $derived(options.findIndex(option => option.id === value));
  const selected = $derived(options[selectedIndex]);
  const selectionChanged = $derived(defaultValue !== undefined && value !== defaultValue);
  const valueChanged = $derived(valueEditor && valueEditor.value !== (valueEditor.defaultValue ?? ''));
  const hasVisuals = $derived(options.some(option => option.logo || option.thumbnail || option.icon));
  const earlier = $derived(options.slice(0, Math.max(0, selectedIndex)));
  const later = $derived(options.slice(selectedIndex + 1));
  const direction = $derived(space.above < space.row && space.below > space.above ? 'down'
    : space.below < space.row && space.above > space.below ? 'up' : 'both');
  const aboveChoices = $derived(direction === 'down' ? [] : direction === 'up' ? [...later, ...earlier] : earlier);
  const belowChoices = $derived(direction === 'up' ? [] : direction === 'down' ? [...later, ...earlier] : later);

  $effect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.contains(event.target)) open = false;
    };
    const reposition = (event: Event) => {
      const target = event.target;
      if (target instanceof HTMLElement && (!target.contains(anchor) || root.contains(target))) return;
      const bounds = anchor.getBoundingClientRect();
      if (target instanceof HTMLElement) {
        const viewport = target.getBoundingClientRect();
        if (bounds.bottom <= viewport.top || bounds.top >= viewport.bottom) {
          open = false;
          return;
        }
      }
      if (pinned) fit(bounds);
      else space = { ...space, top: bounds.top, left: bounds.left, width: bounds.width };
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', reposition, { capture: true, passive: true });
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', reposition, true);
    };
  });

  function fit(bounds = anchor.getBoundingClientRect()) {
    const editor = root.closest('.editor')?.getBoundingClientRect();
    const viewportInset = 8;
    const top = Math.max(viewportInset, editor?.top ?? 0);
    const bottom = Math.min(innerHeight - viewportInset, editor?.bottom ?? innerHeight);
    space = {
      above: Math.max(0, bounds.top - top),
      below: Math.max(0, bottom - bounds.bottom),
      row: trigger.offsetHeight,
      height: bounds.height,
      top: bounds.top,
      left: bounds.left,
      width: bounds.width,
    };
  }

  export function close() {
    open = false;
    trigger.focus({ preventScroll: true });
  }

  async function expand() {
    fit();
    aboveSize = 0;
    belowSize = 0;
    revealed = false;
    open = true;
    await tick();
    if (!open) return;
    const extraHeight = Math.max(0, Math.min(320, innerHeight * 0.55) - space.height);
    if (pinned && choices) {
      const gap = parseFloat(getComputedStyle(choices).marginBlockStart);
      belowSize = options.length ? Math.min(extraHeight, choices.scrollHeight + gap) : 0;
      const needed = Math.min(belowSize, 2 * space.row + gap) - space.below;
      const scroller = root.closest<HTMLElement>('.settings-scroll');
      // Make room below low fields before revealing the choices.
      if (needed > 0 && scroller) {
        scroller.scrollTop += needed;
        fit();
      }
      await tick();
      if (!open) return;
      const checkedChoice = choices.querySelector<HTMLElement>('[aria-current="true"]');
      if (checkedChoice) scrollToChoice(checkedChoice, choices);
      revealed = true;
      return;
    }
    const rowBounds = trigger.getBoundingClientRect();
    const valueBounds = valueEditor ? trigger.nextElementSibling?.getBoundingClientRect() : undefined;
    const inlineHeight = (valueBounds?.bottom ?? rowBounds.bottom) - rowBounds.top;
    const offset = rowBounds.top - menu.getBoundingClientRect().top + menu.scrollTop;
    const before = Math.max(0, Math.min(space.above, offset));
    const after = Math.min(space.below, Math.max(0, menu.scrollHeight - offset - inlineHeight));
    aboveSize = Math.min(before, Math.max(extraHeight / 2, extraHeight - after));
    belowSize = Math.min(after, extraHeight - aboveSize);
    await tick();
    if (!open) return;
    menu.scrollTop = offset - aboveSize;
    revealed = true;
  }

  function select(next: Value) {
    if (next !== value) {
      value = next;
      onchange?.(next);
    }
    close();
  }

  function reset() {
    if (defaultValue === undefined) return;
    select(defaultValue);
  }

  function resetValue() {
    valueEditor?.update(valueEditor.defaultValue ?? '');
    open = false;
    menu.querySelector('input')?.focus({ preventScroll: true });
  }

  async function navigate(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (!open && event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const current = event.currentTarget as HTMLButtonElement;
    event.preventDefault();
    if (!open) await expand();
    if (!open) return;
    const rows = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    const index = rows.indexOf(current);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
    const row = rows[next];
    if (!row) return;
    row.focus({ preventScroll: true });
    if (pinned && row === trigger) return;
    scrollToChoice(row, choices ?? menu);
  }

  function scrollToChoice(row: HTMLElement, scroller: HTMLElement) {
    const rowBounds = row.getBoundingClientRect();
    const listBounds = scroller.getBoundingClientRect();
    if (rowBounds.top < listBounds.top) scroller.scrollTop += rowBounds.top - listBounds.top;
    else if (rowBounds.bottom > listBounds.bottom) scroller.scrollTop += rowBounds.bottom - listBounds.bottom;
  }
</script>

{#snippet optionVisual(option: Option | undefined, field = false)}
  {#if option?.logo || option?.thumbnail}
    <img class="option-image" class:thumbnail={!option.logo && !field} class:field-image={field}
      src={option.logo || option.thumbnail} alt=""
      loading="lazy" decoding="async" referrerpolicy="no-referrer" />
  {:else if field || hasVisuals}
    <span class="option-icon" aria-hidden="true">
      {#if option?.icon || field}<Icon name={option?.icon ?? 'list'} size={16} />{/if}
    </span>
  {/if}
{/snippet}

{#snippet optionCopy(option: Option, textId: string, detailId: string | undefined)}
  {@render optionVisual(option)}
  <span class="option-copy">
    <span id={textId} class="option-label" data-text-size={option.textSize}>{option.label}</span>
    {#if option.detail}<span id={detailId} class="option-detail">{option.detail}</span>{/if}
  </span>
{/snippet}

{#snippet optionRows(items: readonly Option[], precedingGroup?: string)}
  {#each items as option, index (option.id)}
    {@const detailId = option.detail && `${id}-detail-${option.id}`}
    {#if option.group && option.group !== (index ? items[index - 1].group : precedingGroup)}
      <span class="menu-label">{option.group}</span>
    {/if}
    <button type="button" class="menu-row"
      aria-current={option.id === value ? 'true' : undefined}
      aria-labelledby={`${id}-option-${option.id}`}
      aria-describedby={detailId}
      onclick={() => select(option.id)} onkeydown={navigate}>
      {@render optionCopy(option, `${id}-option-${option.id}`, detailId)}
      {#if option.id === value}<Icon name="check" size={16} />{/if}
    </button>
  {/each}
{/snippet}

<div class="select-field" class:editable={!!valueEditor} bind:this={root}
  onfocusout={event => { if (event.relatedTarget instanceof Node && !root.contains(event.relatedTarget)) open = false; }}>
  <div class="select-anchor" class:expanded={open} bind:this={anchor}>
    <div class="select-panel" class:revealed={open && revealed}
      style:--above={open ? `${aboveSize}px` : '0px'} style:--below={open ? `${visibleBelow}px` : '0px'}
      style:--anchor-top={`${space.top}px`} style:--anchor-left={`${space.left}px`} style:--anchor-width={`${space.width}px`}>
      <AuthSurface resizable>
        <div id={pinned ? undefined : `${id}-choices`} class="menu-content options" class:pinned
          role="group" aria-label={`${label} options`} bind:this={menu}>
          {#if open && !pinned}{@render optionRows(aboveChoices)}{/if}
          <button type="button" class="menu-row current" bind:this={trigger}
            aria-expanded={open} aria-controls={`${id}-choices`} aria-labelledby={`${id}-label`}
            aria-describedby={`${id}-value`}
            onclick={() => open ? open = false : expand()} onkeydown={navigate}>
            {@render optionVisual(selected, true)}
            <span id={`${id}-label`} class="field-label">{label}</span>
            <span id={`${id}-value`} class="field-value menu-row-note"
              title={selected?.label}>{selected?.label ?? 'None'}</span>
            {#if open && !pinned && selected}<Icon name="check" size={16} />{/if}
            <span class="chevron" class:expanded={open} aria-hidden="true"><Icon name="right" size={16} /></span>
          </button>
          {#if valueEditor}
            <PreviewValueInput {...valueEditor} label={`${label} value`} onfocus={() => { open = false; }} />
          {/if}
          {#if pinned}
            <div id={`${id}-choices`} class="choice-list" hidden={!open || !options.length} bind:this={choices}>
              {#if open}{@render optionRows(options)}{/if}
            </div>
          {:else if open}
            {@render optionRows(belowChoices, aboveChoices.at(-1)?.group)}
          {/if}
        </div>
      </AuthSurface>
    </div>
  </div>
  {#if selectionChanged}
    <div class="reset-action">
      <Button size="icon" emphasis="subtle" icon="retry" danger
        label={`Reset ${label} to default`} title={`Reset ${label} to default`} onclick={reset} />
    </div>
  {/if}
  {#if valueChanged}
    <div class="reset-action value-reset">
      <Button size="icon" emphasis="subtle" icon="retry" danger
        label={`Reset ${label} value to default`} title={`Reset ${label} value to default`} onclick={resetValue} />
    </div>
  {/if}
</div>

<style>
  .select-field { --field-content-height:var(--editor-row-height); position:relative; display:grid; min-inline-size:0; }
  .select-field.editable { --field-content-height:calc(2 * var(--editor-row-height) + var(--editor-menu-row-gap)); }
  .reset-action {
    position:absolute;
    inset-inline-start:calc(100% + var(--editor-side-action-offset) + var(--select-reset-extra, 0px));
    inset-block-start:calc(var(--editor-menu-frame) + (var(--editor-row-height) - var(--control-height)) / 2);
  }
  .value-reset { margin-block-start:calc(var(--editor-row-height) + var(--editor-menu-row-gap)); }
  .select-anchor {
    position:relative;
    block-size:calc(var(--field-content-height) + 2 * var(--editor-menu-frame));
    z-index:0;
    transition:z-index 0s var(--fast);
  }
  .select-anchor.expanded { z-index:100; transition:none; }
  .select-panel {
    position:absolute;
    inset-inline:0;
    inset-block-start:0;
    inline-size:100%;
    block-size:calc(var(--field-content-height) + 2 * var(--editor-menu-frame) + var(--above) + var(--below));
  }
  .expanded .select-panel {
    position:fixed;
    inset:calc(var(--anchor-top) - var(--above)) auto auto var(--anchor-left);
    inline-size:var(--anchor-width);
  }
  .select-panel.revealed { animation:reveal-select var(--fast) var(--ease); }
  @keyframes reveal-select {
    from { clip-path:inset(var(--above) 0 var(--below) round var(--editor-menu-radius)); }
    to { clip-path:inset(0 round var(--editor-menu-radius)); }
  }
  .current { min-inline-size:0; block-size:var(--editor-row-height); min-block-size:var(--editor-row-height); }
  .field-label { flex:1; min-inline-size:0; }
  .field-value { max-inline-size:50%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .option-copy { display:grid; flex:1; min-inline-size:0; gap:var(--editor-row-text-gap); }
  .option-label { overflow-wrap:anywhere; }
  .option-detail { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .option-detail { color:var(--muted); font-size:var(--text-sm); font-weight:var(--weight-regular); line-height:var(--leading-tight); }
  .option-label[data-text-size='small'] { font-size:var(--text-sm); }
  .option-label[data-text-size='medium'] { font-size:var(--text-md); }
  .option-label[data-text-size='large'] { font-size:var(--text-xl); }
  .option-icon { display:grid; flex:none; place-items:center; inline-size:var(--menu-icon-size); block-size:var(--menu-icon-size); }
  .option-image { inline-size:var(--menu-control-icon-size); block-size:var(--menu-control-icon-size); object-fit:contain; flex:none; }
  .option-image.field-image { inline-size:var(--menu-icon-size); block-size:var(--menu-icon-size); }
  .option-image.thumbnail { block-size:calc(1.5 * var(--menu-control-icon-size)); object-fit:cover; border-radius:var(--segment-inset); }
  .options .menu-row { min-block-size:var(--editor-row-height); }
  .chevron { display:inline-flex; flex:none; transition:transform var(--motion) var(--ease); }
  .chevron.expanded { transform:rotate(90deg); }
  .expanded .current {
    color:var(--ink);
    background:var(--editor-row-highlight);
  }
  .options { min-block-size:0; max-block-size:none; overflow:auto; scrollbar-width:thin; overscroll-behavior:contain; }
  .options.pinned { display:flex; flex-direction:column; overflow:hidden; }
  .pinned > :global(:not(.choice-list)) { flex:none; }
  .choice-list:not([hidden]) {
    display:grid;
    align-content:start;
    grid-template-columns:minmax(0, 1fr);
    gap:var(--menu-inset);
    min-block-size:0;
    overflow:auto;
    scrollbar-width:thin;
    overscroll-behavior:contain;
  }
  .options .menu-label { padding-block:calc(2 * var(--menu-inset)) var(--menu-inset); }
  @media (prefers-reduced-motion: reduce) {
    .select-anchor, .chevron { transition:none; }
    .select-panel.revealed { animation:none; }
  }
</style>
