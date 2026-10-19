ALTER TABLE "notifications" ADD COLUMN "toast_hidden_at" timestamp with time zone;
--> statement-breakpoint
COMMENT ON COLUMN "notifications"."toast_hidden_at" IS 'Durable toast-only suppression, retained and deleted with its notification. Independent of inbox read and dismissal state.';
