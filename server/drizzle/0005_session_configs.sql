CREATE TABLE IF NOT EXISTS "session_configs" (
	"session_id" text PRIMARY KEY NOT NULL,
	"config_files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"custom_env" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "session_configs_session_id_sessions_id_fk"
		FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
