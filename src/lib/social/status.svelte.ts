import { api } from '$lib/ui/client';
import { invalidate } from '$app/navigation';
import type { ActivityStatus, StatusPreference } from './status';
export const userStatus = $state<{preference:StatusPreference; status:ActivityStatus; busy:boolean; error:string; sharePresence:boolean}>({preference:'automatic',status:'offline',busy:false,error:'',sharePresence:true});
export function chooseStatus(preference:StatusPreference) {return updateStatus('status',{preference});}
export function sharePresence(enabled:boolean) {return updateStatus('presence',{enabled});}
async function updateStatus(action:string,body:unknown) {
 if(userStatus.busy)return;
 userStatus.busy=true;userStatus.error='';
 try {
  const result=await api<{preference:StatusPreference;status:ActivityStatus;sharePresence:boolean}>(`session/${action}`,body);
  Object.assign(userStatus,result);
  await Promise.all([invalidate('coast:session'),invalidate('coast:social')]);
 } catch(error) {userStatus.error=error instanceof Error?error.message:'Could not update your status.';}
 finally {userStatus.busy=false;}
}
export function startPresence(isPlaying:()=>boolean,refreshFriends:()=>boolean) {
 let lastInput=Date.now(),acknowledgedInput=0,inFlight=false,stopped=false;
 const controller=new AbortController();
 const input=()=>{lastInput=Date.now();};
 const events=['pointerdown','pointermove','keydown','scroll','touchstart'] as const;
 events.forEach(event=>window.addEventListener(event,input,{passive:true}));
 async function beat() {
  if(stopped||inFlight||document.visibilityState!=='visible'&&!isPlaying())return;
  inFlight=true;
  const observedInput=lastInput;
  try {
   const result=await api<{preference:StatusPreference;status:ActivityStatus;sharePresence:boolean}>('session/heartbeat',{active:isPlaying()||observedInput>acknowledgedInput},'POST',{signal:controller.signal});
   acknowledgedInput=observedInput;
   if(!userStatus.busy)Object.assign(userStatus,result);
   if(refreshFriends())await invalidate('coast:social');
  } catch { /* Presence expires naturally if a connection is interrupted. */ }
  finally {inFlight=false;}
 }
 const visible=()=>{if(document.visibilityState==='visible'){input();void beat();}};
 document.addEventListener('visibilitychange',visible);
 const timer=setInterval(()=>void beat(),30_000);
 void beat();
 return ()=>{stopped=true;controller.abort();clearInterval(timer);events.forEach(event=>window.removeEventListener(event,input));document.removeEventListener('visibilitychange',visible);};
}
