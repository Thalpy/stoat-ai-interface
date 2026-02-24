export function messageMentionsBot(params: {
  text?: string;
  botUserId?: string;
  mentionIds?: string[];
}): boolean {
  const botUserId = params.botUserId?.trim();
  if (!botUserId) return false;

  if (params.mentionIds?.includes(botUserId)) {
    return true;
  }

  const text = params.text ?? "";
  return text.includes(`<@${botUserId}>`) || text.includes(`<@!${botUserId}>`);
}

function normalizeIdList(input: unknown): string[] {
  if (!Array.isArray(input)) return [];

  const out: string[] = [];
  for (const item of input) {
    if (typeof item === "string") {
      out.push(item);
      continue;
    }

    if (item && typeof item === "object") {
      const maybeId = (item as { id?: unknown }).id;
      if (typeof maybeId === "string") {
        out.push(maybeId);
      }
    }
  }

  return out;
}

export function messageRepliesToBot(params: {
  replyIds?: unknown;
  knownBotMessageIds?: Iterable<string>;
}): boolean {
  const knownSet = new Set<string>();
  for (const id of params.knownBotMessageIds ?? []) {
    if (typeof id === "string" && id.trim()) {
      knownSet.add(id);
    }
  }

  if (!knownSet.size) return false;

  const replyIds = normalizeIdList(params.replyIds);
  return replyIds.some((id) => knownSet.has(id));
}

export function shouldProcessInboundMessage(params: {
  isSelf: boolean;
  isSystem: boolean;
  isDM: boolean;
  isMentioned: boolean;
  isReplyToBot?: boolean;
}): boolean {
  if (params.isSelf) return false;
  if (params.isSystem) return false;
  if (!params.isDM && !params.isMentioned && !params.isReplyToBot) return false;
  return true;
}
