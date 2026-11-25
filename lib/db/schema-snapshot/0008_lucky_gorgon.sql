ALTER TABLE "mena_whatsapp_connections" DROP CONSTRAINT "mena_whatsapp_connections_owner_id_unique";--> statement-breakpoint
ALTER TABLE "mena_whatsapp_group_selections" DROP CONSTRAINT "mena_whatsapp_group_selections_owner_id_mena_whatsapp_connections_owner_id_fk";
--> statement-breakpoint
DROP INDEX "mena_whatsapp_group_selections_owner_id_group_jid_key";--> statement-breakpoint
ALTER TABLE "mena_whatsapp_group_selections" ADD CONSTRAINT "mena_whatsapp_group_selections_connection_fk" FOREIGN KEY ("owner_id","workspace_id") REFERENCES "public"."mena_whatsapp_connections"("owner_id","workspace_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_connections_owner_workspace_key" ON "mena_whatsapp_connections" USING btree ("owner_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mena_whatsapp_group_selections_workspace_instance_group_jid_key" ON "mena_whatsapp_group_selections" USING btree ("workspace_id","instance_name","group_jid");