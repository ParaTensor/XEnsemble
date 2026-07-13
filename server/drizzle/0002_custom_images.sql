CREATE TABLE "custom_images" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_user_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"components" text NOT NULL,
	"image_ref" text,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "custom_images_owner_user_id_name_unique" UNIQUE("owner_user_id","name")
);
--> statement-breakpoint
CREATE TABLE "custom_image_builds" (
	"id" text PRIMARY KEY NOT NULL,
	"custom_image_id" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"image_ref" text,
	"logs_ref" text,
	"failure_reason" text,
	"started_at" bigint,
	"finished_at" bigint,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "custom_image_id" text;--> statement-breakpoint
ALTER TABLE "custom_images" ADD CONSTRAINT "custom_images_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_image_builds" ADD CONSTRAINT "custom_image_builds_custom_image_id_custom_images_id_fk" FOREIGN KEY ("custom_image_id") REFERENCES "public"."custom_images"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_custom_image_builds_image_state" ON "custom_image_builds" USING btree ("custom_image_id","state");