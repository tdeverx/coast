CREATE TABLE "work_taste_synopses" (
	"work_id" uuid PRIMARY KEY NOT NULL,
	"model" text NOT NULL,
	"synopsis_sha256" text NOT NULL,
	"embedding" real[] NOT NULL,
	CONSTRAINT "work_taste_synopses_dimension" CHECK (cardinality("work_taste_synopses"."embedding")=384)
);
--> statement-breakpoint
ALTER TABLE "work_taste_synopses" ADD CONSTRAINT "work_taste_synopses_work_id_works_id_fk" FOREIGN KEY ("work_id") REFERENCES "public"."works"("id") ON DELETE cascade ON UPDATE no action;