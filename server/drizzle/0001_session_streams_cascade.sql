ALTER TABLE "session_streams" DROP CONSTRAINT "session_streams_session_id_sessions_id_fk";
--> statement-breakpoint
ALTER TABLE "session_streams" ADD CONSTRAINT "session_streams_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;