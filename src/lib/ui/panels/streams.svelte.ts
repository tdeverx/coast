import { page } from '$app/state';
import { goto } from '$app/navigation';

export function openStreams() {
        const url = new URL(window.location.href);

        url.searchParams.delete('friends');
        url.searchParams.delete('notifications');
        url.searchParams.delete('notificationKind');
        url.searchParams.set('streams', 'true');

        goto(url, {
                shallow: true, reset: false,
                state: {
                        ...page.state,
                        friendsPopover: false,
                        notificationPopover: false,
                        streamsPopover: true
                }
        });
}

export function closeStreams() {
        const url = new URL(window.location.href);

        url.searchParams.delete('streams');

        goto(url, {
                shallow: true, reset: false,
                replace: true,
                state: { ...page.state, streamsPopover: false }
        });
}
