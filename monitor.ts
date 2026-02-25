/**
 * Stoat Provider Monitor
 * 
 * Handles connecting to Stoat and routing messages to Clawdbot's reply pipeline.
 */

import { Client } from "stoat.js";
import { getStoatRuntime, getStoatPluginApi } from "./runtime.js";

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

// =============================================================================
// MESSAGE QUEUE SYSTEM
// =============================================================================

// Emojis for queue system
const EMOJI_PROCESSING = "👀";   // Currently being processed
const EMOJI_QUEUED = "📥";       // Queued for next batch
const EMOJI_STOP = "⏹️";         // Stop/cancel
const EMOJI_COMPLETE = "✅";     // Completed
const EMOJI_CANCELLED = "🚫";    // Was cancelled

// Queued message info
interface QueuedMessage {
  id: string;
  content: string;
  authorId: string;
  authorName: string;
  message: any;  // The actual message object
  queuedAt: number;
  cancelled: boolean;
}

// Channel processing state
interface ChannelProcessingState {
  isProcessing: boolean;
  currentMessageId: string | null;
  abortController: AbortController | null;
  queuedMessages: QueuedMessage[];
}

// Per-channel processing state
const channelProcessingState = new Map<string, ChannelProcessingState>();

// Get or create processing state for a channel
function getChannelState(channelId: string): ChannelProcessingState {
  let state = channelProcessingState.get(channelId);
  if (!state) {
    state = {
      isProcessing: false,
      currentMessageId: null,
      abortController: null,
      queuedMessages: [],
    };
    channelProcessingState.set(channelId, state);
  }
  return state;
}

// Add message to queue
function queueMessage(channelId: string, msg: QueuedMessage): void {
  const state = getChannelState(channelId);
  state.queuedMessages.push(msg);
}

// Remove message from queue (by ID)
function dequeueMessage(channelId: string, messageId: string): QueuedMessage | null {
  const state = getChannelState(channelId);
  const index = state.queuedMessages.findIndex(m => m.id === messageId);
  if (index !== -1) {
    const [removed] = state.queuedMessages.splice(index, 1);
    return removed;
  }
  return null;
}

// Mark a queued message as cancelled (but keep in queue for tracking)
function cancelQueuedMessage(channelId: string, messageId: string): boolean {
  const state = getChannelState(channelId);
  const msg = state.queuedMessages.find(m => m.id === messageId);
  if (msg && !msg.cancelled) {
    msg.cancelled = true;
    return true;
  }
  return false;
}

// Get all non-cancelled queued messages and clear the queue
function flushQueue(channelId: string): QueuedMessage[] {
  const state = getChannelState(channelId);
  const messages = state.queuedMessages.filter(m => !m.cancelled);
  state.queuedMessages = [];
  return messages;
}

