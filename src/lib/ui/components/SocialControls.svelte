<script lang="ts">
 import type {ActivityStatus} from '#lib/social/status.js';
 import Avatar from './Avatar.svelte';
 let {
  friends = [], total = friends.length, showOverflow = true, size = 32, compact = false,
  href, label = 'Friends with a relationship to this media',
 }: {
  href?: string;
  label?: string;
  size?: number;
  compact?: boolean;
  showOverflow?: boolean;
  friends: { username: string; avatar?: string | null; status?: ActivityStatus }[];
  total?: number;
 } = $props();
 const visibleFriends=$derived(friends.slice(0,3));
</script>
{#snippet heads()}
 {#each visibleFriends as friend}
  {#snippet avatar()}<Avatar {size} name={friend.username} src={friend.avatar} status={friend.status} border={compact ? 'none' : 'default'} />{/snippet}
  {#if href}<span class="friend-avatar" title={friend.username}>{@render avatar()}</span>
  {:else}<a class="friend-avatar" href={`/profile/${encodeURIComponent(friend.username)}`} title={friend.username} aria-label={`${friend.username} has a relationship with this media`}>{@render avatar()}</a>{/if}
 {/each}
 {#if showOverflow&&total>visibleFriends.length}<span class="friend-overflow small quiet">+{total-visibleFriends.length}</span>{/if}
{/snippet}
{#if href}<a class="friend-heads" class:compact {href} style:--head-size={`${size}px`} aria-label={label}>{@render heads()}</a>
{:else}<div class="friend-heads" class:compact style:--head-size={`${size}px`} aria-label={label}>{@render heads()}</div>{/if}
<style>
.friend-heads{display:flex;align-items:center;gap:0;flex:none;text-decoration:none;max-width:100%;width:fit-content;border-radius:999px;}
.friend-avatar :global(.status-dot){left:0;right:auto}
.friend-avatar+.friend-avatar{margin-left:calc(var(--head-size) / -2)}
.friend-overflow{margin-left:6px}
.friend-avatar{position:relative;display:grid;place-items:center;width:var(--head-size);height:var(--head-size);border-radius:50%;background:var(--surface);border:1px solid var(--line);font-size:var(--text-sm);color:var(--ink)}
.compact { --friend-overlap: calc(var(--head-size) * 0.4); }
.compact .friend-avatar {
  flex: none;
  border: 0;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--white) 24%, var(--canvas));
}
.compact .friend-avatar :global(.avatar) { font-weight: var(--weight-semibold); }
.compact .friend-avatar + .friend-avatar { margin-left: calc(-1 * var(--friend-overlap)); }
.compact .friend-avatar:has(+ .friend-avatar) :global(.avatar) { padding-inline-end: var(--friend-overlap); }
.compact .friend-overflow {
  display: grid;
  place-items: center;
  min-width: var(--head-size);
  height: var(--head-size);
  padding-inline: 4px;
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink);
}
</style>
