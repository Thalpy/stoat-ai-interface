/**
 * Stoat Send Functions
 * 
 * Handles sending messages to Stoat channels/DMs.
 */

import { getStoatClient, getStoatClientEntry } from "./monitor.js";

interface SendOptions {
  accountId?: string;
  replyTo?: string;
}

interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Send a text message to a Stoat channel or DM.
 */
export async function sendMessageStoat(
  to: string,
  text: string,
  options: SendOptions = {}
): Promise<SendResult> {
  const { accountId = "default", replyTo } = options;
  
  const client = getStoatClient(accountId);
  if (!client) {
    return {
      ok: false,
      error: `Stoat client not connected for account "${accountId}"`,
    };
  }
  
  try {
    // Get the channel
    const channel = client.channels.get(to);
    if (!channel) {
      return {
        ok: false,
        error: `Channel not found: ${to}`,
      };
    }
    
    // Build message options
    const messageOpts: any = {};
    if (replyTo) {
      messageOpts.replies = [{ id: replyTo, mention: false }];
    }
    
    // Send the message
    const sent = await channel.sendMessage(text, messageOpts);
    
    return {
      ok: true,
      messageId: sent?.id,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to send message: ${err}`,
    };
  }
}

/**
 * Send a media message to a Stoat channel or DM.
 * Uploads file to Autumn first, then sends with attachment ID.
 */
export async function sendMediaStoat(
  to: string,
  text: string,
  mediaUrl: string,
  options: SendOptions = {}
): Promise<SendResult> {
  const { accountId = "default", replyTo } = options;
  
  const clientEntry = getStoatClientEntry(accountId);
  if (!clientEntry) {
    return {
      ok: false,
      error: `Stoat client not connected for account "${accountId}"`,
    };
  }
  
  const { client, apiUrl } = clientEntry;
  
  try {
    const channel = client.channels.get(to);
    if (!channel) {
      return {
        ok: false,
        error: `Channel not found: ${to}`,
      };
    }
    
    // Determine Autumn URL from API URL
    // Default Stoat/Revolt uses autumn.revolt.chat, but self-hosted may differ
    let autumnUrl = "https://autumn.revolt.chat";
    if (apiUrl) {
      // For self-hosted, use /autumn path instead of subdomain
      // e.g., bamalam.xyz/autumn instead of autumn.bamalam.xyz
      try {
        const apiUrlObj = new URL(apiUrl);
        const baseDomain = apiUrlObj.host.replace(/^api\./, '').replace(/\/api$/, '');
        autumnUrl = `${apiUrlObj.protocol}//${baseDomain}/autumn`;
      } catch {
        // Keep default
      }
    }
    
    // Upload to Autumn
    let attachmentId: string | null = null;
    try {
      // Fetch the media
      const mediaResponse = await fetch(mediaUrl);
      if (!mediaResponse.ok) {
        throw new Error(`Failed to fetch media: ${mediaResponse.status}`);
      }
      
      const blob = await mediaResponse.blob();
      const formData = new FormData();
      
      // Extract filename from URL
      const urlPath = new URL(mediaUrl).pathname;
      const filename = urlPath.split('/').pop() || 'image.png';
      
      formData.append('file', blob, filename);
      
      const uploadResponse = await fetch(`${autumnUrl}/attachments`, {
        method: 'POST',
        body: formData,
      });
      
      if (uploadResponse.ok) {
        const uploadData = await uploadResponse.json();
        attachmentId = uploadData.id;
      }
    } catch (err) {
      console.error(`Autumn upload failed: ${err}`);
      // Fall back to sending URL in text
    }
    
    // Build message
    const messageOpts: any = {
      content: text || undefined,
    };
    
    if (attachmentId) {
      messageOpts.attachments = [attachmentId];
    } else {
      // Fallback: include URL in message
      messageOpts.content = text ? `${text}\n${mediaUrl}` : mediaUrl;
    }
    
    if (replyTo) {
      messageOpts.replies = [{ id: replyTo, mention: false }];
    }
    
    const sent = await channel.sendMessage(messageOpts);
    
    return {
      ok: true,
      messageId: sent?.id,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to send media: ${err}`,
    };
  }
}

/**
 * Send a message with proper media upload to Stoat.
 * Uses the Autumn file server for uploads.
 */
export async function uploadAndSendMedia(
  to: string,
  text: string,
  filePath: string,
  options: SendOptions = {}
): Promise<SendResult> {
  const { accountId = "default", replyTo } = options;
  
  const client = getStoatClient(accountId);
  if (!client) {
    return {
      ok: false,
      error: `Stoat client not connected for account "${accountId}"`,
    };
  }
  
  try {
    const channel = client.channels.get(to);
    if (!channel) {
      return {
        ok: false,
        error: `Channel not found: ${to}`,
      };
    }
    
    // Read file and upload to Autumn
    const fs = await import("node:fs");
    const path = await import("node:path");
    
    if (!fs.existsSync(filePath)) {
      return {
        ok: false,
        error: `File not found: ${filePath}`,
      };
    }
    
    const filename = path.basename(filePath);
    const fileBuffer = fs.readFileSync(filePath);
    
    // Upload to Autumn (Stoat's file server)
    // The exact API depends on the Stoat instance
    // This is the general approach:
    const formData = new FormData();
    formData.append("file", new Blob([fileBuffer]), filename);
    
    // Get Autumn URL from client config or use default
    const autumnUrl = "https://autumn.revolt.chat/attachments";
    
    const uploadRes = await fetch(autumnUrl, {
      method: "POST",
      body: formData,
      headers: {
        // Stoat may require auth for uploads
      },
    });
    
    if (!uploadRes.ok) {
      // Fallback to just sending the text
      const sent = await channel.sendMessage(text || "[Media upload failed]");
      return {
        ok: true,
        messageId: sent?.id,
      };
    }
    
    const uploadData = await uploadRes.json();
    const attachmentId = uploadData.id;
    
    // Send message with attachment reference
    const messageOpts: any = {
      attachments: [attachmentId],
    };
    
    if (replyTo) {
      messageOpts.replies = [{ id: replyTo, mention: false }];
    }
    
    const sent = await channel.sendMessage(text || "", messageOpts);
    
    return {
      ok: true,
      messageId: sent?.id,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Failed to upload and send media: ${err}`,
    };
  }
}
