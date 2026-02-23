/**
 * Stoat Provider Monitor
 * 
 * Handles connecting to Stoat and routing messages to Clawdbot's reply pipeline.
 */

import { Client } from "stoat.js";
import { getStoatRuntime, getStoatPluginApi } from "./runtime.js";
import { messageMentionsBot, shouldProcessInboundMessage } from "./routing.js";

// Command prefix for text commands
const COMMAND_PREFIX = "!";

// Reaction triggers (emoji → command)
const REACTION_COMMANDS: Record<string, string> = {
  "🗑️": "clear",
  "📊": "status",
  "❓": "help",
  "🧹": "clear",
  "🔄": "refresh",
  "⏹️": "stop",
};

// Text command definitions
const TEXT_COMMANDS = ["status", "clear", "model", "help", "ping", "menu", "test", "toggle-read-all", "read-mode"];

// Per-channel settings storage (persists in memory, could be extended to file)
import * as fs from "fs";
import * as path from "path";

const SETTINGS_FILE = path.join(process.env.HOME || "/tmp", ".clawdbot", "stoat-channel-settings.json");

interface ChannelSettings {
  readAll: boolean;  // If true, respond to all messages (not just @mentions)
}

const channelSettings = new Map<string, ChannelSettings>();

// Load settings from file
function loadChannelSettings(): void {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8"));
      for (const [channelId, settings] of Object.entries(data)) {
        channelSettings.set(channelId, settings as ChannelSettings);
      }
    }
  } catch (err) {
    console.error(`[stoat] Failed to load channel settings: ${err}`);
  }
}

