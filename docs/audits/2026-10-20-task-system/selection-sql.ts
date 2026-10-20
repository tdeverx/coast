// Generates read-only SELECT text. Does not connect, EXPLAIN or claim work.
// An optional immutable Git ref generates the original audited selector.
import {maintenanceKinds,serviceTraversalKinds,serviceTasks} from '../../../src/lib/providers/tasks';
import {dependencyScopeSql,queueOrderCteSql} from '../../../src/lib/server/queue/dependencies';
const ref=process.argv[2];
const source=ref?new TextDecoder().decode(Bun.spawnSync(['git','show',`${ref}:src/lib/server/queue/index.ts`]).stdout):await Bun.file('src/lib/server/queue/index.ts').text();
if(!source.includes('function pendingEligibleSql'))throw new Error('Queue source unavailable at requested ref.');
const slice=source.slice(source.indexOf('const independentQueueKinds='),source.indexOf('export class PermanentActionError')).replaceAll('export function ','function ');
const factory=new Function('maintenanceKinds','serviceTraversalKinds','dependencyScopeSql','queueOrderCteSql',new Bun.Transpiler({loader:'ts'}).transformSync(slice)+';return {pendingEligibleSql,accountOrderBlockedSql,agedPrioritySql,jobPrioritySql,independentQueueKinds,selection:typeof queueSelectionSql===\'function\'?queueSelectionSql:null};');
const owner=factory(maintenanceKinds,serviceTraversalKinds,dependencyScopeSql,queueOrderCteSql);
const joins="from outbox_actions candidate left join provider_connections connection on connection.id=candidate.connection_id left join provider_instances instance on instance.id=connection.instance_id or (candidate.kind in ('tmdb.refresh','tmdb.recommendations','igdb.recommendations','igdb.steam-metadata') and candidate.kind like instance.provider||'.%' and instance.id::text=candidate.payload->>'instanceId')";
const claim=owner.selection?.()??`select candidate.id ${joins} where candidate.state='pending' and ${owner.pendingEligibleSql('candidate','connection','instance')} order by ${owner.agedPrioritySql('candidate','connection')},candidate.next_attempt_at,candidate.created_at,candidate.id limit 1`;
console.log(JSON.stringify({claim,sourceSha256:Bun.SHA256.hash(source,'hex'),ref:ref??'working-tree',tasks:['jellyfin','trakt','steam','seerr','tmdb','igdb'].flatMap(provider=>serviceTasks(provider).map(task=>({provider,...task})))},null,2));
