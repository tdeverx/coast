CREATE INDEX "reading_works_authors_idx" ON "reading_works" USING gin ("authors");--> statement-breakpoint
CREATE INDEX "reading_works_subjects_idx" ON "reading_works" USING gin ("subjects");