// Save settings to file
function saveChannelSettings(): void {
  try {
    const dir = path.dirname(SETTINGS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const data: Record<string, ChannelSettings> = {};
    for (const [channelId, settings] of channelSettings) {
      data[channelId] = settings;
    }
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(`[stoat] Failed to save channel settings: ${err}`);
  }
}

// Get settings for a channel
function getChannelSettings(channelId: string): ChannelSettings {
  return channelSettings.get(channelId) || { readAll: false };
}

// Set settings for a channel
function setChannelReadAll(channelId: string, readAll: boolean): void {
  const settings = getChannelSettings(channelId);
  settings.readAll = readAll;
  channelSettings.set(channelId, settings);
  saveChannelSettings();
}

// Load settings on module init
loadChannelSettings();

// Rich embed colors
const EMBED_COLORS = {
  primary: "#9b59b6",    // Purple
  success: "#2ecc71",    // Green
  warning: "#f39c12",    // Orange
  danger: "#e74c3c",     // Red
  info: "#3498db",       // Blue
};

// Command response type - supports rich embeds and reaction buttons
interface CommandResponse {
  content?: string;
  embed?: {
    title?: string;
    description?: string;
    colour?: string;
    icon_url?: string;
    url?: string;
  };
  reactions?: string[];  // Preset reaction "buttons"
  restrictReactions?: boolean;  // Only allow preset reactions
}

// Track interactive messages for reaction handling
const interactiveMessages = new Map<string, {
  sessionKey: string;
  channelId: string;
  reactions: Record<string, string>;  // emoji → action
  expiresAt: number;
}>();

interface MonitorOptions {
  token: string;
  accountId: string;
  config: any;
  apiUrl?: string;
  wsUrl?: string;
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
  const { token, accountId, config, apiUrl, wsUrl, runtime, abortSignal } = opts;
  
  const log = (msg: string) => runtime.log?.(`[stoat] [${accountId}] ${msg}`);
  const error = (msg: string) => runtime.error?.(`[stoat] [${accountId}] ${msg}`);
  
  // Create client with custom API URL if provided
  const clientOpts: any = {};
  if (apiUrl) {
    clientOpts.baseURL = apiUrl;
    log(`Connecting to API ${apiUrl}`);
  }
  if (wsUrl) {
    clientOpts.wsURL = wsUrl;
    log(`Connecting to WS ${wsUrl}`);
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
  
  // Command handler function - returns rich responses with embeds and reaction buttons
  async function handleCommand(
    command: string,
    args: string[],
    message: any,
    channel: any,
    sessionKey: string
  ): Promise<CommandResponse | null> {
    const core = getStoatRuntime();
    
    switch (command.toLowerCase()) {
      case "help": {
        return {
          embed: {
            title: "🐱 Whimsycat Commands",
            description: `**Text Commands:**
• \`!status\` - Show session info
• \`!clear\` - Clear conversation context
• \`!model <name>\` - Change AI model
• \`!ping\` - Check if bot is alive
• \`!menu\` - Interactive menu with buttons
• \`!toggle-read-all\` - Toggle read-all mode
• \`!read-mode\` - Show current read mode
• \`!test\` - Run feature tests
• \`!help\` - Show this help

**Reaction Buttons:**
• 📊 Status • 🗑️ Clear • ❓ Help • 🔄 Refresh`,
            colour: EMBED_COLORS.primary,
          },
        };
      }
      
      case "ping": {
        const uptime = process.uptime();
        const hours = Math.floor(uptime / 3600);
        const mins = Math.floor((uptime % 3600) / 60);
        return {
          embed: {
            title: "🏓 Pong!",
            description: `Bot uptime: **${hours}h ${mins}m**`,
            colour: EMBED_COLORS.success,
          },
        };
      }
      
      case "menu": {
        // Interactive menu with reaction "buttons"
        return {
          embed: {
            title: "🎛️ Whimsycat Control Panel",
            description: `Click a reaction to perform an action:

📊 **Status** - View session info
🗑️ **Clear** - Reset conversation
🔄 **Refresh** - Refresh status
❓ **Help** - Show help`,
            colour: EMBED_COLORS.info,
          },
          reactions: ["📊", "🗑️", "🔄", "❓"],
          restrictReactions: true,
        };
      }
      
      case "status":
      case "refresh": {
        try {
          const sessions = core.session;
          const session = sessions?.getSession?.(sessionKey);
          const tokens = session?.totalTokens ?? 0;
          const model = session?.model ?? "default";
          const contextMax = session?.contextTokens ?? 200000;
          const contextUsed = session?.totalTokens ?? 0;
          const contextPercent = Math.round((contextUsed / contextMax) * 100);
          
          return {
            embed: {
              title: "📊 Session Status",
              description: `**Model:** \`${model}\`
**Tokens Used:** ${tokens.toLocaleString()}
**Context:** ${contextPercent}% (${contextUsed.toLocaleString()} / ${contextMax.toLocaleString()})
**Session:** \`${sessionKey.slice(0, 30)}...\``,
              colour: contextPercent > 80 ? EMBED_COLORS.warning : EMBED_COLORS.primary,
            },
            reactions: ["🔄", "🗑️"],
          };
        } catch (err) {
          return {
            embed: {
              title: "📊 Session Status",
              description: `Session: \`${sessionKey.slice(0, 30)}...\`\n(Detailed stats unavailable)`,
              colour: EMBED_COLORS.info,
            },
          };
        }
      }
      
      case "clear": {
        try {
          const sessions = core.session;
          if (sessions?.clearSession) {
            await sessions.clearSession(sessionKey);
            return {
              embed: {
                title: "🧹 Context Cleared",
                description: "Conversation history has been reset. Starting fresh!",
                colour: EMBED_COLORS.success,
              },
            };
          }
          return {
            embed: {
              title: "⚠️ Clear Failed",
              description: "Session manager unavailable",
              colour: EMBED_COLORS.warning,
            },
          };
        } catch (err) {
          return {
            embed: {
              title: "❌ Error",
              description: `Failed to clear: ${err}`,
              colour: EMBED_COLORS.danger,
            },
          };
        }
      }
      
      case "model": {
        const modelName = args[0];
        if (!modelName) {
          return {
            embed: {
              title: "🤖 Change Model",
              description: `**Usage:** \`!model <name>\`

**Available models:**
• \`opus\` - Most capable
• \`sonnet\` - Balanced
• \`haiku\` - Fast & light`,
              colour: EMBED_COLORS.info,
            },
          };
        }
        try {
          const sessions = core.session;
          if (sessions?.setSessionModel) {
            await sessions.setSessionModel(sessionKey, modelName);
            return {
              embed: {
                title: "✅ Model Changed",
                description: `Now using: **${modelName}**`,
                colour: EMBED_COLORS.success,
              },
            };
          }
          return {
            embed: {
              title: "⚠️ Change Failed",
              description: "Session manager unavailable",
              colour: EMBED_COLORS.warning,
            },
          };
        } catch (err) {
          return {
            embed: {
              title: "❌ Error",
              description: `Failed to change model: ${err}`,
              colour: EMBED_COLORS.danger,
            },
          };
        }
      }
      
      case "toggle-read-all": {
        // Toggle whether the bot reads all messages or only @mentions
        const channelId = (channel as any)?.id;
        if (!channelId) {
          return {
            embed: {
              title: "❌ Error",
              description: "Could not determine channel ID",
              colour: EMBED_COLORS.danger,
            },
          };
        }
        
        const currentSettings = getChannelSettings(channelId);
        const newReadAll = !currentSettings.readAll;
        setChannelReadAll(channelId, newReadAll);
        
        return {
          embed: {
            title: newReadAll ? "👁️ Read-All Mode: ON" : "👁️ Read-All Mode: OFF",
            description: newReadAll 
              ? "I will now respond to **all messages** in this channel.\n\n*Use `!toggle-read-all` to switch back to @mention-only mode.*"
              : "I will now only respond when **@mentioned**.\n\n*Use `!toggle-read-all` to enable read-all mode.*",
            colour: newReadAll ? EMBED_COLORS.success : EMBED_COLORS.info,
          },
        };
      }
      
      case "read-mode": {
        // Show current read mode for this channel
        const channelId = (channel as any)?.id;
        const settings = channelId ? getChannelSettings(channelId) : { readAll: false };
        
        return {
          embed: {
            title: "👁️ Current Read Mode",
            description: settings.readAll
              ? "**Mode:** Read All Messages\nI respond to every message in this channel."
              : "**Mode:** @Mention Only\nI only respond when directly @mentioned.",
            colour: EMBED_COLORS.info,
          },
          reactions: ["🔄"],  // Quick toggle button
        };
      }
      
      case "test": {
        // Comprehensive test of all bot features
        // We'll send multiple messages to test different features
        const testResults: string[] = [];
        
        // Test 1: Basic text message
        try {
          await channel.sendMessage({
            content: "🧪 **Test 1/6: Basic Text Message**\n✅ If you can read this, basic messaging works!",
            replies: [{ id: message.id, mention: false }],
          });
          testResults.push("✅ Basic text");
        } catch (err) {
          testResults.push(`❌ Basic text: ${err}`);
        }
        
        await new Promise(r => setTimeout(r, 500));
        
        // Test 2: Rich Embed
        try {
          await channel.sendMessage({
            embeds: [{
              title: "🧪 Test 2/6: Rich Embed",
              description: "Testing embed features:\n• **Bold text**\n• *Italic text*\n• `Code text`",
              colour: EMBED_COLORS.primary,
            }],
          });
          testResults.push("✅ Rich embed");
        } catch (err) {
          testResults.push(`❌ Rich embed: ${err}`);
        }
        
        await new Promise(r => setTimeout(r, 500));
        
        // Test 3: Colored Embeds
        try {
          await channel.sendMessage({
            embeds: [{
              title: "🧪 Test 3/6: Colored Sidebars",
              description: "This embed has a **purple** sidebar!",
              colour: "#9b59b6",
            }],
          });
          await channel.sendMessage({
            embeds: [{
              title: "🟢 Green",
              description: "Success color",
              colour: EMBED_COLORS.success,
            }],
          });
          await channel.sendMessage({
            embeds: [{
              title: "🔴 Red",
              description: "Danger color", 
              colour: EMBED_COLORS.danger,
            }],
          });
          testResults.push("✅ Colored embeds");
        } catch (err) {
          testResults.push(`❌ Colored embeds: ${err}`);
        }
        
        await new Promise(r => setTimeout(r, 500));
        
        // Test 4: Preset Reactions (Reaction Buttons)
        try {
          const reactionMsg = await channel.sendMessage({
            embeds: [{
              title: "🧪 Test 4/6: Reaction Buttons",
              description: "This message should have preset reaction 'buttons'.\nClick one to trigger an action!",
              colour: EMBED_COLORS.info,
            }],
            interactions: {
              reactions: ["📊", "🗑️", "❓"],
              restrict_reactions: true,
            },
          });
          testResults.push("✅ Preset reactions");
        } catch (err) {
          testResults.push(`❌ Preset reactions: ${err}`);
        }
        
        await new Promise(r => setTimeout(r, 500));
        
        // Test 5: Message Editing
        try {
          const editMsg = await channel.sendMessage({
            embeds: [{
              title: "🧪 Test 5/6: Message Editing",
              description: "⏳ This message will be edited in 2 seconds...",
              colour: EMBED_COLORS.warning,
            }],
          });
          
          await new Promise(r => setTimeout(r, 2000));
          
          await editMsg.edit({
            embeds: [{
              title: "🧪 Test 5/6: Message Editing",
              description: "✅ **Message successfully edited!**\nThe content changed from the original.",
              colour: EMBED_COLORS.success,
            }],
          });
          testResults.push("✅ Message editing");
        } catch (err) {
          testResults.push(`❌ Message editing: ${err}`);
        }
        
        await new Promise(r => setTimeout(r, 500));
        
        // Test 6: Masquerade (custom name/avatar)
        try {
          await channel.sendMessage({
            content: "🧪 **Test 6/6: Masquerade**\nThis message should appear with a different name!",
            masquerade: {
              name: "🤖 Test Bot",
              colour: "#e74c3c",
            },
          });
          testResults.push("✅ Masquerade");
        } catch (err) {
          testResults.push(`❌ Masquerade: ${err}`);
        }
        
        await new Promise(r => setTimeout(r, 500));
        
        // Final summary
        const passed = testResults.filter(r => r.startsWith("✅")).length;
        const failed = testResults.filter(r => r.startsWith("❌")).length;
        
        return {
          embed: {
            title: `🧪 Test Complete: ${passed}/${passed + failed} Passed`,
            description: `**Results:**\n${testResults.join("\n")}\n\n${
              failed === 0 
                ? "🎉 All features working!" 
                : "⚠️ Some features need attention."
            }`,
            colour: failed === 0 ? EMBED_COLORS.success : EMBED_COLORS.warning,
          },
        };
      }
      
      default:
        return null; // Not a recognized command
    }
  }
  
  // Send a command response (with embed and reaction buttons)
  async function sendCommandResponse(
    channel: any,
    response: CommandResponse,
    replyToId?: string,
    sessionKey?: string
  ): Promise<string | null> {
    try {
      const messageData: any = {};
      
      if (response.content) {
        messageData.content = response.content;
      }
      
      if (response.embed) {
        messageData.embeds = [response.embed];
      }
      
      if (replyToId) {
        messageData.replies = [{ id: replyToId, mention: false }];
      }
      
      if (response.reactions && response.restrictReactions) {
        messageData.interactions = {
          reactions: response.reactions,
          restrict_reactions: true,
        };
      }
      
      const sent = await channel.sendMessage(messageData);
      const messageId = sent?.id;
      
      // If we have reaction buttons (but not restricted), add them manually
      if (response.reactions && !response.restrictReactions && messageId) {
        for (const emoji of response.reactions) {
          try {
            await sent.react(emoji);
          } catch {}
        }
      }
      
      // Track interactive messages for reaction handling
      if (response.reactions && messageId && sessionKey) {
        const reactionMap: Record<string, string> = {};
        for (const emoji of response.reactions) {
          if (REACTION_COMMANDS[emoji]) {
            reactionMap[emoji] = REACTION_COMMANDS[emoji];
          }
        }
        
        interactiveMessages.set(messageId, {
          sessionKey,
          channelId: channel.id,
          reactions: reactionMap,
          expiresAt: Date.now() + (30 * 60 * 1000), // 30 min expiry
        });
        
        // Cleanup old entries
        const now = Date.now();
        for (const [id, data] of interactiveMessages) {
          if (data.expiresAt < now) {
            interactiveMessages.delete(id);
          }
        }
      }
      
      return messageId;
    } catch (err) {
      error(`Failed to send command response: ${err}`);
      return null;
    }
  }
  
  // Handle incoming messages
  client.on("messageCreate", async (message) => {
    if (stopped) return;
    
    const isSelf = message.author?.id === client.user?.id;
    const isSystem = Boolean((message as any).system);
    
    const senderName = message.author?.username ?? "Unknown";
    const text = message.content ?? "";
    const senderId = message.author?.id ?? "unknown";
    
    // Check for attachments (images, files)
    const attachments = (message as any).attachments ?? [];
    const hasMedia = attachments.length > 0;
    
    // Check if bot is mentioned (require @mention in channels unless read-all is enabled)
    const botUserId = client.user?.id;
    const channel = message.channel;
    const channelType = (channel as any)?.type ?? (channel as any)?.channelType;
    const isDM = channelType === "DirectMessage" || channelType === "Group";
    const channelId = (channel as any)?.id ?? message.channelId;
    
    // Check channel settings for read-all mode
    const channelConfig = getChannelSettings(channelId);
    const readAllEnabled = channelConfig.readAll;

    // In channels, require mention unless read-all is enabled. In DMs, always respond.
    const mentionIds = Array.isArray((message as any).mentionIds)
      ? ((message as any).mentionIds as string[])
      : Array.isArray((message as any).mentions)
        ? ((message as any).mentions as any[])
            .map((m) => m?.id)
            .filter((id): id is string => typeof id === "string")
        : undefined;
    const isMentioned = messageMentionsBot({ text, botUserId, mentionIds });

    // Commands with ! prefix should always work (even without mention)
    const textTrimmed = text.replace(/<@[^>]+>/g, "").trim();
    const isCommandMessage = textTrimmed.startsWith(COMMAND_PREFIX);

    if (!readAllEnabled && !isCommandMessage) {
      if (!shouldProcessInboundMessage({ isSelf, isSystem, isDM, isMentioned })) return;
    } else {
      // Even in read-all/command mode, still ignore bot/system messages.
      if (isSelf || isSystem) return;
    }
    
    const modeLabel = isDM ? 'DM' : (readAllEnabled ? 'read-all' : (isMentioned ? 'mentioned' : 'command'));
    log(`📨 MESSAGE RECEIVED: "${text}" from ${senderName}${hasMedia ? ` [${attachments.length} attachment(s)]` : ''} [${modeLabel}]`);
    
    // Check for text commands (strip mention first)
    const textWithoutMention = text.replace(/<@[^>]+>/g, "").trim();
    const isCommand = textWithoutMention.startsWith(COMMAND_PREFIX);
    
    if (isCommand) {
      const commandText = textWithoutMention.slice(COMMAND_PREFIX.length).trim();
      const [commandName, ...args] = commandText.split(/\s+/);
      
      if (TEXT_COMMANDS.includes(commandName.toLowerCase())) {
        log(`🎮 COMMAND: ${commandName} ${args.join(" ")}`);
        
        // Get session key for commands that need it
        const core = getStoatRuntime();
        const cfg = core.config.loadConfig();
        const channelId = (channel as any)?.id ?? message.channelId;
        const route = core.channel.routing.resolveAgentRoute({
          cfg,
          channel: "stoat",
          accountId,
          peer: {
            kind: isDM ? "dm" : "channel",
            id: isDM ? senderId : channelId,
          },
        });
        
        const response = await handleCommand(commandName, args, message, channel, route.sessionKey);
        
        if (response) {
          const sentId = await sendCommandResponse(channel, response, message.id, route.sessionKey);
          if (sentId) {
            log(`✅ Command response sent (id: ${sentId})`);
          }
        }
        return; // Don't process as regular message
      }
    }
    
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
            
            const textPreview = String(replyText).slice(0, 80).replace(/\n/g, ' ');
            log(`📤 DELIVERING: "${textPreview}${replyText.length > 80 ? '...' : ''}"`);
            
            try {
              // Send with reply reference to the original message
              await (channel as any).sendMessage({
                content: String(replyText),
                replies: [{ id: messageId, mention: false }],
              });
              didReply = true;
              lastReplyTime = Date.now();
              log(`✅ Reply sent at ${new Date().toISOString()} (replying to ${messageId})`);
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
      
      // The dispatch has returned, but the AI might still be processing (tool calls, etc.)
      // We need to wait until the session is truly idle
      // 
      // Strategy: Keep checking if we're receiving new replies. Wait for a quiet period.
      // Also check if the session is still active via the session API.
      
      const QUIET_PERIOD = 3000;   // 3 seconds of no new replies = probably done
      const CHECK_INTERVAL = 500;  // Check every 500ms
      const MAX_WAIT = 180000;     // 3 minute max wait (for long tool operations)
      const startWait = Date.now();
      
      let lastSeenReplyTime = lastReplyTime;
      let quietSince = lastReplyTime > 0 ? lastReplyTime : Date.now();
      
      // Keep typing indicator running while we wait
      log(`⏳ Dispatch returned, monitoring for completion...`);
      
      while (Date.now() - startWait < MAX_WAIT) {
        await new Promise(resolve => setTimeout(resolve, CHECK_INTERVAL));
        
        // Check if we got new replies
        if (lastReplyTime > lastSeenReplyTime) {
          log(`📝 New reply detected at ${new Date(lastReplyTime).toISOString()}`);
          lastSeenReplyTime = lastReplyTime;
          quietSince = lastReplyTime;
        }
        
        // Check if we've been quiet long enough
        const quietDuration = Date.now() - quietSince;
        if (quietDuration >= QUIET_PERIOD) {
          log(`⏱️ Quiet for ${quietDuration}ms, assuming complete`);
          break;
        }
        
        // Optional: Try to check session status
        try {
          const sessions = core.session;
          const session = sessions?.getSession?.(route.sessionKey);
          if (session && !(session as any).isProcessing) {
            log(`📊 Session reports not processing`);
            // Still wait the quiet period to be safe
          }
        } catch {}
      }
      
      // Stop typing indicator
      if (typingInterval) {
        clearInterval(typingInterval);
      }
      try {
        await (channel as any).stopTyping?.();
      } catch {}
      
      // Only mark complete if we actually sent a reply
      if (didReply) {
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
  
  // Handle reaction-based commands (reaction "buttons")
  client.on("messageReactionAdd" as any, async (reaction: any) => {
    if (stopped) return;
    
    try {
      // Get the emoji - might be a string or an object
      const emoji = typeof reaction.emoji === "string" 
        ? reaction.emoji 
        : reaction.emoji?.name ?? reaction.emoji?.id;
      
      // Don't respond to bot's own reactions
      if (reaction.user?.id === client.user?.id) return;
      
      // Get the message that was reacted to
      const message = reaction.message;
      const messageId = message?.id;
      const channel = message?.channel;
      
      if (!channel || !messageId) {
        return;
      }
      
      // Check if this is an interactive message we're tracking
      const interactive = interactiveMessages.get(messageId);
      let command: string | undefined;
      let sessionKey: string;
      
      if (interactive && interactive.reactions[emoji]) {
        // This is a tracked interactive message
        command = interactive.reactions[emoji];
        sessionKey = interactive.sessionKey;
        log(`🎯 BUTTON CLICK: ${emoji} → ${command} (interactive message)`);
      } else if (REACTION_COMMANDS[emoji]) {
        // Generic reaction command on any message
        command = REACTION_COMMANDS[emoji];
        
        // Get session key from routing
        const core = getStoatRuntime();
        const cfg = core.config.loadConfig();
        const channelId = (channel as any)?.id ?? message?.channelId;
        const channelType = (channel as any)?.type ?? (channel as any)?.channelType;
        const isDM = channelType === "DirectMessage" || channelType === "Group";
        const senderId = reaction.user?.id ?? "unknown";
        
        const route = core.channel.routing.resolveAgentRoute({
          cfg,
          channel: "stoat",
          accountId,
          peer: {
            kind: isDM ? "dm" : "channel",
            id: isDM ? senderId : channelId,
          },
        });
        sessionKey = route.sessionKey;
        log(`🎯 REACTION COMMAND: ${emoji} → ${command}`);
      } else {
        return; // Not a command reaction
      }
      
      const response = await handleCommand(command, [], message, channel, sessionKey);
      
      if (response) {
        // For interactive messages, try to edit the original instead of sending new
        if (interactive && response.embed) {
          try {
            const editData: any = {};
            if (response.embed) {
              editData.embeds = [response.embed];
            }
            if (response.content) {
              editData.content = response.content;
            }
            await message.edit(editData);
            log(`✅ Interactive message updated`);
            
            // Remove the user's reaction to show it was processed
            try {
              await message.unreact(emoji, reaction.user?.id);
            } catch {}
            
            return;
          } catch (err) {
            log(`Could not edit message, sending new: ${err}`);
          }
        }
        
        // Send as new message
        await sendCommandResponse(channel, response, undefined, sessionKey);
        log(`✅ Reaction command response sent`);
      }
    } catch (err) {
      error(`Failed to handle reaction: ${err}`);
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
