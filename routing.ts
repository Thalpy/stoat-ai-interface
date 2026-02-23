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
