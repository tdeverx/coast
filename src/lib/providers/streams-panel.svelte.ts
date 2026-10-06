import {page} from '$app/state';
import {pushState,replaceState} from '$app/navigation';
export function openStreams(){
 const url=new URL(window.location.href);
 url.searchParams.delete('friends');url.searchParams.delete('notifications');url.searchParams.delete('notificationKind');url.searchParams.set('streams','true');
 pushState(url,{...page.state,friendsPopover:false,notificationPopover:false,streamsPopover:true});
}
export function closeStreams(){
 const url=new URL(window.location.href);url.searchParams.delete('streams');
 replaceState(url,{...page.state,streamsPopover:false});
}
