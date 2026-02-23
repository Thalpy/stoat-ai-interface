import 'dotenv/config';
import { Client } from 'stoat.js';

const token = process.env.STOAT_BOT_TOKEN;
const baseURL = process.env.STOAT_BASE_URL;
const ws = process.env.STOAT_WS_URL;
const channelId = process.env.STOAT_CHANNEL_ID;

if (!token || !baseURL || !channelId) {
  throw new Error('Missing STOAT_BOT_TOKEN, STOAT_BASE_URL, or STOAT_CHANNEL_ID in .env');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(client, timeoutMs = 20000) {
  if (client.ready()) return;
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Timed out waiting for ready')), timeoutMs);
    client.once('ready', () => {
      clearTimeout(t);
      resolve();
    });
  });
}

const client = new Client({ baseURL }, ws ? { ws } : undefined);

try {
  await client.loginBot(token);
  await waitReady(client);

  const me = client.user?.username ?? 'unknown';
  const channel = client.channels.get(channelId) || (await client.channels.fetch(channelId));
  if (!channel) throw new Error(`Unable to resolve channel ${channelId}`);

  // typing indicator check
  channel.startTyping?.();
  await sleep(500);
  channel.stopTyping?.();

  const marker = `[pepper-e2e ${new Date().toISOString()}]`;
  const m1 = await channel.sendMessage(`${marker} outbound send check`);
  const m2 = await channel.sendMessage({
    content: `${marker} reply check`,
    replies: [{ id: m1.id, mention: false }],
  });

  await m2.react('✅');

  // Cleanup our probe messages if possible
  try { await m2.delete?.(); } catch {}
  try { await m1.delete?.(); } catch {}

  console.log(JSON.stringify({ ok: true, me, channelId, checks: ['connect', 'typing', 'send', 'reply', 'react'] }));
  process.exit(0);
} catch (err) {
  console.error(err?.stack || String(err));
  process.exit(1);
}
