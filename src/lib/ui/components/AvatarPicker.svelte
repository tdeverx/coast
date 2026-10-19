<script lang="ts">
 import Field from './Field.svelte';
 import Avatar from './Avatar.svelte';
 import Button from './Button.svelte';
 import RowFilter from './RowFilter.svelte';
 import {message} from '$lib/ui/client';
 import {useClient, reportFailure } from '$lib/ui/client-context';
 const {fetch:requestAvatar}=useClient();
 let {avatar=$bindable(null),reading=$bindable(false),name,disabled=false,choices}:{avatar?:string|null;reading?:boolean;name:string;disabled?:boolean;choices:{id:string;provider:string;name:string}[]}=$props();
 let error=$state(''),iconChoice=$state('');
 const iconChoices=$derived(choices),busy=$derived(disabled);
 let avatarVersion=0;
 let providerRequest:AbortController|undefined;
 let fileReader:FileReader|undefined;
 type AvatarImage={image:HTMLImageElement;url:string;released:boolean};
 let pendingImage:AvatarImage|undefined;
 const providerKey=$derived(`${name}:${choices.map(choice=>choice.id).join(',')}`);
 function releaseImage(resource:AvatarImage|undefined){if(!resource||resource.released)return;resource.released=true;resource.image.removeAttribute('src');URL.revokeObjectURL(resource.url);if(pendingImage===resource)pendingImage=undefined;}
 function cancelRead(){avatarVersion++;providerRequest?.abort();providerRequest=undefined;fileReader?.abort();fileReader=undefined;releaseImage(pendingImage);reading=false;}
 function beginRead(){cancelRead();error='';reading=true;return avatarVersion;}
 $effect(()=>{if(providerKey)return cancelRead;});
  async function selectAvatar(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    iconChoice='';
    await prepareAvatar(file,beginRead());
  }
  async function prepareAvatar(file:Blob,version:number){
    let resource:AvatarImage|undefined;
    try {
      if (
        !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ||
        file.size > 5 * 1024 * 1024
      )
        throw new Error('Choose a PNG, JPEG, WebP or GIF smaller than 5 MB.');
      const image = new Image();
      resource={image,url:URL.createObjectURL(file),released:false};pendingImage=resource;
      image.src = resource.url;
      await image.decode();
      if(version!==avatarVersion)return;
      if (file.type === 'image/gif') {
        releaseImage(resource);
        const result = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          fileReader=reader;
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Your browser could not read this GIF.'));
          reader.onabort = () => reject(new DOMException('Avatar reading cancelled.','AbortError'));
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
      if(version===avatarVersion)error = message(e);
    } finally {
      releaseImage(resource);
      if (version === avatarVersion){reading = false;fileReader=undefined;}
    }
  }
  async function selectProvider(id:string){
    iconChoice=id;if(!id){cancelRead();return;}
    const version=beginRead(),controller=new AbortController();providerRequest=controller;
    try{
      const response=await requestAvatar(`/api/v1/profile/avatars/${id}`,{signal:controller.signal});
      if(!response.ok){const result=await response.json().catch(()=>null);throw Error(result?.error??'The service icon could not be imported.');}
      const image=await response.blob();
      if(version!==avatarVersion||controller.signal.aborted)return;
      await prepareAvatar(image,version);
    }catch(cause){if(version===avatarVersion&&!controller.signal.aborted)error=message(cause);}finally{if(version===avatarVersion)reading=false;if(providerRequest===controller)providerRequest=undefined;}
  }
  reportFailure(()=>error);
</script>
    <div class="avatar-row">
      <Avatar name={name} src={avatar} label="Avatar preview" class="preview" size={80} />
      <div class="stack">
        <Field label="Avatar" class=""><input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onchange={selectAvatar}
            disabled={busy || reading}
          /></Field>{#if avatar}<Button
            emphasis="subtle"
            onclick={() => {
              cancelRead();
              avatar = null;
              reading = false;
            }}>Remove avatar</Button
          >{/if}
      </div>
    </div>
    {#if iconChoices.length}<RowFilter selection groups={[{label:"Connected profile icon", value:iconChoice, options:[{value:'',label:'Choose a connected service'},...iconChoices.map(choice=>({value:choice.id,label:`${choice.provider==='jellyfin'?'Jellyfin':'Trakt'} · ${choice.name}`}))], change:value=>{if(!busy&&!reading)void selectProvider(value);}}]} />{/if}
    <p class="small">Saved locally in Coast. GIFs keep their animation; other images are cropped to a square. Visibility follows your privacy settings.</p>
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
</style>
