/**
 * Stoat Channel Plugin for Clawdbot
 * 
 * Stoat is an open-source Discord alternative (fork of Revolt).
 * This plugin adds Stoat as a messaging channel.
 */

import type { PluginAPI } from "clawdbot/plugin-sdk";
import { monitorStoatProvider } from "./monitor.js";
import { sendMessageStoat, sendMediaStoat } from "./send.js";
import { setStoatPluginApi } from "./runtime.js";
import {
  DEFAULT_ACCOUNT_ID,
  listAccountIds,
  resolveAccount,
} from "./config.js";
import type { ResolvedAccount } from "./config.js";
import { buildStoatStartPlan } from "./start-plan.js";

const stoatPlugin = {
  id: "stoat",
  
  meta: {
    id: "stoat",
    label: "Stoat",
    selectionLabel: "Stoat (self-hosted)",
    docsPath: "/channels/stoat",
    blurb: "Open-source Discord alternative (Revolt fork).",
    aliases: ["revolt"],
  },
  
  capabilities: {
    chatTypes: ["direct", "channel"] as const,
    media: true,
    reactions: true,
    threads: false, // Stoat doesn't have threads like Discord
    polls: false,
    nativeCommands: false,
  },
  
  streaming: {
    blockStreamingCoalesceDefaults: { minChars: 1500, idleMs: 1000 },
  },
  
  reload: { configPrefixes: ["channels.stoat"] },
  
  config: {
    listAccountIds: (cfg: any) => listAccountIds(cfg),
    resolveAccount: (cfg: any, accountId?: string) => resolveAccount(cfg, accountId),
    defaultAccountId: (cfg: any) => {
      const ids = listAccountIds(cfg);
      return ids.includes(DEFAULT_ACCOUNT_ID) ? DEFAULT_ACCOUNT_ID : ids[0];
    },
    isConfigured: (account: ResolvedAccount) => Boolean(account.token?.trim()),
    describeAccount: (account: ResolvedAccount) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: Boolean(account.token?.trim()),
    }),
    resolveAllowFrom: ({ cfg, accountId }: { cfg: any; accountId?: string }) => {
      const account = resolveAccount(cfg, accountId);
      return account.config.dm?.allowFrom ?? [];
    },
    formatAllowFrom: ({ allowFrom }: { allowFrom: string[] }) =>
      allowFrom.map((e) => e.trim().toLowerCase()).filter(Boolean),
  },
  
  security: {
    resolveDmPolicy: ({ cfg, accountId, account }: any) => {
      const resolvedAccount = account ?? resolveAccount(cfg, accountId);
      return {
        policy: resolvedAccount.config.dm?.policy ?? "pairing",
        allowFrom: resolvedAccount.config.dm?.allowFrom ?? [],
        allowFromPath: `channels.stoat.dm.`,
        approveHint: "Use /approve stoat:<userId> to allow this user.",
        normalizeEntry: (raw: string) => raw.replace(/^(stoat|user):/i, ""),
      };
    },
  },
  
  messaging: {
    normalizeTarget: (input: string) => {
      // Stoat channel IDs are typically 26-character ULIDs
      const cleaned = input.trim();
      if (/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(cleaned)) {
        return { target: cleaned, note: null };
      }
      // Handle user: or channel: prefix
      const match = cleaned.match(/^(user|channel):(.+)$/i);
      if (match) {
        return { target: match[2], note: null };
      }
      return { target: cleaned, note: null };
    },
    targetResolver: {
      looksLikeId: (input: string) => /^[0-9A-HJKMNP-TV-Z]{26}$/i.test(input.trim()),
      hint: "<channelId|user:ID>",
    },
  },
  
  outbound: {
    deliveryMode: "direct" as const,
    chunker: null,
    textChunkLimit: 2000,
    
    sendText: async ({ to, text, accountId, replyToId }: any) => {
      const result = await sendMessageStoat(to, text, {
        accountId,
        replyTo: replyToId,
      });
      return { channel: "stoat", ...result };
    },
    
    sendMedia: async ({ to, text, mediaUrl, accountId, replyToId }: any) => {
      const result = await sendMediaStoat(to, text, mediaUrl, {
        accountId,
        replyTo: replyToId,
      });
      return { channel: "stoat", ...result };
    },
  },
  
  gateway: {
    startAccount: async (ctx: any) => {
      const startPlan = buildStoatStartPlan(ctx);

      ctx.log?.info(`[${startPlan.accountId}] starting Stoat provider`);

      return monitorStoatProvider(startPlan);
    },
  },
  
  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    buildChannelSummary: ({ snapshot }: any) => ({
      configured: snapshot.configured ?? false,
      running: snapshot.running ?? false,
      lastStartAt: snapshot.lastStartAt ?? null,
      lastStopAt: snapshot.lastStopAt ?? null,
      lastError: snapshot.lastError ?? null,
    }),
  },
};

export default function register(api: PluginAPI) {
  // Store the API for use in message handling
  setStoatPluginApi(api);
  
  api.registerChannel({ plugin: stoatPlugin });
  
  api.logger.info("Stoat channel plugin loaded");
}

export { stoatPlugin };
