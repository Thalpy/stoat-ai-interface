const DEFAULT_ACCOUNT_ID = "default";

export interface StoatAccountConfig {
  token?: string;
  enabled?: boolean;
  name?: string;
  apiUrl?: string;
  wsUrl?: string;
  dm?: {
    enabled?: boolean;
    policy?: "open" | "pairing" | "allowlist";
    allowFrom?: string[];
  };
  servers?: Record<string, {
    enabled?: boolean;
    channels?: Record<string, { enabled?: boolean }>;
  }>;
  groupPolicy?: "open" | "allowlist";
  mediaMaxMb?: number;
  historyLimit?: number;
}

export interface StoatConfig {
  enabled?: boolean;
  token?: string;
  name?: string;
  apiUrl?: string;
  wsUrl?: string;
  accounts?: Record<string, StoatAccountConfig>;
  dm?: StoatAccountConfig["dm"];
  servers?: StoatAccountConfig["servers"];
  groupPolicy?: "open" | "allowlist";
  mediaMaxMb?: number;
  historyLimit?: number;
}

export interface ResolvedAccount {
  accountId: string;
  token?: string;
  name?: string;
  enabled: boolean;
  config: StoatAccountConfig;
}

export function getStoatConfig(cfg: any): StoatConfig | undefined {
  return cfg?.channels?.stoat;
}

export function listAccountIds(cfg: any): string[] {
  const stoatCfg = getStoatConfig(cfg);
  if (!stoatCfg) return [];

  const accountIds = new Set<string>();

  if (stoatCfg.token) {
    accountIds.add(DEFAULT_ACCOUNT_ID);
  }

  if (stoatCfg.accounts) {
    for (const id of Object.keys(stoatCfg.accounts)) {
      accountIds.add(id);
    }
  }

  return Array.from(accountIds);
}

export function resolveAccount(cfg: any, accountId?: string): ResolvedAccount {
  const stoatCfg = getStoatConfig(cfg);
  const resolvedId = accountId ?? DEFAULT_ACCOUNT_ID;

  if (!stoatCfg) {
    return {
      accountId: resolvedId,
      enabled: false,
      config: {},
    };
  }

  const namedAccount = stoatCfg.accounts?.[resolvedId];
  if (namedAccount) {
    return {
      accountId: resolvedId,
      token: namedAccount.token,
      name: namedAccount.name,
      enabled: namedAccount.enabled ?? true,
      config: {
        ...namedAccount,
        apiUrl: namedAccount.apiUrl ?? stoatCfg.apiUrl,
        wsUrl: namedAccount.wsUrl ?? stoatCfg.wsUrl,
        dm: namedAccount.dm ?? stoatCfg.dm,
        servers: namedAccount.servers ?? stoatCfg.servers,
        groupPolicy: namedAccount.groupPolicy ?? stoatCfg.groupPolicy,
        mediaMaxMb: namedAccount.mediaMaxMb ?? stoatCfg.mediaMaxMb,
        historyLimit: namedAccount.historyLimit ?? stoatCfg.historyLimit,
      },
    };
  }

  if (resolvedId === DEFAULT_ACCOUNT_ID) {
    return {
      accountId: DEFAULT_ACCOUNT_ID,
      token: stoatCfg.token,
      name: stoatCfg.name,
      enabled: stoatCfg.enabled ?? true,
      config: {
        token: stoatCfg.token,
        apiUrl: stoatCfg.apiUrl,
        wsUrl: stoatCfg.wsUrl,
        dm: stoatCfg.dm,
        servers: stoatCfg.servers,
        groupPolicy: stoatCfg.groupPolicy,
        mediaMaxMb: stoatCfg.mediaMaxMb,
        historyLimit: stoatCfg.historyLimit,
      },
    };
  }

  return {
    accountId: resolvedId,
    enabled: false,
    config: {},
  };
}

export { DEFAULT_ACCOUNT_ID };
