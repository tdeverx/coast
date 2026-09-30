CREATE INDEX "outbox_maintenance_idx" ON "outbox_actions" USING btree ("connection_id","kind","state","updated_at");--> statement-breakpoint
CREATE INDEX "outbox_state_created_idx" ON "outbox_actions" USING btree ("state","created_at");--> statement-breakpoint
CREATE INDEX "connections_instance_status_idx" ON "provider_connections" USING btree ("instance_id","status");