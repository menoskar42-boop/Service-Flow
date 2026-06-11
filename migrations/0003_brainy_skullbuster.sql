CREATE TABLE "regularized_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"snapshot_date" date NOT NULL,
	"category" text NOT NULL,
	"item_key" text NOT NULL,
	"central_name" text,
	"data" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "regularized_daily_cat_key_uniq" UNIQUE("category","item_key")
);
