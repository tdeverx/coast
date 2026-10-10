import { page } from '$app/state';
import { pushState,replaceState } from '$app/navigation';
export function openNotifications(kind?:string){
 if(new URL(window.location.href).searchParams.get('notifications')==='true')return;
 const url=new URL(window.location.href);url.searchParams.set('notifications','true');
 url.searchParams.delete('friends');
 url.searchParams.delete('streams');
 if(kind&&kind!=='all')url.searchParams.set('notificationKind',kind);else url.searchParams.delete('notificationKind');
 pushState(url,{...page.state,streamsPopover:false,friendsPopover:false,notificationPopover:true,notificationKind:kind??'all'});
}
export function closeNotifications(){
 const url=new URL(window.location.href);url.searchParams.delete('notifications');url.searchParams.delete('notificationKind');
 replaceState(url,{...page.state,notificationPopover:false});
}
