/**
 * Stoat Runtime Store
 * 
 * Stores the plugin API runtime for use in message handling.
 */

import type { PluginAPI } from "clawdbot/plugin-sdk";

let pluginApi: PluginAPI | null = null;

export function setStoatPluginApi(api: PluginAPI) {
  pluginApi = api;
}

export function getStoatPluginApi(): PluginAPI {
  if (!pluginApi) {
    throw new Error("Stoat plugin API not initialized");
  }
  return pluginApi;
}

export function getStoatRuntime() {
  return getStoatPluginApi().runtime;
}
