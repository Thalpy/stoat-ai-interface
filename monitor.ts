/**
 * Stoat Provider Monitor
 * 
 * Handles connecting to Stoat and routing messages to Clawdbot's reply pipeline.
 */

import { Client } from "stoat.js";
import { getStoatRuntime, getStoatPluginApi } from "./runtime.js";

interface MonitorOptions {
  token: string;
  accountId: string;
  config: any;
  apiUrl?: string;
  runtime: {
    log?: (...args: any[]) => void;
    error?: (...args: any[]) => void;
  };
  abortSignal?: AbortSignal;
  mediaMaxMb?: number;
  historyLimit?: number;
}

// Store active clients for sending
interface ClientEntry {
  client: Client;
  apiUrl?: string;
}

const activeClients = new Map<string, ClientEntry>();

export function getStoatClient(accountId: string = "default"): Client | undefined {
  return activeClients.get(accountId)?.client;
}

export function getStoatClientEntry(accountId: string = "default"): ClientEntry | undefined {
  return activeClients.get(accountId);
}

export async function monitorStoatProvider(opts: MonitorOptions): Promise<() => void> {
  const { token, accountId, config, apiUrl, runtime, abortSignal } = opts;
  
  const log = (msg: string) => runtime.log?.(`[stoat] [${accountId}] ${msg}`);
  const error = (msg: string) => runtime.error?.(`[stoat] [${accountId}] ${msg}`);
  
  // Create client with custom API URL if provided
  const clientOpts: any = {};
  if (apiUrl) {
    clientOpts.baseURL = apiUrl;
    log(`Connecting to ${apiUrl}`);
  }
  
  const client = new Client(clientOpts);
  let stopped = false;
  
  // Store for sending
  activeClients.set(accountId, { client, apiUrl });
  
  // Handle WebSocket events for logging
  client.on("connecting" as any, () => {
    log("🔄 Connecting to WebSocket...");
  });
  
  // Handle ready event
  client.on("ready", () => {
    const username = client.user?.username ?? "unknown";
    log(`✅ READY! Connected as ${username}`);
  });
  
  // Handle incoming messages
  client.on("messageCreate", async (message) => {
    if (stopped) return;
    
    // Skip own messages
    if (message.author?.id === client.user?.id) return;
    
    // Skip system messages
    if ((message as any).system) return;
    
    const senderName = message.author?.username ?? "Unknown";
    const text = message.content ?? "";
    const senderId = message.author?.id ?? "unknown";
    
    // Check for attachments (images, files)
    const attachments = (message as any).attachments ?? [];
    const hasMedia = attachments.length > 0;
    
    // Check if bot is mentioned (require @mention in channels)
    const botUserId = client.user?.id;
    const channel = message.channel;
    const channelType = (channel as any)?.type ?? (channel as any)?.channelType;
    const isDM = channelType === "DirectMessage" || channelType === "Group";
    
    // In channels, require mention. In DMs, always respond.
    const isMentioned = botUserId && text.includes(`<@${botUserId}>`);
    
    if (!isDM && !isMentioned) {
      // Not mentioned in a channel, ignore silently
      return;
    }
    
    log(`📨 MESSAGE RECEIVED: "${text}" from ${senderName}${hasMedia ? ` [${attachments.length} attachment(s)]` : ''}${isMentioned ? ' [mentioned]' : ' [DM]'}`);
    
    // React with 👀 to show we're processing
    try {
      await message.react("👀");
      log(`👀 Added processing reaction`);
    } catch (err) {
      log(`Could not add reaction: ${err}`);
    }
    
    // Start typing indicator (channel already declared above)
    let typingInterval: any = null;
    try {
      await (channel as any).startTyping?.();
      // Keep typing indicator alive (Stoat may need periodic pings)
      typingInterval = setInterval(async () => {
        try {
          await (channel as any).startTyping?.();
        } catch {}
      }, 3000);
      log(`⌨️ Started typing indicator`);
    } catch (err) {
      log(`Could not start typing: ${err}`);
    }
    
    try {
      const core = getStoatRuntime();
      const cfg = core.config.loadConfig();
      
      // Determine chat type (channel, channelType, isDM already declared above)
      const chatType = isDM ? "direct" : "channel";
      
      const channelId = (channel as any)?.id ?? message.channelId;
      const messageId = message.id;
      
      // Resolve agent route
      const route = core.channel.routing.resolveAgentRoute({
        cfg,
        channel: "stoat",
        accountId,
        peer: {
          kind: isDM ? "dm" : "channel",
          id: isDM ? senderId : channelId,
        },
      });
      
      log(`🔄 Routing to AI (session: ${route.sessionKey})`);
      
      // Process attachments for media understanding
      let mediaUrl: string | undefined;
      let mediaType: string | undefined;
      let mediaPath: string | undefined;
      const mediaUrls: string[] = [];
      const mediaTypes: string[] = [];
      
      if (attachments.length > 0) {
        // Determine Autumn URL from API URL for self-hosted instances
        let autumnBase = "https://autumn.revolt.chat";
        if (apiUrl) {
          try {
            const apiUrlObj = new URL(apiUrl);
            // Self-hosted often uses /autumn path instead of subdomain
            // e.g., bamalam.xyz/autumn instead of autumn.bamalam.xyz
            const baseDomain = apiUrlObj.host.replace(/^api\./, '').replace(/\/api$/, '');
            autumnBase = `${apiUrlObj.protocol}//${baseDomain}/autumn`;
          } catch {}
        }
        
        for (const att of attachments) {
          // Stoat attachments have url or can be constructed from id
          const attUrl = att.url ?? `${autumnBase}/attachments/${att.id}`;
          const attType = att.contentType ?? att.metadata?.type ?? 'application/octet-stream';
          
          mediaUrls.push(attUrl);
          mediaTypes.push(attType);
          
          // Use first image as primary media
          if (!mediaUrl && attType.startsWith('image/')) {
            mediaUrl = attUrl;
            mediaType = attType;
          }
        }
        log(`🖼️ Media attachments: ${mediaUrls.join(', ')}`);
        
        // Download and save the first image for media understanding
        if (mediaUrl) {
          try {
            // Use custom fetch that ignores SSL errors for self-hosted instances
            const customFetch = async (url: string) => {
              // For Node.js, we need to use undici or node-fetch with agent
              // For now, try native fetch and fall back to logging
              return fetch(url);
            };
            
            const mediaResult = await core.channel.media.fetchRemoteMedia({
              url: mediaUrl,
              maxBytes: 20 * 1024 * 1024, // 20MB limit
            });
            if (mediaResult.ok && mediaResult.buffer) {
              const saved = await core.channel.media.saveMediaBuffer({
                buffer: mediaResult.buffer,
                contentType: mediaType ?? 'image/png',
                source: 'stoat-inbound',
              });
              if (saved.path) {
                mediaPath = saved.path;
                log(`🖼️ Saved media to: ${mediaPath}`);
              }
            }
          } catch (err) {
            log(`Could not download media: ${err}`);
            // Still include the URL so the agent knows there's an image
          }
        }
      }
      
      // Build the inbound context
      const ctx: any = {
        // Surface info
        Surface: "stoat",
        Provider: "stoat",
        Channel: "stoat",
        AccountId: accountId,
        
        // Message info
        MessageSid: messageId,
        Body: text,
        RawBody: text,
        BodyForAgent: `[Stoat ${isDM ? 'DM' : channelId}] ${senderName}: ${text}${mediaUrl ? `\n[Image attached: ${mediaUrl}]` : ''}`,
        
        // Sender info
        From: senderId,
        FromName: senderName,
        ProfileName: senderName,
        
        // Target info
        To: channelId,
        
        // Chat type
        ChatType: chatType,
        IsGroup: !isDM,
        
        // Session
        SessionKey: route.sessionKey,
        
        // Timestamps
        Timestamp: Date.now(),
        
        // Command authorization (allow all for now)
        CommandAuthorized: true,
        
        // Media info (for image understanding)
        ...(mediaUrl && {
          MediaUrl: mediaUrl,
          MediaType: mediaType,
          MediaUrls: mediaUrls,
          MediaTypes: mediaTypes,
          NumMedia: mediaUrls.length,
          ...(mediaPath && { MediaPath: mediaPath }),
        }),
      };
      
      // Finalize the context
      const finalCtx = core.channel.reply.finalizeInboundContext(ctx);
      
      // Track if we sent a reply and when the last reply was sent
      let didReply = false;
      let lastReplyTime = 0;
      
      // Create the reply dispatcher
      const { dispatcher, replyOptions, markDispatchIdle } = 
        core.channel.reply.createReplyDispatcherWithTyping({
          responsePrefix: null,
          responsePrefixContextProvider: null,
          humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
          deliver: async (payload: any) => {
            const replyText = payload.text ?? payload;
            if (!replyText) return;
            
            log(`📤 SENDING REPLY: "${String(replyText).slice(0, 50)}..."`);
            try {
              // Send with reply reference to the original message
              await (channel as any).sendMessage({
                content: String(replyText),
                replies: [{ id: messageId, mention: false }],
              });
              didReply = true;
              lastReplyTime = Date.now();
              log(`✅ Reply sent (replying to ${messageId})`);
            } catch (err) {
              error(`Failed to send reply: ${err}`);
            }
          },
          onError: (err: any, info: any) => {
            error(`Reply error (${info?.kind}): ${err}`);
          },
          onReplyStart: () => {
            // Could send typing indicator here
          },
          onIdle: () => {
            // Typing stopped
          },
        });
      
      // Dispatch to the AI
      const result = await core.channel.reply.dispatchReplyFromConfig({
        ctx: finalCtx,
        cfg,
        dispatcher,
        replyOptions,
      });
      
      markDispatchIdle();
      
      // Stop typing indicator
      if (typingInterval) {
        clearInterval(typingInterval);
      }
      try {
        await (channel as any).stopTyping?.();
      } catch {}
      
      // Wait a moment after dispatch completes to ensure all replies are delivered
      // This handles cases where the AI does tool calls after initial response
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Only mark complete if we actually sent a reply
      if (didReply) {
        // Additional wait if last reply was very recent (might be more coming)
        const timeSinceLastReply = Date.now() - lastReplyTime;
        if (timeSinceLastReply < 500) {
          await new Promise(resolve => setTimeout(resolve, 500 - timeSinceLastReply));
        }
        
        try {
          await message.unreact("👀");
          await message.react("✅");
          log(`✅ Updated reaction to complete`);
        } catch (err) {
          log(`Could not update reaction: ${err}`);
        }
        log(`✅ Conversation complete`);
      } else {
        // No reply - remove processing indicator
        try {
          await message.unreact("👀");
        } catch {}
        log(`⏭️ No reply generated`);
      }
      
    } catch (err) {
      // Stop typing on error too
      if (typingInterval) {
        clearInterval(typingInterval);
      }
      try {
        await (channel as any).stopTyping?.();
        await message.unreact("👀");
        await message.react("❌");
      } catch {}
      
      error(`Failed to route message: ${err}`);
    }
  });
  
  // Handle errors
  client.on("error" as any, (err: any) => {
    error(`WebSocket error: ${err}`);
  });
  
  client.on("disconnected" as any, () => {
    log("❌ Disconnected from WebSocket");
  });
  
  // Login
  try {
    log("Login successful");
    await client.loginBot(token);
  } catch (err) {
    activeClients.delete(accountId);
    throw new Error(`Failed to login to Stoat: ${err}`);
  }
  
  // Handle abort signal
  if (abortSignal) {
    abortSignal.addEventListener("abort", () => {
      stopped = true;
      activeClients.delete(accountId);
      log("Provider stopped");
    });
  }
  
  // Return cleanup function
  return () => {
    stopped = true;
    activeClients.delete(accountId);
    log("Provider cleanup");
  };
}
