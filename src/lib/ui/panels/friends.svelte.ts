import { page } from '$app/state';
import { goto } from '$app/navigation';
export function openFriends() {
        const url = new URL(window.location.href);
        if (page.state.friendsPopover ?? url.searchParams.get('friends') === 'true') return;
        const alreadyLinked = url.searchParams.get('friends') === 'true';
        url.searchParams.delete('streams');
 url.searchParams.delete('notifications');url.searchParams.delete('notificationKind');url.searchParams.set('friends','true');
 void goto(url,{shallow:true,replace:alreadyLinked,reset:false,state:{...page.state,streamsPopover:false,notificationPopover:false,friendsPopover:true}});
}

export function closeFriends() {
        const url = new URL(window.location.href);

        url.searchParams.delete('friends');

        goto(url, {
                shallow: true, reset: false,
                replace: true,
                state: { ...page.state, friendsPopover: false }
        });
}
