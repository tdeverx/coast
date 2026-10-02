CREATE INDEX "collection_projection_preview_expiry_idx" ON "collection_projection_previews" USING btree ("created_at") WHERE "collection_projection_previews"."approved"=false;--> statement-breakpoint
CREATE INDEX "diagnostics_retention_idx" ON "diagnostics" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "registration_invite_expiry_idx" ON "registration_invites" USING btree ("expires_at") WHERE "registration_invites"."used_at" is null;--> statement-breakpoint
CREATE INDEX "registration_invite_revoked_idx" ON "registration_invites" USING btree ("revoked_at") WHERE "registration_invites"."used_at" is null and "registration_invites"."revoked_at" is not null;--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "synced_rooms_expiry_idx" ON "synced_rooms" USING btree ("created_at") WHERE "synced_rooms"."ended_at" is null;--> statement-breakpoint
CREATE INDEX "synced_rooms_retention_idx" ON "synced_rooms" USING btree ("ended_at") WHERE "synced_rooms"."ended_at" is not null;