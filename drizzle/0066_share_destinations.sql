ALTER TABLE "playback_shares" ADD COLUMN "target" text DEFAULT 'website' NOT NULL;--> statement-breakpoint
ALTER TABLE "playback_shares" ADD COLUMN "video_codec" text DEFAULT 'h264' NOT NULL;--> statement-breakpoint
ALTER TABLE "playback_shares" ADD CONSTRAINT "playback_shares_target_check" CHECK ("playback_shares"."target" in ('website','vrchat'));--> statement-breakpoint
ALTER TABLE "playback_shares" ADD CONSTRAINT "playback_shares_codec_check" CHECK ("playback_shares"."video_codec" in ('h264','hevc') and ("playback_shares"."target"='vrchat' or "playback_shares"."video_codec"='h264'));