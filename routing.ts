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

export function shouldProcessInboundMessage(params: {
  isSelf: boolean;
  isSystem: boolean;
  isDM: boolean;
  isMentioned: boolean;
}): boolean {
  if (params.isSelf) return false;
  if (params.isSystem) return false;
  if (!params.isDM && !params.isMentioned) return false;
  return true;
}
