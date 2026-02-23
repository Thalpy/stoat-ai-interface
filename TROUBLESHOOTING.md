# Stoat Troubleshooting Log

## 2026-02-23 15:09:01 PST — Cron outage triage (channel `01KJ6BZHYC2BBHMR8QQS278KR2`)

### Scope
- Investigated bot liveness + connection path using local `.env`.
- Ran diagnostics: `npm test`, `npm run typecheck`, `node scripts/e2e-live-check.mjs`.
- Added targeted live probe for reported channel:
  - `STOAT_CHANNEL_ID=01KJ6BZHYC2BBHMR8QQS278KR2 node scripts/e2e-live-check.mjs`

### Findings
1. **Bot/token/path are live for configured channel in `.env`**
   - `.env` points to:
     - `STOAT_BASE_URL=https://bamalam.xyz/api`
     - `STOAT_WS_URL=wss://bamalam.xyz/ws`
     - `STOAT_CHANNEL_ID=01KJ4MG98H44YMMSJ0BSSJZG1X`
   - Baseline e2e succeeded on that channel (`connect`, `typing`, `send`, `reply`, `react`).

2. **Reported outage channel is not reachable with current bot/account context**
   - Targeted probe against `01KJ6BZHYC2BBHMR8QQS278KR2` failed with:
     - `{"type":"NotFound",...}`
   - Strong signal that this bot token cannot resolve/access that channel (wrong channel id, wrong server/account, or bot not present/authorized there).

3. **Mention gating assumption was too narrow**
   - Inbound mention detection only checked raw text for `<@BOT_ID>`.
   - This can miss valid mentions represented as `<@!BOT_ID>` or surfaced via structured mention fields.

### Fix Applied (smallest safe code change)
- Hardened mention detection:
  - Added `messageMentionsBot(...)` in `routing.ts`.
  - Detects mentions via:
    - structured `mentionIds` list when available,
    - fallback text patterns `<@BOT_ID>` and `<@!BOT_ID>`.
  - Updated `monitor.ts` to use the helper.
  - Added unit tests in `test/monitor-routing.test.mjs` for all mention forms.

### Validation
- `npm test` ✅ (14/14)
- `npm run typecheck` ✅
- `node scripts/e2e-live-check.mjs` ✅ (configured channel)
- Targeted channel probe remains ❌ NotFound (expected until channel/account mismatch is corrected)

### Next Actions
1. Confirm the intended runtime channel/account mapping for `01KJ6BZHYC2BBHMR8QQS278KR2`:
   - bot is a member of that channel,
   - token belongs to that bot/account,
   - channel ID is from the same Stoat instance.
2. If this is now the primary test channel, update local env/runtime config to that channel and re-run e2e.
3. After deployment/restart with this patch, re-test mention-triggered replies in both DM and channel.

