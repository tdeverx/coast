import type {ExperimentalFeatures} from '$lib/experimental';
import type {SessionUser} from '$lib/server/auth';
declare global {namespace App {interface PageData extends ExperimentalFeatures {} interface PageState {mediaDetailHref?:string;mediaDetailDepth?:number;mediaDetailShelf?:{href:string;position:import('$lib/ui/shelf-position').ShelfPosition};friendsPopover?:boolean;notificationPopover?:boolean;streamsPopover?:boolean;notificationKind?:string} interface Locals {user:SessionUser|null;expiresAt:Date|null;setup:boolean}}}
export {};
