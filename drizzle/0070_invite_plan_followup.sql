ALTER TABLE "account_audit" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "invite_claims" ADD COLUMN "setup_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "member_invite_requests" ADD COLUMN "preset_id" uuid;--> statement-breakpoint
ALTER TABLE "registration_invites" ADD COLUMN "approval_issued" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "member_invite_requests" ADD CONSTRAINT "member_invite_requests_preset_id_invite_presets_id_fk" FOREIGN KEY ("preset_id") REFERENCES "public"."invite_presets"("id") ON DELETE restrict ON UPDATE no action;