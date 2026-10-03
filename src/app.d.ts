import type {SessionUser} from '$lib/server/auth';
declare global {namespace App {interface PageState {mediaModalId?:string;friendsPopover?:boolean;notificationPopover?:boolean;notificationKind?:string} interface Locals {user:SessionUser|null;expiresAt:Date|null;setup:boolean}}}
export {};
