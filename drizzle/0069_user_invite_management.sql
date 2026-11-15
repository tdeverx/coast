CREATE TABLE "account_audit" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"subject_id" uuid,
	"event" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invite_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invite_id" uuid NOT NULL,
	"user_id" uuid,
	"username" text NOT NULL,
	"add_inviter" boolean DEFAULT false NOT NULL,
	"ready_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invite_claims_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "invite_presets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"defaults" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_invite_grants" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"preset_id" uuid NOT NULL,
	"quota" integer DEFAULT 3 NOT NULL,
	CONSTRAINT "member_invite_quota_check" CHECK ("member_invite_grants"."quota" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "member_invite_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "onboarding_provisioning" ADD COLUMN "lifecycle" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_provisioning" ADD COLUMN "access_after" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding_provisioning" ADD COLUMN "active_defaults" jsonb;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "preset_id" uuid;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "preset_name" text;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "defaults" jsonb;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "max_uses" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "claim_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "member_issued" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "access_defaults" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "membership_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "membership_expired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "account_audit" ADD CONSTRAINT "account_audit_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_claims" ADD CONSTRAINT "invite_claims_invite_id_registration_invites_id_fk" FOREIGN KEY ("invite_id") REFERENCES "public"."registration_invites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invite_claims" ADD CONSTRAINT "invite_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invite_grants" ADD CONSTRAINT "member_invite_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invite_grants" ADD CONSTRAINT "member_invite_grants_preset_id_invite_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."invite_presets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_invite_requests" ADD CONSTRAINT "member_invite_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_audit_order_idx" ON "account_audit" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "account_audit_subject_idx" ON "account_audit" USING btree ("subject_id","created_at","id");--> statement-breakpoint
CREATE INDEX "invite_claims_invite_idx" ON "invite_claims" USING btree ("invite_id","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "invite_presets_name_idx" ON "invite_presets" USING btree (lower("name"));--> statement-breakpoint
CREATE INDEX "member_invite_request_state_idx" ON "member_invite_requests" USING btree ("state","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_invite_request_open_idx" ON "member_invite_requests" USING btree ("user_id") WHERE "member_invite_requests"."state" in ('pending','approved');--> statement-breakpoint
ALTER TABLE "registration_invites" ADD CONSTRAINT "registration_invites_preset_id_invite_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."invite_presets"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "registration_invite_order_idx" ON "registration_invites" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "registration_invite_issuer_idx" ON "registration_invites" USING btree ("created_by","created_at","id");--> statement-breakpoint
CREATE INDEX "users_account_order_idx" ON "users" USING btree ("created_at","id");--> statement-breakpoint
CREATE INDEX "users_membership_due_idx" ON "users" USING btree ("membership_expires_at") WHERE "users"."membership_expires_at" is not null and "users"."membership_expired_at" is null;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD CONSTRAINT "registration_invite_uses_check" CHECK ("registration_invites"."claim_count" between 0 and "registration_invites"."max_uses" and "registration_invites"."max_uses" between 1 and 50);
--> statement-breakpoint
UPDATE registration_invites SET claim_count=1 WHERE used_at IS NOT NULL;
--> statement-breakpoint
INSERT INTO invite_claims(invite_id,user_id,username,created_at,ready_at)
SELECT i.id,i.used_by,coalesce(u.username,'Deleted account'),i.used_at,
  coalesce(o.completed_at,case when u.id is not null and o.user_id is null then i.used_at end)
FROM registration_invites i LEFT JOIN users u ON u.id=i.used_by
LEFT JOIN user_onboarding o ON o.user_id=i.used_by WHERE i.used_at IS NOT NULL;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION coast_feature_enabled(subject_id uuid, feature text) RETURNS boolean LANGUAGE sql STABLE AS $$
 WITH policy AS (
   SELECT coalesce((SELECT value FROM system_settings WHERE key='coast'),'{}'::jsonb) AS c,
     coalesce(subject.settings,'{}'::jsonb) AS u, coalesce(subject.access_defaults,'{}'::jsonb) AS a,
     subject.id is not null and not subject.disabled and coalesce(subject.membership_expires_at>now(),true) as active
   FROM (SELECT subject_id AS id) requested LEFT JOIN users subject ON subject.id=requested.id
 ), admitted AS (
   SELECT *, coalesce(c->'features'->>'social','true')='true' AND coalesce(u->'features'->>'social','true')='true' AND coalesce(a->>'social','true')='true' AS social,
     coalesce(c->'features'->>'playback','true')='true' AND coalesce(u->'features'->>'playback','true')='true' AS playback FROM policy
 ) SELECT (subject_id IS NULL OR active)
 AND coalesce(a->>feature,'true')<>'false'
 AND NOT(coalesce(a->>'libraryOnly','false')='true' AND feature IN ('sharing','requests','api','personalisation','parties','planning','mediaModal','game'))
 AND CASE
 WHEN feature IN ('screen','personalisation','social','presence','playback','reader','api') THEN coalesce(c->'features'->>feature,'true')='true'
 WHEN feature IN ('music','game','book','comic','parties','planning','mediaModal') THEN coalesce(c->>CASE feature WHEN 'music' THEN 'experimentalMusic' WHEN 'game' THEN 'experimentalGaming' WHEN 'book' THEN 'experimentalBooks' WHEN 'comic' THEN 'experimentalComics' WHEN 'parties' THEN 'experimentalParties' WHEN 'planning' THEN 'experimentalPlanning' ELSE 'experimentalMediaModal' END,'false')='true'
 WHEN feature='requests' THEN coalesce(c->>'enableRequests','true')='true'
 WHEN feature='sharing' THEN coalesce(c->>'allowPlaybackSharing','false')='true'
 ELSE false END
 AND (feature='api' OR coalesce(u->'features'->>feature,'true')='true')
 AND (feature NOT IN ('presence','parties') OR social)
 AND (feature<>'sharing' OR playback) FROM admitted
$$;
--> statement-breakpoint
-- Only the originally assigned account and fresh personal observations establish access.
CREATE FUNCTION coast_managed_observation(source jsonb, verified_at timestamptz, access_after timestamptz) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT verified_at>now()-interval '24 hours' AND (access_after IS NULL OR verified_at>=access_after) AND coalesce(source->>'coastAccessKind','')<>'library-cache'
$$;
--> statement-breakpoint
CREATE FUNCTION coast_managed_schedule_open(defaults jsonb) RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH local_time AS (
    SELECT now() AT TIME ZONE (SELECT name FROM pg_timezone_names WHERE name=defaults->>'jellyfinTimeZone' LIMIT 1) as t
  )
  SELECT coalesce(jsonb_array_length(defaults#>'{jellyfin,AccessSchedules}'),0)=0 OR EXISTS (
    SELECT 1 FROM local_time, jsonb_array_elements(defaults#>'{jellyfin,AccessSchedules}') w
    WHERE (
      trim(to_char(t,'Day'))=w->>'DayOfWeek' OR w->>'DayOfWeek'='Everyday'
      OR w->>'DayOfWeek'='Weekday' AND extract(isodow from t) BETWEEN 1 AND 5
      OR w->>'DayOfWeek'='Weekend' AND extract(isodow from t) IN (6,7)
    ) AND extract(epoch from t::time)/3600>=(w->>'StartHour')::numeric
      AND extract(epoch from t::time)/3600<(w->>'EndHour')::numeric
  )
$$;
--> statement-breakpoint
CREATE FUNCTION coast_managed_catalogue(subject_id uuid) RETURNS TABLE(connection_id uuid, instance_id uuid, access_after timestamptz) LANGUAGE sql STABLE AS $$
  SELECT c.id,c.instance_id,p.access_after FROM onboarding_provisioning p
  JOIN users u ON u.id=p.user_id AND NOT u.disabled AND coalesce(u.membership_expires_at>now(),true)
  JOIN provider_connections authority ON authority.id=p.connection_id AND authority.account_generation=p.account_generation AND authority.status='connected'
  JOIN provider_instances i ON i.id=authority.instance_id AND i.enabled AND i.provider='jellyfin'
  JOIN provider_connections c ON c.instance_id=i.id AND c.user_id=u.id AND c.status='connected'
    AND replace(lower(c.external_user_id),'-','')=replace(lower(p.remote_id),'-','')
  WHERE p.user_id=subject_id AND p.state='complete' AND p.lifecycle IN ('','active')
    AND coast_managed_schedule_open(p.active_defaults)
    AND EXISTS (SELECT 1 FROM sync_checkpoints s WHERE s.connection_id=c.id AND s.kind='jellyfin-seed'
      AND s.completed_at IS NOT NULL AND s.cursor=c.account_generation::text)
$$;
--> statement-breakpoint
CREATE FUNCTION coast_managed_work_visible(subject_id uuid, target_id uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH scope AS MATERIALIZED (SELECT * FROM coast_managed_catalogue(subject_id)),
  candidates AS (
    SELECT id FROM works WHERE id=target_id AND kind NOT IN ('show','season')
    UNION ALL
    SELECT e.media_id FROM episodes e WHERE e.show_id=target_id
    UNION ALL
    SELECT e.media_id FROM seasons s JOIN episodes e ON e.show_id=s.show_id AND e.season_number=s.season_number WHERE s.media_id=target_id
  )
  SELECT EXISTS (
    SELECT 1 FROM candidates item CROSS JOIN scope c
    JOIN availability a ON a.connection_id=c.connection_id AND a.user_id=subject_id AND a.state='available'
    JOIN provider_items pi ON pi.id=a.provider_item_id AND pi.instance_id=c.instance_id
    WHERE a.media_id=item.id AND coast_managed_observation(a.source,a.verified_at,c.access_after)
  )
$$;
