DROP INDEX "lists_source_identity_unique";--> statement-breakpoint
ALTER TABLE "lists" ADD COLUMN "source_account_id" uuid;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_source_account_id_sync_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."sync_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lists_source_identity_unique" ON "lists" USING btree ("user_id","source","external_id","source_account_id");--> statement-breakpoint
UPDATE lists l SET source_account_id=c.sync_account_id FROM provider_connections c WHERE l.source_connection_id=c.id;
