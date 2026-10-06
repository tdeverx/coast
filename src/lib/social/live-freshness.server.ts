import {getSql} from '$lib/server/db';
import {providerSchedule} from '$lib/providers/schedule';
/** A service scans one account per turn. Allow a full round plus two delayed turns,
 * but never keep an unconfirmed observation longer than 30 minutes. A successful
 * empty response still clears immediately, and provider expiries remain authoritative. */
export async function liveObservationExpiry(instance:{id:string;provider:string;settings:{schedule?:unknown}},now:Date,remoteExpiry?:string){
 const [row]=await getSql()`select count(*)::int as accounts from provider_connections c join users u on u.id=c.user_id where c.instance_id=${instance.id} and c.status='connected' and not u.disabled and coalesce(c.settings->>'liveRead','true')<>'false'`;
 const schedule=providerSchedule(instance.provider,instance.settings.schedule);
 const lifetime=Math.min(30,Math.max(2,(Number(row.accounts)+2)*schedule.liveActiveMinutes))*60000;
 const expiry=now.getTime()+lifetime;
 return new Date(remoteExpiry?Math.min(Date.parse(remoteExpiry),expiry):expiry);
}
