import type { ResolvedAccount } from "./config.js";

export interface StoatStartPlan {
  token: string;
  accountId: string;
  config: any;
  apiUrl?: string;
  runtime: any;
  abortSignal?: AbortSignal;
  mediaMaxMb?: number;
  historyLimit?: number;
}

export function buildStoatStartPlan(ctx: any): StoatStartPlan {
  const account = ctx.account as ResolvedAccount;
  const token = account.token?.trim();

  if (!token) {
    throw new Error(`Stoat bot token missing for account "${account.accountId}"`);
  }

  return {
    token,
    accountId: account.accountId,
    config: ctx.cfg,
    apiUrl: account.config.apiUrl,
    runtime: ctx.runtime,
    abortSignal: ctx.abortSignal,
    mediaMaxMb: account.config.mediaMaxMb,
    historyLimit: account.config.historyLimit,
  };
}
