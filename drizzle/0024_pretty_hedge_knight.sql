CREATE TABLE "social_live_deliveries" (
	"connection_id" uuid NOT NULL,
	"checkin_id" uuid NOT NULL,
	"account_generation" uuid NOT NULL,
	"remote_id" text,
	"state" text DEFAULT 'uncertain' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_live_deliveries_connection_id_checkin_id_pk" PRIMARY KEY("connection_id","checkin_id")
);
--> statement-breakpoint
ALTER TABLE "social_live_deliveries" ADD CONSTRAINT "social_live_deliveries_connection_id_provider_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."provider_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_live_deliveries" ADD CONSTRAINT "social_live_deliveries_checkin_id_social_checkins_id_fk" FOREIGN KEY ("checkin_id") REFERENCES "public"."social_checkins"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION social_queue_checkin_cancel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.state='active' AND NEW.state='cancelled' THEN
 INSERT INTO outbox_actions(user_id,connection_id,kind,payload,compaction_key)
 SELECT NEW.user_id,c.id,'trakt.checkin',jsonb_build_object('checkinId',NEW.id),'checkin-cancel:'||NEW.id
 FROM provider_connections c JOIN provider_instances i ON i.id=c.instance_id
 WHERE c.user_id=NEW.user_id AND c.status='connected' AND i.enabled AND i.provider='trakt' AND c.settings->'sync'->>'scrobble'='true';
 END IF;RETURN NEW; END $$;
--> statement-breakpoint
CREATE TRIGGER social_checkin_cancel AFTER UPDATE OF state ON social_checkins FOR EACH ROW EXECUTE FUNCTION social_queue_checkin_cancel();
