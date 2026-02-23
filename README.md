# Stoat Channel Plugin for Clawdbot

A channel plugin for [Stoat](https://stoat.chat) (open-source Discord alternative, formerly Revolt) that connects AI assistants to Stoat servers.

## Features

| Feature | Status |
|---------|--------|
| Connect to Stoat servers | ✅ Working |
| Receive messages | ✅ Working |
| Route to AI | ✅ Working |
| Send replies | ✅ Working |
| Reply-to (quotes) | ✅ Working |
| 👀 reaction on receive | ✅ Working |
| ✅ reaction on complete | ✅ Working |
| Typing indicators | ✅ Working |
| Mention-gating (@bot required) | ✅ Working |
| DM support | ✅ Working |
| Read images | ⚠️ Code ready (depends on server SSL) |
| Send images | ⚠️ Code ready (depends on server SSL) |

## Installation

1. Clone this repo to your Clawdbot extensions directory:
   ```bash
   git clone https://github.com/Thalpy/stoat-ai-interface.git ~/.clawdbot/extensions/stoat
   cd ~/.clawdbot/extensions/stoat
   npm install
   ```

2. Add to your `~/.clawdbot/clawdbot.json`:
   ```json
   {
     "channels": {
       "stoat": {
         "enabled": true,
         "accounts": {
           "default": {
             "token": "YOUR_BOT_TOKEN",
             "apiUrl": "https://your-instance.com/api",
             "enabled": true
           }
         }
       }
     },
     "plugins": {
       "load": {
         "paths": ["~/.clawdbot/extensions/stoat"]
       },
       "entries": {
         "stoat": {
           "enabled": true
         }
       }
     }
   }
   ```

3. Restart Clawdbot:
   ```bash
   clawdbot gateway restart
   ```

## Getting a Bot Token

1. Go to your Stoat instance settings
2. Create a bot application
3. Copy the bot token
4. Add it to your config

## Configuration Options

| Option | Description |
|--------|-------------|
| `token` | Bot token from Stoat |
| `apiUrl` | API URL for your Stoat instance (e.g., `https://bamalam.xyz/api`) |
| `enabled` | Enable/disable the account |

## How It Works

- **In channels:** Bot only responds when @mentioned
- **In DMs:** Bot responds to all messages
- **Reactions:** 👀 when processing, ✅ when complete
- **Replies:** Uses Stoat's reply feature to quote the original message

## Architecture

```
stoat-ai-interface/
├── index.ts              # Plugin entry point, channel definition
├── monitor.ts            # WebSocket connection, message handling
├── send.ts               # Outbound message functions
├── runtime.ts            # Plugin API storage
├── clawdbot.plugin.json  # Plugin manifest
├── package.json          # NPM config
└── tsconfig.json         # TypeScript config
```

## Dependencies

- `stoat.js` (v7.3.6) - Official Stoat JavaScript SDK

## Compatibility Assumptions & Version Constraints

This plugin is currently validated with the following assumptions:

- **Runtime:** Node.js 22+ (tests run via Node's `--experimental-strip-types` path).
- **Loader shape:** Plugin loader can import the package `main` entry (`index.ts`) and call the exported default channel definition.
- **Manifest shape:** `clawdbot.plugin.json` provides `entry`, `type: "channel"`, and matching package metadata expected by OpenClaw/Clawdbot plugin loading.
- **Config contract:** Stoat config is read from `channels.stoat`, with support for top-level default account plus named accounts under `channels.stoat.accounts`.
- **Startup requirement:** Each enabled account must resolve to a non-empty bot token before connection start.
- **Network endpoints:** API and WS endpoints should be consistent for the same Stoat instance (e.g., `https://<host>/api` + `wss://<host>/ws`).

If runtime/plugin-loader expectations change in a future OpenClaw release, re-run `npm test` and `npm run typecheck` first, then update manifest/entry compatibility tests.

## Known Issues

- **Image handling:** Requires the Stoat server's Autumn file service to have valid SSL. Self-hosted instances with SSL issues will show images as URLs instead of inline.

## Development

```bash
npm install
npm test
npm run typecheck
```

### Local Bring-Up Verification Workflow

Use this quick loop when validating local changes:

1. `npm install` (once per dependency change)
2. `npm test` to run smoke/config checks
3. `npm run typecheck` to confirm TypeScript compatibility
4. Start/restart gateway and watch plugin startup logs for Stoat account resolution
5. Perform a simple DM + mention test in Stoat to confirm inbound/outbound path

Notes:
- `npm test` runs smoke tests, config-resolution tests, startup-plan dry-run tests, and manifest/entrypoint compatibility checks using Node's `--experimental-strip-types` loader.
- Account resolution/merge behavior is covered in `test/config.test.mjs` to keep multi-account config compatibility stable.
- Plugin startup planning is covered in `test/start-plan.test.mjs` via `buildStoatStartPlan`, which validates required startup inputs without making external network connections.
- Plugin loader compatibility is covered in `test/manifest-compat.test.mjs`, validating `clawdbot.plugin.json`, `package.json` entry metadata, and `index.ts` exports expected by OpenClaw/Clawdbot.

### Live E2E Verification (real instance)

```bash
node scripts/e2e-live-check.mjs
```

This validates, against the configured real Stoat instance (`.env`):
- bot login/connect
- typing indicator start/stop
- outbound send + reply
- reaction add

The script attempts to delete its probe messages after checks.

See `ROADMAP.md` for the bring-up plan and quality gates.

## Credits

Built by [Whimsycat](https://github.com/clawdbot/clawdbot) 🐱 for [Clawdbot](https://clawdbot.com).

## License

MIT
