CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'user',
	"status" text DEFAULT 'active',
	"email" text,
	"display_name" text,
	"last_login_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "user_quotas" (
	"user_id" text PRIMARY KEY NOT NULL,
	"max_projects" integer DEFAULT 5 NOT NULL,
	"max_sessions" integer DEFAULT 2 NOT NULL,
	"max_previews" integer DEFAULT 1 NOT NULL,
	"max_runtimes" integer DEFAULT 1 NOT NULL,
	"resource_tier" text DEFAULT 'basic' NOT NULL,
	"updated_by" text,
	"updated_at" bigint
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" text NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	CONSTRAINT "user_preferences_user_id_key_pk" PRIMARY KEY("user_id","key")
);
--> statement-breakpoint
CREATE TABLE "user_agent_grants" (
	"user_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"granted_by" text,
	"granted_at" bigint NOT NULL,
	CONSTRAINT "user_agent_grants_user_id_agent_id_pk" PRIMARY KEY("user_id","agent_id")
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "secrets" (
	"user_id" text PRIMARY KEY NOT NULL,
	"encrypted_data" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"server_path" text NOT NULL,
	"default_runtime_id" text,
	"repo_provider" text DEFAULT 'none',
	"repo_url" text,
	"repo_default_branch" text DEFAULT 'main',
	"repo_installation_ref" text,
	"repo_token_secret_ref" text,
	"workspace_mode" text DEFAULT 'local',
	"last_sync_sha" text,
	"last_snapshot_id" text,
	"dev_profile_id" text,
	"current_branch" text,
	"github_repo_id" integer,
	"github_full_name" text,
	"clone_status" text DEFAULT 'pending',
	"clone_error" text,
	"remote_repo_id" text,
	"remote_full_name" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text,
	"runtime_id" text,
	"agent_id" text NOT NULL,
	"cwd" text NOT NULL,
	"stream_ref" text,
	"state_dir_ref" text,
	"recoverable" boolean DEFAULT false,
	"status" text DEFAULT 'running',
	"title" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_streams" (
	"session_id" text PRIMARY KEY NOT NULL,
	"head_seq" integer DEFAULT 0 NOT NULL,
	"bytes" integer DEFAULT 0 NOT NULL,
	"storage_ref" text NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"cmd" text NOT NULL,
	"args" text NOT NULL,
	"env_required" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtimes" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider" text DEFAULT 'local' NOT NULL,
	"runtime_ref" text,
	"role" text DEFAULT 'default' NOT NULL,
	"status" text DEFAULT 'ready',
	"endpoint" text,
	"specs" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"project_id" text NOT NULL,
	"runtime_id" text,
	"kind" text DEFAULT 'preview' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"public_url" text,
	"internal_ref" text,
	"preview_token_hash" text,
	"revision" text,
	"expires_at" bigint,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"created_by" text,
	"stopped_by" text,
	"last_error_code" text,
	"last_error_message" text,
	"resource_tier" text,
	"region" text,
	"build_log" text,
	"runtime_log" text
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"project_id" text,
	"subject_type" text NOT NULL,
	"subject_id" text NOT NULL,
	"type" text NOT NULL,
	"data" text,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dev_environment_profiles" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"profile_json" text NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"git_sha" text,
	"branch" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_ref" text,
	"build_log" text,
	"last_error" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"expires_at" bigint
);
--> statement-breakpoint
CREATE TABLE "workspace_checkpoints" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"session_id" text,
	"base_snapshot_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"storage_ref" text,
	"diff_ref" text,
	"git_sha" text,
	"created_by" text,
	"created_at" bigint NOT NULL,
	"expires_at" bigint
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"device_name" text,
	"created_at" bigint NOT NULL,
	"expires_at" bigint NOT NULL,
	"revoked_at" bigint,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "github_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"github_user_id" integer NOT NULL,
	"github_username" text NOT NULL,
	"github_avatar" text,
	"access_token_enc" text NOT NULL,
	"token_scope" text,
	"connected_at" bigint NOT NULL,
	"last_used_at" bigint,
	"revoked_at" bigint
);
--> statement-breakpoint
CREATE TABLE "github_oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_branches" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"branch_name" text NOT NULL,
	"base_branch" text,
	"is_active" boolean DEFAULT false,
	"last_commit_sha" text,
	"ahead_count" integer DEFAULT 0,
	"behind_count" integer DEFAULT 0,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "project_branches_project_id_branch_name_unique" UNIQUE("project_id","branch_name")
);
--> statement-breakpoint
CREATE TABLE "pull_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"github_pr_number" integer NOT NULL,
	"github_pr_url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"source_branch" text NOT NULL,
	"target_branch" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"github_state" text,
	"merge_sha" text,
	"created_by" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"last_synced_at" bigint,
	CONSTRAINT "pull_requests_project_id_github_pr_number_unique" UNIQUE("project_id","github_pr_number")
);
--> statement-breakpoint
CREATE TABLE "git_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"provider_config" text,
	"remote_user_id" text NOT NULL,
	"remote_username" text NOT NULL,
	"remote_avatar" text,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text,
	"token_scope" text,
	"token_expires_at" bigint,
	"connected_at" bigint NOT NULL,
	"last_used_at" bigint,
	"revoked_at" bigint,
	CONSTRAINT "git_connections_user_id_provider_provider_config_unique" UNIQUE("user_id","provider","provider_config")
);
--> statement-breakpoint
CREATE TABLE "git_oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"expires_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "merge_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"provider" text NOT NULL,
	"remote_mr_number" integer NOT NULL,
	"remote_mr_url" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"source_branch" text NOT NULL,
	"target_branch" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"remote_state" text,
	"merge_sha" text,
	"created_by" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	"last_synced_at" bigint,
	CONSTRAINT "merge_requests_project_id_provider_remote_mr_number_unique" UNIQUE("project_id","provider","remote_mr_number")
);
--> statement-breakpoint
CREATE TABLE "agent_box_images" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"image_ref" text NOT NULL,
	"tag" text NOT NULL,
	"digest" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"is_active" boolean DEFAULT false,
	"built_at" bigint,
	"notes" text,
	"created_by" text,
	"created_at" bigint NOT NULL,
	CONSTRAINT "agent_box_images_agent_id_tag_unique" UNIQUE("agent_id","tag")
);
--> statement-breakpoint
ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_quotas" ADD CONSTRAINT "user_quotas_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_agent_grants" ADD CONSTRAINT "user_agent_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_agent_grants" ADD CONSTRAINT "user_agent_grants_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_agent_grants" ADD CONSTRAINT "user_agent_grants_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "secrets" ADD CONSTRAINT "secrets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_runtime_id_runtimes_id_fk" FOREIGN KEY ("runtime_id") REFERENCES "public"."runtimes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_streams" ADD CONSTRAINT "session_streams_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runtimes" ADD CONSTRAINT "runtimes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_runtime_id_runtimes_id_fk" FOREIGN KEY ("runtime_id") REFERENCES "public"."runtimes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dev_environment_profiles" ADD CONSTRAINT "dev_environment_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_snapshots" ADD CONSTRAINT "repo_snapshots_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_checkpoints" ADD CONSTRAINT "workspace_checkpoints_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_checkpoints" ADD CONSTRAINT "workspace_checkpoints_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_checkpoints" ADD CONSTRAINT "workspace_checkpoints_base_snapshot_id_repo_snapshots_id_fk" FOREIGN KEY ("base_snapshot_id") REFERENCES "public"."repo_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_connections" ADD CONSTRAINT "github_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_branches" ADD CONSTRAINT "project_branches_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_requests" ADD CONSTRAINT "pull_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "git_connections" ADD CONSTRAINT "git_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "merge_requests" ADD CONSTRAINT "merge_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_box_images" ADD CONSTRAINT "agent_box_images_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_box_images" ADD CONSTRAINT "agent_box_images_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_user" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_refresh_tokens_hash" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_github_connections_user_id" ON "github_connections" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_github_oauth_states_expires" ON "github_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_git_oauth_states_expires" ON "git_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "idx_agent_box_images_agent_active" ON "agent_box_images" USING btree ("agent_id","is_active");