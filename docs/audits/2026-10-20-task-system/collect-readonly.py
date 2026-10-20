import json,pathlib,subprocess,os,datetime
# Intentionally exports only safe task metadata, never full action payloads or credentials.
root=pathlib.Path('.data/task-audit-20261020');root.mkdir(parents=True,exist_ok=True,mode=0o700)
queries={
 'counts':"select kind,state,count(*)::int as count,min(created_at) as oldest,max(updated_at) as newest,max(attempts) as max_attempts from outbox_actions group by kind,state order by kind,state",
 'representatives':"with ranked as (select a.id,a.kind,a.state,a.attempts,a.created_at,a.updated_at,a.next_attempt_at,a.locked_at,a.last_error,a.payload->'_jobFailure' as failure,a.payload->'_jobOutcome' as outcome,a.payload->>'_jobPurpose' as purpose,c.instance_id as instance_id,count(*) over(partition by a.kind,a.state,c.instance_id)::int as \"taskCount\",row_number() over(partition by a.kind,a.state,c.instance_id order by a.created_at,a.id) as position from outbox_actions a left join provider_connections c on c.id=a.connection_id where a.state in ('pending','running','failed') and (c.id is null or a.account_generation is null or a.account_generation=c.account_generation)) select id,kind,state,attempts,created_at as \"createdAt\",updated_at as \"updatedAt\",next_attempt_at as \"nextAttemptAt\",last_error as \"lastError\",failure,outcome,purpose,instance_id as \"instanceId\",\"taskCount\" from ranked where position=1",
 'schedules':"select id,provider,name,enabled,credentials is not null as configured,settings->'schedule' as schedule,settings->'companion'->>'status' as companion_status,settings->>'jobsRetryAt' as cooldown from provider_instances order by provider,id",
 'accounts':"select c.id,c.instance_id as \"instanceId\",c.external_user_id as \"externalUserId\",u.role,jsonb_build_object('importAchievements',c.settings->'importAchievements','liveRead',c.settings->'liveRead','sync',c.settings->'sync') as settings from provider_connections c join users u on u.id=c.user_id where c.status='connected' and not u.disabled",
 'failure_details':"select kind,state,attempts,created_at,updated_at,payload->'_jobFailure' as failure,left(last_error,250) as error from outbox_actions where state='failed' order by created_at",
 'generations':"select a.kind,a.state,count(*)::int as count from outbox_actions a join provider_connections c on c.id=a.connection_id where a.state in ('pending','failed','running') and a.account_generation is not null and a.account_generation<>c.account_generation group by 1,2",
 'payload_sizes':"select kind,max(octet_length(payload::text)) as max_bytes,count(*) filter(where octet_length(payload::text)>262144)::int as over_256k from outbox_actions where state in ('pending','running','failed') group by kind",
 'last_successes':"select kind,max(updated_at) as last_success,count(*) filter(where updated_at>now()-interval '10 minutes')::int as last_10_minutes from outbox_actions where state='succeeded' group by kind",
 'notification_counts':"select a.state,count(*)::int as tasks,count(n.id)::int as notification_rows,count(n.id) filter(where n.read_at is not null)::int as read_notices from outbox_actions a left join notifications n on n.user_id=a.user_id and n.source_key='outbox:'||a.id::text where a.state='failed' group by a.state",
}
result={'collectionStartedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
for key,query in queries.items():
 statement="begin read only; set local statement_timeout='30s'; select coalesce(jsonb_agg(q),'[]'::jsonb) from ("+query+") q; commit;"
 p=subprocess.run(['container','exec','--user','postgres','coast','psql','-d','coast','-X','-q','-t','-A','-v','ON_ERROR_STOP=1','-c',statement],capture_output=True,text=True)
 if p.returncode:result[key]={'error':p.stderr.strip()};continue
 result[key]=json.loads(p.stdout)
result['collectionFinishedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
path=root/('readonly-task-evidence-'+datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')+'.private.json')
with path.open('x') as handle: handle.write(json.dumps(result,indent=2))
os.chmod(path,0o600)
print(str(path))
print(json.dumps({k:len(v) if isinstance(v,list) else v for k,v in result.items()}))
