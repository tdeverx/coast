import type {ExperimentalFeatures} from '#lib/experimental.js';
import type {SessionUser} from '#lib/server/auth/index.js';
declare global {namespace App {interface PageData extends ExperimentalFeatures {} interface PageState {mediaDetailHref?:string;mediaDetailDepth?:number;mediaDetailShelf?:{href:string;position:import('#lib/ui/shelf-position.js').ShelfPosition};friendsPopover?:boolean;notificationPopover?:boolean;streamsPopover?:boolean;notificationKind?:string} interface Locals {user:SessionUser|null;expiresAt:Date|null;setup:boolean}}}
export {};
