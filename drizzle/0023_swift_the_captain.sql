CREATE TABLE "friendships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_a" uuid NOT NULL,
	"user_b" uuid NOT NULL,
	"requested_by" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_pair_order" CHECK ("friendships"."user_a"<"friendships"."user_b"),
	CONSTRAINT "friendships_state" CHECK ("friendships"."state" in ('pending','accepted','declined','cancelled','removed'))
);
--> statement-breakpoint
CREATE TABLE "social_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"event_kind" text NOT NULL,
	"section" text NOT NULL,
	"source" text NOT NULL,
	"source_key" text NOT NULL,
	"batch_key" text,
	"date_known" boolean DEFAULT true NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"state" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_checkin_state" CHECK ("social_checkins"."state" in ('active','cancelled','completed'))
);
--> statement-breakpoint
CREATE TABLE "social_live_state" (
	"connection_id" uuid PRIMARY KEY NOT NULL,
	"account_generation" uuid NOT NULL,
	"work_id" uuid,
	"remote_id" text,
	"expires_at" timestamp with time zone,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"history_cursor" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "social_reactions" (
	"user_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_reactions_user_id_target_kind_target_id_pk" PRIMARY KEY("user_id","target_kind","target_id"),
	CONSTRAINT "social_reaction_kind" CHECK ("social_reactions"."target_kind" in ('work','activity')),
	CONSTRAINT "social_reaction_emoji" CHECK ("social_reactions"."emoji" in ('❤️','😂','😮','😢','🔥'))
);
--> statement-breakpoint
CREATE TABLE "social_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"work_id" uuid NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_recommendation_state" CHECK ("social_recommendations"."state" in ('pending','saved','dismissed'))
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD COLUMN "data" jsonb;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_activity" ADD CONSTRAINT "social_activity_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_activity" ADD CONSTRAINT "social_activity_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_checkins" ADD CONSTRAINT "social_checkins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_checkins" ADD CONSTRAINT "social_checkins_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_live_state" ADD CONSTRAINT "social_live_state_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_live_state" ADD CONSTRAINT "social_live_state_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_reactions" ADD CONSTRAINT "social_reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_recommendations" ADD CONSTRAINT "social_recommendations_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_recommendations" ADD CONSTRAINT "social_recommendations_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_recommendations" ADD CONSTRAINT "social_recommendations_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "friendships_pair_unique" ON "friendships" USING btree ("user_a","user_b");--> statement-breakpoint
CREATE UNIQUE INDEX "social_activity_source_unique" ON "social_activity" USING btree ("user_id","source_key");--> statement-breakpoint
CREATE INDEX "social_activity_feed_idx" ON "social_activity" USING btree ("user_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "social_checkin_active_unique" ON "social_checkins" USING btree ("user_id") WHERE "social_checkins"."state"='active';--> statement-breakpoint
CREATE UNIQUE INDEX "social_recommendation_pending_unique" ON "social_recommendations" USING btree ("sender_id","recipient_id","work_id") WHERE "social_recommendations"."state"='pending';--> statement-breakpoint
CREATE FUNCTION social_visible(owner_id uuid, viewer_id uuid, section_name text, category_name text DEFAULT NULL)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM users u WHERE u.id=owner_id AND NOT u.disabled AND
 (u.id=viewer_id OR (COALESCE(u.settings->'social'->>'audience','friends')<>'private' AND
 CASE COALESCE(u.settings->'social'->'sections'->>section_name,u.settings->'social'->>'audience','friends')
 WHEN 'public' THEN true WHEN 'private' THEN false ELSE EXISTS(SELECT 1 FROM friendships f WHERE f.state='accepted' AND f.user_a=LEAST(owner_id,viewer_id) AND f.user_b=GREATEST(owner_id,viewer_id)) END AND
 CASE COALESCE(u.settings->'social'->'categories'->>category_name,'public')
 WHEN 'public' THEN true WHEN 'private' THEN false ELSE EXISTS(SELECT 1 FROM friendships f WHERE f.state='accepted' AND f.user_a=LEAST(owner_id,viewer_id) AND f.user_b=GREATEST(owner_id,viewer_id)) END)))
$$;
--> statement-breakpoint
CREATE FUNCTION social_project_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r jsonb; owner_id uuid; work_id uuid; event_kind text; visibility_section text; source_name text; event_key text; batch_key text; event_date timestamptz; known boolean;
BEGIN
 r:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
 event_key:=TG_TABLE_NAME||':'||COALESCE(r->>'id',(r->>'user_id')||':'||(r->>'media_id'));
 IF TG_OP='DELETE' THEN DELETE FROM social_activity WHERE source_key=event_key; RETURN OLD; END IF;
 owner_id:=(r->>'user_id')::uuid; work_id:=COALESCE(r->>'media_id',r->>'track_id',r->>'game_id')::uuid;
 source_name:=COALESCE(r->>'source','coast'); event_date:=COALESCE(r->>'occurred_at',r->>'played_at',r->>'updated_at',r->>'created_at')::timestamptz;
 known:=COALESCE((r->>'occurred_at_known')::boolean,true); visibility_section:='activity';
 IF TG_TABLE_NAME='tracking_events' THEN
  event_kind:=r->>'action';
  IF NOT (r->>'applied')::boolean OR event_kind NOT IN ('watch','watchlist','favourite','collect','drop','restore') OR (event_kind IN ('watchlist','favourite','collect') AND NOT COALESCE((r->>'value')::boolean,true)) THEN
   DELETE FROM social_activity WHERE source_key=event_key; RETURN NEW;
  END IF;
  visibility_section:=CASE event_kind WHEN 'watchlist' THEN 'collection' WHEN 'collect' THEN 'collection' WHEN 'favourite' THEN 'favourites' ELSE 'activity' END;
 ELSIF TG_TABLE_NAME='ratings' THEN
  event_kind:='rating'; visibility_section:='ratings';
  IF TG_OP='UPDATE' AND NEW.value=OLD.value THEN RETURN NEW; END IF;
 ELSIF TG_TABLE_NAME='music_listens' THEN event_kind:='listen'; batch_key:=r->>'batch_id';
 ELSIF TG_TABLE_NAME='game_sessions' THEN
  SELECT p.user_id,p.game_id INTO owner_id,work_id FROM game_playthroughs p WHERE p.id=(r->>'playthrough_id')::uuid;
  event_kind:='played';
 ELSIF TG_TABLE_NAME='game_playthroughs' THEN
  event_kind:='game-'||(r->>'status');
  IF r->>'status'='planned' OR (TG_OP='UPDATE' AND NEW.status=OLD.status) THEN RETURN NEW; END IF;
 END IF;
 IF source_name<>'coast' THEN
  SELECT a.id::text INTO batch_key FROM outbox_actions a WHERE a.user_id=owner_id AND a.state='running' AND a.kind IN ('trakt.import','jellyfin.sync') AND (r->>'source_event_id' IS NULL OR (r->>'source_event_id') LIKE a.connection_id::text||':%') ORDER BY a.created_at DESC LIMIT 1;
 END IF;
 INSERT INTO social_activity(user_id,work_id,event_kind,section,source,source_key,batch_key,date_known,occurred_at)
 VALUES(owner_id,work_id,event_kind,visibility_section,source_name,event_key,batch_key,known,event_date)
 ON CONFLICT(user_id,source_key) DO UPDATE SET occurred_at=EXCLUDED.occurred_at,event_kind=EXCLUDED.event_kind,date_known=EXCLUDED.date_known;
 RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER social_tracking AFTER INSERT OR UPDATE OR DELETE ON tracking_events FOR EACH ROW EXECUTE FUNCTION social_project_activity();
--> statement-breakpoint
CREATE TRIGGER social_ratings AFTER INSERT OR UPDATE OR DELETE ON ratings FOR EACH ROW EXECUTE FUNCTION social_project_activity();
--> statement-breakpoint
CREATE TRIGGER social_listens AFTER INSERT OR UPDATE OR DELETE ON music_listens FOR EACH ROW EXECUTE FUNCTION social_project_activity();
--> statement-breakpoint
CREATE TRIGGER social_game_sessions AFTER INSERT OR UPDATE OR DELETE ON game_sessions FOR EACH ROW EXECUTE FUNCTION social_project_activity();
--> statement-breakpoint
CREATE TRIGGER social_game_status AFTER INSERT OR UPDATE OR DELETE ON game_playthroughs FOR EACH ROW EXECUTE FUNCTION social_project_activity();
--> statement-breakpoint
CREATE FUNCTION social_clean_activity_reactions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM social_reactions WHERE target_kind='activity' AND target_id=OLD.id; RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER social_activity_reactions AFTER DELETE ON social_activity FOR EACH ROW EXECUTE FUNCTION social_clean_activity_reactions();
--> statement-breakpoint
CREATE FUNCTION social_clean_work_reactions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN DELETE FROM social_reactions WHERE target_kind='work' AND target_id=OLD.id; RETURN OLD; END $$;
--> statement-breakpoint
CREATE TRIGGER social_work_reactions AFTER DELETE ON works FOR EACH ROW EXECUTE FUNCTION social_clean_work_reactions();
--> statement-breakpoint
INSERT INTO social_activity(user_id,work_id,event_kind,section,source,source_key,date_known,occurred_at)
 SELECT user_id,media_id,'watch','activity',source,'tracking_events:'||id,true,occurred_at FROM tracking_events WHERE applied AND action='watch' AND occurred_at_known AND occurred_at>=now()-interval '30 days'
 UNION ALL SELECT user_id,track_id,'listen','activity',source,'music_listens:'||id,true,occurred_at FROM music_listens WHERE occurred_at_known AND occurred_at>=now()-interval '30 days'
 UNION ALL SELECT p.user_id,p.game_id,'played','activity','coast','game_sessions:'||g.id,true,g.played_at FROM game_sessions g JOIN game_playthroughs p ON p.id=g.playthrough_id WHERE g.played_at>=now()-interval '30 days'
 ON CONFLICT DO NOTHING;