// Request abort of current processing
function requestAbort(channelId: string): boolean {
  const state = getChannelState(channelId);
  if (state.isProcessing && state.abortController) {
    state.abortController.abort();
    return true;
  }
  return false;
}

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
  
  // ==========================================================================
  // MAIN MESSAGE PROCESSOR (with queue support)
  // ==========================================================================
  
  async function processMessages(
    channelId: string,
    channel: any,
    messages: QueuedMessage[],
    isDM: boolean
  ): Promise<void> {
    if (messages.length === 0) return;
    
    const state = getChannelState(channelId);
    const core = getStoatRuntime();
    const cfg = core.config.loadConfig();
    
    // Get session key
    const firstMsg = messages[0];
    const route = core.channel.routing.resolveAgentRoute({
      cfg,
      channel: "stoat",
      accountId,
      peer: {
        kind: isDM ? "dm" : "channel",
        id: isDM ? firstMsg.authorId : channelId,
      },
    });
    
    // Create abort controller for this processing batch
    state.abortController = new AbortController();
    state.currentMessageId = firstMsg.id;
    
    // Mark all messages as processing (change 📥 to 👀, or add 👀)
    for (const msg of messages) {
      try {
        await msg.message.unreact(EMOJI_QUEUED);
      } catch {}
      try {
        await msg.message.react(EMOJI_PROCESSING);
        await msg.message.react(EMOJI_STOP);  // Add stop button
      } catch {}
    }
    
    // Start typing indicator
    let typingInterval: any = null;
    try {
      await (channel as any).startTyping?.();
      typingInterval = setInterval(async () => {
        try { await (channel as any).startTyping?.(); } catch {}
      }, 3000);
    } catch {}
    
    // Build combined prompt from all messages
    let combinedBody = "";
    const messageIds: string[] = [];
    
    for (const msg of messages) {
      if (messages.length > 1) {
        combinedBody += `[${msg.authorName}]: ${msg.content}\n`;
      } else {
        combinedBody = msg.content;
      }
      messageIds.push(msg.id);
    }
    
    log(`🔄 Processing ${messages.length} message(s) for channel ${channelId}`);
    
    // Track replies
    let didReply = false;
    let lastReplyTime = 0;
    
    try {
      // Build context
      const ctx: any = {
        Surface: "stoat",
        Provider: "stoat",
        Channel: "stoat",
        AccountId: accountId,
        MessageSid: firstMsg.id,
        Body: combinedBody.replace(/<@[^>]+>/g, "").trim(),
        RawBody: combinedBody,
        BodyForAgent: messages.length > 1 
          ? `[Stoat ${isDM ? 'DM' : channelId}] Multiple messages:\n${combinedBody}`
          : `[Stoat ${isDM ? 'DM' : channelId}] ${firstMsg.authorName}: ${combinedBody}`,
        From: firstMsg.authorId,
        FromName: firstMsg.authorName,
        ProfileName: firstMsg.authorName,
        To: channelId,
        ChatType: isDM ? "direct" : "channel",
        IsGroup: !isDM,
        SessionKey: route.sessionKey,
        Timestamp: Date.now(),
        CommandAuthorized: true,
      };
      
      const finalCtx = core.channel.reply.finalizeInboundContext(ctx);
      
      // Create dispatcher
      const { dispatcher, replyOptions, markDispatchIdle } = 
        core.channel.reply.createReplyDispatcherWithTyping({
          responsePrefix: null,
          responsePrefixContextProvider: null,
          humanDelay: core.channel.reply.resolveHumanDelayConfig(cfg, route.agentId),
          deliver: async (payload: any) => {
            // Check if aborted
            if (state.abortController?.signal.aborted) {
              log(`🛑 Delivery skipped - aborted`);
              return;
            }
            
            const replyText = payload.text ?? payload;
            if (!replyText) return;
            
            const textPreview = String(replyText).slice(0, 80).replace(/\n/g, ' ');
            log(`📤 DELIVERING: "${textPreview}${replyText.length > 80 ? '...' : ''}"`);
            
            try {
              await (channel as any).sendMessage({
                content: String(replyText),
                replies: [{ id: firstMsg.id, mention: false }],
              });
              didReply = true;
              lastReplyTime = Date.now();
              log(`✅ Reply sent`);
            } catch (err) {
              error(`Failed to send reply: ${err}`);
            }
          },
          onError: (err: any, info: any) => {
            error(`Reply error (${info?.kind}): ${err}`);
          },
          onReplyStart: () => {},
          onIdle: () => {},
        });
      
      // Dispatch to AI
      await core.channel.reply.dispatchReplyFromConfig({
        ctx: finalCtx,
        cfg,
        dispatcher,
        replyOptions,
      });
      
      markDispatchIdle();
      
      // Wait for quiet period (unless aborted)
      const QUIET_PERIOD = 3000;
      const MAX_WAIT = 180000;
      const startWait = Date.now();
      let lastSeenReplyTime = lastReplyTime;
      let quietSince = lastReplyTime > 0 ? lastReplyTime : Date.now();
      
      while (Date.now() - startWait < MAX_WAIT && !state.abortController?.signal.aborted) {
        await new Promise(resolve => setTimeout(resolve, 500));
        
        if (lastReplyTime > lastSeenReplyTime) {
          lastSeenReplyTime = lastReplyTime;
          quietSince = lastReplyTime;
        }
        
        if (Date.now() - quietSince >= QUIET_PERIOD) {
          break;
        }
      }
      
    } catch (err) {
      error(`Failed to process messages: ${err}`);
    }
    
    // Stop typing
    if (typingInterval) clearInterval(typingInterval);
    try { await (channel as any).stopTyping?.(); } catch {}
    
    // Update reactions on all messages
    const wasAborted = state.abortController?.signal.aborted;
    for (const msg of messages) {
      try {
        await msg.message.unreact(EMOJI_PROCESSING);
        await msg.message.unreact(EMOJI_STOP);
        await msg.message.react(wasAborted ? EMOJI_CANCELLED : EMOJI_COMPLETE);
      } catch {}
    }
    
    log(wasAborted ? `🛑 Processing aborted` : `✅ Processing complete`);
    
    // Clear processing state
    state.isProcessing = false;
    state.currentMessageId = null;
    state.abortController = null;
    
    // Check if there are more messages in the queue
    const nextBatch = flushQueue(channelId);
    if (nextBatch.length > 0) {
      log(`📥 Processing ${nextBatch.length} queued message(s)...`);
      state.isProcessing = true;
      // Process next batch (don't await to prevent blocking)
      processMessages(channelId, channel, nextBatch, isDM).catch(err => {
        error(`Failed to process queued messages: ${err}`);
        state.isProcessing = false;
      });
    }
  }
  
  // ==========================================================================
  // MESSAGE HANDLER
  // ==========================================================================
  
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
    // Check for @mention OR case-insensitive name mention "Whimsycat"
    const isMentioned = (botUserId && text.includes(`<@${botUserId}>`)) || 
                        /\bwhimsycat\b/i.test(text);
    
    // Check if this is a reply to one of the bot's messages
    const replyIds = (message as any).replyIds ?? (message as any).replies ?? [];
    let isReplyToBot = false;
    if (replyIds.length > 0 && botUserId) {
      // Check if any of the replied-to messages are from the bot
      // We need to fetch the replied message to check authorship
      try {
        for (const replyId of replyIds) {
          const repliedMsg = await channel.fetchMessage?.(replyId) ?? 
                            (channel as any).messages?.get(replyId);
          if (repliedMsg?.author?.id === botUserId || repliedMsg?.authorId === botUserId) {
            isReplyToBot = true;
            break;
          }
        }
      } catch (err) {
        // If we can't fetch the message, check if the reply object has author info
        for (const reply of replyIds) {
          if (typeof reply === 'object' && reply.authorId === botUserId) {
            isReplyToBot = true;
            break;
          }
        }
      }
    }
    
    // Commands with ! prefix should always work (even without mention)
    const textTrimmed = text.replace(/<@[^>]+>/g, "").trim();
    const isCommandMessage = textTrimmed.startsWith(COMMAND_PREFIX);
    
    if (!isDM && !isMentioned && !isReplyToBot && !readAllEnabled && !isCommandMessage) {
      return;
    }
    
    const modeLabel = isDM ? 'DM' : (readAllEnabled ? 'read-all' : (isReplyToBot ? 'reply' : (isMentioned ? 'mentioned' : 'command')));
    log(`📨 MESSAGE RECEIVED: "${text}" from ${senderName}${hasMedia ? ` [${attachments.length} attachment(s)]` : ''} [${modeLabel}]`);
    
    // Check for text commands (strip mention first)
    const textWithoutMention = text.replace(/<@[^>]+>/g, "").trim();
    const isCommand = textWithoutMention.startsWith(COMMAND_PREFIX);
    
    if (isCommand) {
      const commandText = textWithoutMention.slice(COMMAND_PREFIX.length).trim();
      const [commandName, ...args] = commandText.split(/\s+/);
      
      if (TEXT_COMMANDS.includes(commandName.toLowerCase())) {
        log(`🎮 COMMAND: ${commandName} ${args.join(" ")}`);
        
        const core = getStoatRuntime();
        const cfg = core.config.loadConfig();
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
        return;
      }
    }
    
    // ========================================================================
    // QUEUE SYSTEM: Check if channel is already processing
    // ========================================================================
    
    const state = getChannelState(channelId);
    
    const queuedMsg: QueuedMessage = {
      id: message.id,
      content: text,
      authorId: senderId,
      authorName: senderName,
      message: message,
      queuedAt: Date.now(),
      cancelled: false,
    };
    
    if (state.isProcessing) {
      // Channel is busy - queue this message
      log(`📥 Channel busy, queueing message from ${senderName}`);
      queueMessage(channelId, queuedMsg);
      
      // Mark with queued emoji and stop button
      try {
        await message.react(EMOJI_QUEUED);
        await message.react(EMOJI_STOP);  // Can cancel from queue
      } catch {}
      
      return;
    }
    
    // Start processing this message
    state.isProcessing = true;
    
    // Process immediately
    processMessages(channelId, channel, [queuedMsg], isDM).catch(err => {
      error(`Failed to process message: ${err}`);
      state.isProcessing = false;
    });
  });
  
  // Handle reaction-based commands (including stop button)
  client.on("messageReactionAdd" as any, async (reaction: any) => {
    if (stopped) return;
    
    try {
      const emoji = typeof reaction.emoji === "string" 
        ? reaction.emoji 
        : reaction.emoji?.name ?? reaction.emoji?.id;
      
      if (reaction.user?.id === client.user?.id) return;
      
      const message = reaction.message;
      const messageId = message?.id;
      const channel = message?.channel;
      
      if (!channel || !messageId) return;
      
      const channelId = (channel as any)?.id;
      
      // =====================================================================
      // STOP BUTTON HANDLING
      // =====================================================================
      if (emoji === EMOJI_STOP) {
        const state = getChannelState(channelId);
        
        // Check if this is the current processing message
        if (state.currentMessageId === messageId) {
          log(`🛑 Stop requested for current message ${messageId}`);
          requestAbort(channelId);
          return;
        }
        
        // Check if this is a queued message
        if (cancelQueuedMessage(channelId, messageId)) {
          log(`🛑 Cancelled queued message ${messageId}`);
          try {
            await message.unreact(EMOJI_QUEUED);
            await message.unreact(EMOJI_STOP);
            await message.react(EMOJI_CANCELLED);
          } catch {}
          return;
        }
      }
      
      // =====================================================================
      // REGULAR COMMAND REACTIONS
      // =====================================================================
      const interactive = interactiveMessages.get(messageId);
      let command: string | undefined;
      let sessionKey: string;
      
      if (interactive && interactive.reactions[emoji]) {
        command = interactive.reactions[emoji];
        sessionKey = interactive.sessionKey;
        log(`🎯 BUTTON CLICK: ${emoji} → ${command}`);
      } else if (REACTION_COMMANDS[emoji]) {
        command = REACTION_COMMANDS[emoji];
        
        const core = getStoatRuntime();
        const cfg = core.config.loadConfig();
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
        return;
      }
      
      const response = await handleCommand(command, [], message, channel, sessionKey);
      
      if (response) {
        if (interactive && response.embed) {
          try {
            await message.edit({ embeds: [response.embed] });
            log(`✅ Interactive message updated`);
            try { await message.unreact(emoji, reaction.user?.id); } catch {}
            return;
          } catch {}
        }
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
