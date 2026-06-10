CREATE TABLE "complaint_details_current" (
	"id" serial PRIMARY KEY NOT NULL,
	"complain_no" text NOT NULL,
	"sector" text,
	"region" text,
	"exchange_name" text,
	"phone_number" text,
	"msan_id" text,
	"cabinet_no" text,
	"complain_time" timestamp,
	"close_time" timestamp,
	"close_code" text,
	"complain_side_name" text,
	"complain_type_name" text,
	"close_by" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "complaint_details_current_complain_no_unique" UNIQUE("complain_no")
);
--> statement-breakpoint
CREATE TABLE "complaint_details_sod" (
	"id" serial PRIMARY KEY NOT NULL,
	"complain_no" text NOT NULL,
	"sector" text,
	"region" text,
	"exchange_name" text,
	"phone_number" text,
	"msan_id" text,
	"cabinet_no" text,
	"complain_time" timestamp,
	"close_time" timestamp,
	"close_code" text,
	"complain_side_name" text,
	"complain_type_name" text,
	"close_by" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "complaint_details_sod_complain_no_unique" UNIQUE("complain_no")
);
--> statement-breakpoint
CREATE TABLE "remaining_complaints_current" (
	"id" serial PRIMARY KEY NOT NULL,
	"complain_no" text NOT NULL,
	"sector" text,
	"region" text,
	"exchange_name" text,
	"phone_number" text,
	"complain_time" timestamp,
	"dispatch_time" timestamp,
	"dispatch_user" text,
	"msan_id" text,
	"close_time" timestamp,
	"close_code" text,
	"close_by" text,
	"status_code" text,
	"cabinet_no" text,
	"complain_type" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "remaining_complaints_current_complain_no_unique" UNIQUE("complain_no")
);
--> statement-breakpoint
CREATE TABLE "remaining_complaints_sod" (
	"id" serial PRIMARY KEY NOT NULL,
	"complain_no" text NOT NULL,
	"sector" text,
	"region" text,
	"exchange_name" text,
	"phone_number" text,
	"complain_time" timestamp,
	"dispatch_time" timestamp,
	"dispatch_user" text,
	"msan_id" text,
	"close_time" timestamp,
	"close_code" text,
	"close_by" text,
	"status_code" text,
	"cabinet_no" text,
	"complain_type" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "remaining_complaints_sod_complain_no_unique" UNIQUE("complain_no")
);
--> statement-breakpoint
ALTER TABLE "complaint_details_current" ADD CONSTRAINT "complaint_details_current_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_details_sod" ADD CONSTRAINT "complaint_details_sod_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remaining_complaints_current" ADD CONSTRAINT "remaining_complaints_current_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remaining_complaints_sod" ADD CONSTRAINT "remaining_complaints_sod_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;