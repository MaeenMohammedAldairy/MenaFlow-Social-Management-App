CREATE TABLE "mena_whatsapp_opt_outs" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"customer_id" text NOT NULL,
	"opted_out_at" timestamp with time zone NOT NULL,
	"opted_in_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "mena_whatsapp_opt_outs" ADD CONSTRAINT "mena_whatsapp_opt_outs_workspace_id_mena_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."mena_workspaces"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_opt_outs_workspace_customer_key" ON "mena_whatsapp_opt_outs" USING btree ("workspace_id","customer_id");--> statement-breakpoint
CREATE INDEX "mena_whatsapp_opt_outs_workspace_idx" ON "mena_whatsapp_opt_outs" USING btree ("workspace_id");