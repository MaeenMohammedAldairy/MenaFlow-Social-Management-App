export type StatusCount = { status: string; total: number };
export type ErrorCount = { errorCode: string; total: number };

export type SessionResponse = {
  mode: "clerk" | "token" | "dev";
  scope: string;
  serverTime: string;
};

export type OverviewResponse = {
  generatedAt: string;
  period: string;
  workspaces: {
    total: number;
    last30Days: number;
    byPlan: { planId: string; total: number }[];
    byStatus: StatusCount[];
  };
  usage: { aiGenerations: number; postsCreated: number };
  channels: {
    whatsapp: { total: number; autoReplyEnabled: number };
    meta: { total: number; expiredTokens: number };
  };
  orders: { total: number; last30Days: number };
  inbox: { metaItems24h: number; whatsappInbound24h: number };
  autoReplies: {
    whatsapp24h: StatusCount[];
    meta24h: StatusCount[];
    backlog: { whatsapp: number; meta: number };
  };
};

export type AutoReplyFailure = {
  id: string;
  workspaceId: string;
  workspaceName: string | null;
  status: string;
  errorCode: string | null;
  completedAt: string | null;
};

export type AutoRepliesResponse = {
  window: "24h" | "7d" | "30d";
  since: string;
  whatsapp: {
    byStatus: StatusCount[];
    topErrors: ErrorCount[];
    backlog: number;
    oldestPendingAt: string | null;
    recentFailures: AutoReplyFailure[];
  };
  meta: {
    byStatus: StatusCount[];
    topErrors: ErrorCount[];
    backlog: number;
    oldestPendingAt: string | null;
    recentFailures: AutoReplyFailure[];
  };
};

export type WorkerSnapshot = {
  name: string;
  intervalMs: number;
  startedAt: string;
  running: boolean;
  lastRunStartedAt: string | null;
  lastRunFinishedAt: string | null;
  lastRunDurationMs: number | null;
  consecutiveErrors: number;
  lastError: string | null;
  lastErrorAt: string | null;
  stale: boolean;
};

export type WorkersResponse = {
  generatedAt: string;
  database: { ok: boolean; latencyMs: number | null };
  workers: WorkerSnapshot[];
  attention: number;
};

export type WorkspaceRow = {
  id: string;
  name: string;
  createdAt: string;
  planId: string | null;
  subscriptionStatus: string | null;
  trialEndsAt: string | null;
  members: number;
  aiGenerations: number;
  postsCreated: number;
  whatsapp: {
    instanceName: string;
    status: string;
    autoReplyEnabled: boolean;
  } | null;
  metaPage: string | null;
};

export type WorkspacesResponse = {
  items: WorkspaceRow[];
  hasMore: boolean;
};

export type WorkspaceDetailResponse = {
  workspace: {
    id: string;
    name: string;
    createdAt: string;
    createdBy: string;
    updatedAt: string;
  };
  subscription: {
    planId: string;
    status: string;
    trialEndsAt: string | null;
    currentPeriodEnd: string | null;
  } | null;
  usage: { period: string; aiGenerations: number; postsCreated: number };
  members: number;
  whatsapp: {
    instanceName: string;
    status: string;
    autoReplyEnabled: boolean;
    autoReplyLanguage: string;
    autoReplyTested: boolean;
    connectedAt: string | null;
  } | null;
  meta: {
    pageName: string;
    instagramUsername: string | null;
    accessTokenExpiresAt: string | null;
    authorizationVerifiedAt: string | null;
  }[];
  orders: number;
  autoReplies7d: { whatsapp: StatusCount[]; meta: StatusCount[] };
};
