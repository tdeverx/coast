import {page} from '$app/state';
import {pushState,replaceState} from '$app/navigation';
export function openFriends(){
 const url=new URL(window.location.href);
 if(page.state.friendsPopover??url.searchParams.get('friends')==='true')return;
 const alreadyLinked=url.searchParams.get('friends')==='true';
 url.searchParams.delete('notifications');url.searchParams.delete('notificationKind');url.searchParams.set('friends','true');
 (alreadyLinked?replaceState:pushState)(url,{...page.state,notificationPopover:false,friendsPopover:true});
}
export function closeFriends(){
 const url=new URL(window.location.href);url.searchParams.delete('friends');
 replaceState(url,{...page.state,friendsPopover:false});
}
