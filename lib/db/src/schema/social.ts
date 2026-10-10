import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const menaMetaConnections = pgTable("mena_meta_connections", {
  ownerId: text("owner_id").notNull().unique(),
  pageId: text("page_id").notNull(),
  pageName: text("page_name").notNull(),
  encryptedPageAccessToken: text("encrypted_page_access_token").notNull(),
  instagramUserId: text("instagram_user_id"),
  instagramUsername: text("instagram_username"),
  connectedAt: timestamp("connected_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const menaOAuthStates = pgTable("mena_oauth_states", {
  stateHash: text("state_hash").primaryKey(),
  ownerId: text("owner_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});
