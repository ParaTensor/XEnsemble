-- Agent image builds table
CREATE TABLE IF NOT EXISTS "agent_image_builds" (
  "id" text PRIMARY KEY NOT NULL,
  "agent_id" text NOT NULL REFERENCES "agents"("id"),
  "state" text NOT NULL DEFAULT 'queued',
  "image_ref" text,
  "tag" text,
  "logs_ref" text,
  "failure_reason" text,
  "version_id" text,
  "notes" text,
  "started_at" bigint,
  "finished_at" bigint,
  "created_by" text REFERENCES "users"("id"),
  "created_at" bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS "idx_agent_image_builds_agent_state" ON "agent_image_builds" ("agent_id", "state");
