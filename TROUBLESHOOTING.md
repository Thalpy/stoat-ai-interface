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

## 2026-02-23 15:13:19 PST — Cron outage triage follow-up (channel `01KJ6BZHYC2BBHMR8QQS278KR2`)

### Scope
- Re-ran requested diagnostics and performed explicit channel-access validation for the reported outage channel.
- Reviewed routing/runtime assumptions for mention gating, account token scope, and channel-id alignment.

### Findings
1. **Runtime is healthy for currently configured channel/account path**
   - `npm test` ✅
   - `npm run typecheck` ✅
   - `node scripts/e2e-live-check.mjs` ✅ for `.env` channel `01KJ4MG98H44YMMSJ0BSSJZG1X`

2. **Reported channel is inaccessible to this bot token**
   - `STOAT_CHANNEL_ID=01KJ6BZHYC2BBHMR8QQS278KR2 node scripts/e2e-live-check.mjs` ❌
   - Error now resolves clearly as:
     - `Channel ... not found for bot pepper (01KJ4MGXP1PXVT5SR3FZDB9H9S)`
   - Additional live account probe showed bot membership only in server `01KJ4MG98HCXT8TVH51WGA880S` (`Pepperlabs`), reinforcing channel/account scope mismatch.

3. **Plugin routing assumptions**
   - Mention gating logic supports DMs without mention and channel replies only when mentioned.
   - No hardcoded channel filter in plugin runtime; failure is not caused by local channel allow/block logic.
   - Primary blocker is account/channel reachability (bot not in target server/channel or wrong channel id for this token).

### Fix Applied (smallest safe)
- Improved `scripts/e2e-live-check.mjs` error handling for unresolved channels:
  - Converts opaque Stoat `NotFound` into actionable guidance naming channel id and bot id.
  - This reduces false "bot offline" diagnosis when the real issue is channel/account mismatch.

### Validation
- `npm test` ✅
- `npm run typecheck` ✅
- `node scripts/e2e-live-check.mjs` ✅ (configured channel)
- Targeted outage-channel probe ❌ with explicit mismatch guidance (expected until membership/config corrected)

### Next Actions
1. Invite bot `pepper` (`01KJ4MGXP1PXVT5SR3FZDB9H9S`) to channel/server containing `01KJ6BZHYC2BBHMR8QQS278KR2`, or switch to the token/account that already has access.
2. Re-run:
   - `STOAT_CHANNEL_ID=01KJ6BZHYC2BBHMR8QQS278KR2 node scripts/e2e-live-check.mjs`
3. Once channel access passes, validate mention-triggered reply path in-channel (`@pepper ...`).

## 2026-02-23 15:16:29 PST — Cron outage triage refresh (channel `01KJ6BZHYC2BBHMR8QQS278KR2`)

### Scope
- Re-checked liveness/diagnostics against local `.env`.
- Re-reviewed mention gating + account/channel routing assumptions in `monitor.ts`, `routing.ts`, and plugin config path.

### Findings
1. **Code health remains good**
   - `npm test` ✅
   - `npm run typecheck` ✅

2. **Concrete blocker persists: bot/account cannot resolve target channel**
   - After setting `.env` `STOAT_CHANNEL_ID=01KJ6BZHYC2BBHMR8QQS278KR2`,
   - `node scripts/e2e-live-check.mjs` still fails:
     - `Channel 01KJ6BZHYC2BBHMR8QQS278KR2 not found for bot pepper (01KJ4MGXP1PXVT5SR3FZDB9H9S)`

3. **Routing assumption check**
   - Channel replies require mention (`@pepper`), DMs do not.
   - No plugin-side hardcoded channel-id gate found; this is not a local mention-gating or channel-filter bug.
   - Most likely root cause remains channel membership/scope mismatch for the active token.

### Fix Applied (smallest safe)
- Updated local `.env` `STOAT_CHANNEL_ID` to the outage channel so ongoing live checks target the affected channel directly.

### Validation
- `npm test` ✅
- `npm run typecheck` ✅
- `node scripts/e2e-live-check.mjs` ❌ (expected until bot has access to target channel)

### Next Actions
1. Add/invite bot `pepper` (`01KJ4MGXP1PXVT5SR3FZDB9H9S`) to the server/channel containing `01KJ6BZHYC2BBHMR8QQS278KR2` (or use the correct token/account for that channel).
2. Re-run `node scripts/e2e-live-check.mjs` (now pinned by `.env` to outage channel).
3. Once access succeeds, validate an in-channel mention-triggered reply (`@pepper ...`) end-to-end.
