export function buildStoatClientInit(apiUrl?: string, wsUrl?: string): {
  clientOptions: Record<string, unknown>;
  websocketOptions?: { ws: string };
} {
  const clientOptions: Record<string, unknown> = {};
  if (apiUrl) {
    clientOptions.baseURL = apiUrl;
  }

  const websocketOptions = wsUrl ? { ws: wsUrl } : undefined;
  return { clientOptions, websocketOptions };
}
