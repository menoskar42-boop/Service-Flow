CREATE TABLE "cabinet_technicians" (
	"id" serial PRIMARY KEY NOT NULL,
	"central_name" text,
	"cabin_number" text,
	"worker_code" text,
	"haya_karima" text,
	"region_name" text,
	"active" text,
	"central_finish" text,
	"village_code" text,
	"cabin_code" text,
	"idu" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by_id" integer
);
--> statement-breakpoint
CREATE TABLE "case_138" (
	"id" serial PRIMARY KEY NOT NULL,
	"central_name" text,
	"phone_short" text,
	"complain_no" text,
	"score" integer,
	"current_speed" text,
	"max_speed" text,
	"full_phone" text,
	"account_no" text,
	"status_code" text,
	"cabinet_no" text,
	"box_no" text,
	"complain_type_name" text,
	"complain_time" timestamp,
	"customer_name" text,
	"dispatch_time" timestamp,
	"tech_code" text,
	"close_date" timestamp,
	"onu" text,
	"fault_type" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by_id" integer
);
--> statement-breakpoint
CREATE TABLE "complaint_details" (
	"id" serial PRIMARY KEY NOT NULL,
	"complain_no" text NOT NULL,
	"sector" text,
	"region" text,
	"exchange_name" text,
	"central_name" text,
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
	CONSTRAINT "complaint_details_complain_no_unique" UNIQUE("complain_no")
);
--> statement-breakpoint
CREATE TABLE "ftth_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_order_id" text NOT NULL,
	"customer_order_id" text,
	"product" text,
	"service_number" text,
	"customer_name" text,
	"order_status" text,
	"order_create_time" timestamp with time zone,
	"exchange_name" text,
	"service_type" text,
	"msan_code" text,
	"area_code" text,
	"customer_mobile" text,
	"current_activity" text,
	"error_name" text,
	"governorate" text,
	"line_type" text,
	"fcc_exchange" text,
	"raw" jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "ftth_orders_uniq" UNIQUE("service_order_id")
);
--> statement-breakpoint
CREATE TABLE "ftth_orders_archive" (
	"archived_year" integer,
	"id" serial PRIMARY KEY NOT NULL,
	"service_order_id" text NOT NULL,
	"customer_order_id" text,
	"product" text,
	"service_number" text,
	"customer_name" text,
	"order_status" text,
	"order_create_time" timestamp with time zone,
	"exchange_name" text,
	"service_type" text,
	"msan_code" text,
	"area_code" text,
	"customer_mobile" text,
	"current_activity" text,
	"error_name" text,
	"governorate" text,
	"line_type" text,
	"fcc_exchange" text,
	"raw" jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" integer
);
--> statement-breakpoint
CREATE TABLE "ftth_orders_current" (
	"id" serial PRIMARY KEY NOT NULL,
	"service_order_id" text NOT NULL,
	"customer_order_id" text,
	"product" text,
	"service_number" text,
	"customer_name" text,
	"order_status" text,
	"order_create_time" timestamp with time zone,
	"exchange_name" text,
	"service_type" text,
	"msan_code" text,
	"area_code" text,
	"customer_mobile" text,
	"current_activity" text,
	"error_name" text,
	"governorate" text,
	"line_type" text,
	"fcc_exchange" text,
	"raw" jsonb,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" integer
);
--> statement-breakpoint
CREATE TABLE "ftth_subscribers" (
	"id" serial PRIMARY KEY NOT NULL,
	"sector" text,
	"region" text,
	"main_ex" text,
	"sub_ex" text,
	"fcc_code" text,
	"type" text,
	"msan_gpon_code" text,
	"fbb_subs" integer,
	"fv_subs" integer,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by_id" integer
);
--> statement-breakpoint
CREATE TABLE "maintenance_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"central_name" text NOT NULL,
	"work_order_id" bigint NOT NULL,
	"phone_number" text NOT NULL,
	"work_order_type" text,
	"stage" text,
	"status" text,
	"priority" text,
	"current_workspec" text,
	"notes" text,
	"description" text,
	"creation_date" timestamp,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "maintenance_orders_central_wo_uniq" UNIQUE("central_name","work_order_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"order_id" integer,
	"type" text NOT NULL,
	"message" text NOT NULL,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"customer_address" text NOT NULL,
	"national_id" text,
	"serial_number" text,
	"sales_id" integer NOT NULL,
	"sales_name" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_feasible" boolean,
	"rejection_reason" text,
	"cabin_number" text,
	"box_number" text,
	"nearest_box_distance" text,
	"additional_notes" text,
	"central_name" text,
	"tech_id" integer,
	"tech_name" text,
	"tech_response_at" timestamp,
	"external_id" integer,
	"external_name" text,
	"external_response_at" timestamp,
	"is_feasible_external" boolean,
	"external_rejection_reason" text,
	"external_cabin_number" text,
	"external_box_number" text,
	"external_nearest_box_distance" text,
	"external_additional_notes" text,
	"external_central_name" text,
	"contract_status" text DEFAULT 'لم يتم التعاقد' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phone_line_edits" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone_line_id" integer NOT NULL,
	"full_phone" text NOT NULL,
	"central" text NOT NULL,
	"old_cabin_number" text,
	"new_cabin_number" text,
	"old_box_number" text,
	"new_box_number" text,
	"old_dp_terminal" text,
	"new_dp_terminal" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"edited_by_id" integer NOT NULL,
	"edited_by_name" text NOT NULL,
	"edited_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_by_id" integer,
	"confirmed_by_name" text,
	"confirmed_at" timestamp,
	"rolled_back_by_id" integer,
	"rolled_back_by_name" text,
	"rolled_back_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "phone_lines" (
	"id" serial PRIMARY KEY NOT NULL,
	"tel_no" text NOT NULL,
	"central" text NOT NULL,
	"idu_no" text,
	"odu_no" text,
	"cabin_number" text,
	"primary_block_no" text,
	"cabinet_in" text,
	"sec_block_no" text,
	"cabinet_out" text,
	"box_number" text,
	"dp_terminal" text,
	"port" text,
	"len" text,
	"fiber_block" text,
	"fiber_out" text,
	"tel_num_txt" text,
	"full_phone" text NOT NULL,
	CONSTRAINT "phone_lines_full_phone_unique" UNIQUE("full_phone")
);
--> statement-breakpoint
CREATE TABLE "phone_ports" (
	"id" serial PRIMARY KEY NOT NULL,
	"phone_number" text NOT NULL,
	"area_code" text,
	"msan_code" text,
	"frame" text,
	"shelf" text,
	"slot" text,
	"port_number" text,
	"port_type" text,
	"voice_status" text,
	"data_status" text,
	"operator" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "phone_ports_phone_number_unique" UNIQUE("phone_number")
);
--> statement-breakpoint
CREATE TABLE "remaining_complaints" (
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
	CONSTRAINT "remaining_complaints_complain_no_unique" UNIQUE("complain_no")
);
--> statement-breakpoint
CREATE TABLE "technician_names" (
	"id" serial PRIMARY KEY NOT NULL,
	"worker_code" text NOT NULL,
	"tech_name" text NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" integer
);
--> statement-breakpoint
CREATE TABLE "ticket_dsl_current" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"central_code" text,
	"central_name" text,
	"phone_number" text,
	"complaint_time" timestamp with time zone,
	"tech_code" text,
	"line_type_code" text,
	"cabinet_no" text,
	"priority_code" text,
	"close_date" timestamp with time zone,
	"operation_type" text,
	"complain_type_name" text,
	"status_code" text,
	"onu" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" integer
);
--> statement-breakpoint
CREATE TABLE "ticket_dsl_sod" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"central_code" text,
	"central_name" text,
	"phone_number" text,
	"complaint_time" timestamp with time zone,
	"tech_code" text,
	"line_type_code" text,
	"cabinet_no" text,
	"priority_code" text,
	"close_date" timestamp with time zone,
	"operation_type" text,
	"complain_type_name" text,
	"status_code" text,
	"onu" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "ticket_dsl_sod_uniq" UNIQUE("ticket_id","status_code")
);
--> statement-breakpoint
CREATE TABLE "ticket_ftth" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"central_code" text,
	"central_name" text,
	"phone_number" text,
	"complaint_time" timestamp with time zone,
	"tech_code" text,
	"line_type_code" text,
	"cabinet_no" text,
	"priority_code" text,
	"close_date" timestamp with time zone,
	"operation_type" text,
	"complain_type_name" text,
	"status_code" text,
	"onu" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "ticket_ftth_uniq" UNIQUE("ticket_id","status_code")
);
--> statement-breakpoint
CREATE TABLE "ticket_ftth_current" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"central_code" text,
	"central_name" text,
	"phone_number" text,
	"complaint_time" timestamp with time zone,
	"tech_code" text,
	"line_type_code" text,
	"cabinet_no" text,
	"priority_code" text,
	"close_date" timestamp with time zone,
	"operation_type" text,
	"complain_type_name" text,
	"status_code" text,
	"onu" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" integer
);
--> statement-breakpoint
CREATE TABLE "ticket_ftth_sod" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"central_code" text,
	"central_name" text,
	"phone_number" text,
	"complaint_time" timestamp with time zone,
	"tech_code" text,
	"line_type_code" text,
	"cabinet_no" text,
	"priority_code" text,
	"close_date" timestamp with time zone,
	"operation_type" text,
	"complain_type_name" text,
	"status_code" text,
	"onu" text,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "ticket_ftth_sod_uniq" UNIQUE("ticket_id","status_code")
);
--> statement-breakpoint
CREATE TABLE "ticket_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" text NOT NULL,
	"central_code" text NOT NULL,
	"central_name" text NOT NULL,
	"phone_number" text,
	"complaint_time" timestamp,
	"tech_code" text,
	"line_type_code" text,
	"cabinet_no" text,
	"priority_code" text,
	"close_date" timestamp,
	"operation_type" text,
	"complain_type_name" text,
	"status_code" text,
	"onu" text,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "ticket_queue_ticket_status_uniq" UNIQUE("ticket_id","status_code")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text NOT NULL,
	"role" text NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "wfm_current" (
	"id" serial PRIMARY KEY NOT NULL,
	"central_name" text NOT NULL,
	"work_order_id" bigint NOT NULL,
	"phone_number" text NOT NULL,
	"work_order_type" text,
	"stage" text,
	"status" text,
	"priority" text,
	"current_workspec" text,
	"notes" text,
	"description" text,
	"creation_date" timestamp with time zone,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" integer
);
--> statement-breakpoint
CREATE TABLE "wfm_sod" (
	"id" serial PRIMARY KEY NOT NULL,
	"central_name" text NOT NULL,
	"work_order_id" bigint NOT NULL,
	"phone_number" text NOT NULL,
	"work_order_type" text,
	"stage" text,
	"status" text,
	"priority" text,
	"current_workspec" text,
	"notes" text,
	"description" text,
	"creation_date" timestamp with time zone,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "wfm_sod_central_wo_uniq" UNIQUE("central_name","work_order_id")
);
--> statement-breakpoint
CREATE TABLE "work_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"central_name" text NOT NULL,
	"work_order_id" bigint NOT NULL,
	"phone_number" text NOT NULL,
	"service_type" text NOT NULL,
	"close_date" timestamp NOT NULL,
	"item_name" text,
	"cable_quantity" text,
	"tech_name" text NOT NULL,
	"uploaded_at" timestamp DEFAULT now() NOT NULL,
	"uploaded_by_id" integer,
	CONSTRAINT "work_orders_central_wo_uniq" UNIQUE("central_name","work_order_id")
);
--> statement-breakpoint
ALTER TABLE "cabinet_technicians" ADD CONSTRAINT "cabinet_technicians_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_138" ADD CONSTRAINT "case_138_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "complaint_details" ADD CONSTRAINT "complaint_details_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ftth_orders" ADD CONSTRAINT "ftth_orders_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ftth_orders_archive" ADD CONSTRAINT "ftth_orders_archive_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ftth_orders_current" ADD CONSTRAINT "ftth_orders_current_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ftth_subscribers" ADD CONSTRAINT "ftth_subscribers_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_orders" ADD CONSTRAINT "maintenance_orders_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_sales_id_users_id_fk" FOREIGN KEY ("sales_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_tech_id_users_id_fk" FOREIGN KEY ("tech_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_external_id_users_id_fk" FOREIGN KEY ("external_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_line_edits" ADD CONSTRAINT "phone_line_edits_phone_line_id_phone_lines_id_fk" FOREIGN KEY ("phone_line_id") REFERENCES "public"."phone_lines"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_line_edits" ADD CONSTRAINT "phone_line_edits_edited_by_id_users_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_line_edits" ADD CONSTRAINT "phone_line_edits_confirmed_by_id_users_id_fk" FOREIGN KEY ("confirmed_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_line_edits" ADD CONSTRAINT "phone_line_edits_rolled_back_by_id_users_id_fk" FOREIGN KEY ("rolled_back_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "phone_ports" ADD CONSTRAINT "phone_ports_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remaining_complaints" ADD CONSTRAINT "remaining_complaints_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "technician_names" ADD CONSTRAINT "technician_names_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_dsl_current" ADD CONSTRAINT "ticket_dsl_current_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_dsl_sod" ADD CONSTRAINT "ticket_dsl_sod_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_ftth" ADD CONSTRAINT "ticket_ftth_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_ftth_current" ADD CONSTRAINT "ticket_ftth_current_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_ftth_sod" ADD CONSTRAINT "ticket_ftth_sod_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_queue" ADD CONSTRAINT "ticket_queue_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wfm_current" ADD CONSTRAINT "wfm_current_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wfm_sod" ADD CONSTRAINT "wfm_sod_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_orders" ADD CONSTRAINT "work_orders_uploaded_by_id_users_id_fk" FOREIGN KEY ("uploaded_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;