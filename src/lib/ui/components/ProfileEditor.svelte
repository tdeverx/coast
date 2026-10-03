<script lang="ts">
  import FormActions from './FormActions.svelte';
  import Field from './Field.svelte';
  import RowFeedback from './RowFeedback.svelte';
  import { createOperation } from '$lib/ui/operation.svelte';
  import type { ProfileSettings } from '$lib/server/db/schema';
  import { message } from '$lib/ui/client';
  import { useClient } from '$lib/ui/client-context';
  import Avatar from './Avatar.svelte';
  import Dialog from './Dialog.svelte';
  import Button from './Button.svelte';
  import RowFilter from './RowFilter.svelte';

  const { api, change } = useClient();
  const operation = createOperation();
  const busy = $derived(operation.busy);

  let {
    open = $bindable(false),
    profile,
    username,
  }: { open: boolean; profile: ProfileSettings; username: string } = $props();
  let displayName = $state(''),
    bio = $state(''),
    avatar = $state<string | null>(null),
    error = $state(''),

    reading = $state(false);
  let avatarVersion = 0;
  let iconChoices=$state<{id:string;provider:string;name:string}[]>([]),iconChoice=$state('');
  $effect(() => {
    if (open) {
      displayName = profile.displayName ?? '';
      bio = profile.bio ?? '';
      avatar = profile.avatar ?? null;
      error = '';iconChoice='';iconChoices=[];
      const controller=new AbortController();
      void api<typeof iconChoices>('profile/avatars',undefined,'GET',{signal:controller.signal}).then(choices=>{if(!controller.signal.aborted)iconChoices=choices;}).catch(()=>{});
      return ()=>{controller.abort();avatarVersion++;};
    }
  });
  async function selectAvatar(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    iconChoice='';
    await prepareAvatar(file);
  }
  async function prepareAvatar(file:Blob){
    const version = ++avatarVersion;
    error = '';
    reading = true;
    let url = '';
    try {
      if (
        !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error('Choose a PNG, JPEG, WebP or GIF smaller than 5 MB.');
      url = URL.createObjectURL(file);
      const image = new Image();
      image.src = url;
      await image.decode();
      if (file.type === 'image/gif') {
        const result = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Your browser could not read this GIF.'));
          reader.readAsDataURL(file);
        });
        if (version === avatarVersion) avatar = result;
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 256;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Your browser could not prepare this image.');
      const edge = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(
        image,
        (image.naturalWidth - edge) / 2,
        (image.naturalHeight - edge) / 2,
        edge,
        edge,
        0,
        0,
        256,
        256
      );
      const result = canvas.toDataURL('image/webp', 0.85);
      if (result.length > 220000) throw new Error('Choose a smaller image.');
      if (version === avatarVersion) avatar = result;
    } catch (e) {
      error = message(e);
    } finally {
      if (url) URL.revokeObjectURL(url);
      if (version === avatarVersion) reading = false;
    }
  }
  async function selectProvider(id:string){
    iconChoice=id;if(!id)return;
    const version=++avatarVersion;error='';reading=true;
    try{
      const response=await fetch(`/api/v1/profile/avatars/${id}`);
      if(!response.ok){const result=await response.json().catch(()=>null);throw Error(result?.error??'The service icon could not be imported.');}
      const image=await response.blob();
      if(version!==avatarVersion||!open)return;
      await prepareAvatar(image);
    }catch(cause){error=message(cause);}finally{reading=false;}
  }
  async function save() {
    if (busy) return;

    error = '';
    const completed = await operation.run(async () => {
      await change('profile', { action: 'edit', displayName, bio, avatar });
      open = false;
    });
    if (!completed) error = operation.error;
  }
</script>

<Dialog bind:open title="Edit profile">
  <form
    class="stack"
    onsubmit={(event) => {
      event.preventDefault();
      void save();
    }}
  >
    {#if error}<RowFeedback error={error} tag="p" class="notice error" />{/if}
    <div class="avatar-row">
      <Avatar name={displayName || username} src={avatar} label="Avatar preview" class="preview" size={80} />
      <div class="stack">
        <Field label="Avatar" class=""><input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onchange={selectAvatar}
            disabled={busy || reading}
          /></Field>{#if avatar}<Button
            emphasis="subtle"
            onclick={() => {
              avatarVersion++;
              avatar = null;
              reading = false;
            }}>Remove avatar</Button
          >{/if}
      </div>
    </div>
    {#if iconChoices.length}<RowFilter selection groups={[{label:"Connected profile icon", value:iconChoice, options:[{value:'',label:'Choose a connected service'},...iconChoices.map(choice=>({value:choice.id,label:`${choice.provider==='jellyfin'?'Jellyfin':'Trakt'} · ${choice.name}`}))], change:value=>{if(!busy&&!reading)void selectProvider(value);}}]} />{/if}
    <p class="small">Saved locally in Coast. GIFs keep their animation; other images are cropped to a square. Visibility follows your privacy settings.</p>
    <Field label="Display name" class=""><input
        bind:value={displayName}
        maxlength="60"
        placeholder={username}
        autocomplete="nickname"
      /></Field>
    <Field label="Bio" class=""><textarea
        bind:value={bio}
        maxlength="240"
        rows="3"
        placeholder="A little about your taste in stories."
      ></textarea></Field>
    <p class="small">{bio.length}/240</p>
    <FormActions cancel={() => open = false}>
      <Button type="submit" disabled={busy || reading}>{reading ? 'Preparing avatar…' : busy ? 'Saving…' : 'Save profile'}</Button>
    </FormActions>
  </form>
</Dialog>

<style>
  .avatar-row {
    display: flex;
    align-items: center;
    gap: 20px;
    min-width: 0;
  }
  .avatar-row > .stack {
    min-width: 0;
    flex: 1;
  }
  :global(.avatar.preview) {
    width: 80px;
    height: 80px;
    flex: none;
    border-radius: 50%;
    overflow: hidden;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--white) calc(18 / 255 * 100%), transparent);
    font-size: var(--text-2xl);
  }
  :global(.avatar.preview img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  input[type='file'] {
    max-width: 100%;
    font-size: var(--text-sm);
  }
  textarea {
    width: 100%;
    resize: vertical;
  }
</style>
